import type { ToolDefinition, ToolResult } from '@agent-platform/domain';
import { isDevMode, sanitizeUserFacingError } from './security.js';

export interface PortalUrls {
  loginUrl: string;
  signupUrl: string;
  quoteUrl?: string;
}

export interface ToolRuntimeContext {
  env: NodeJS.ProcessEnv;
  /** Tenant-level fallback when the tool's baseUrlEnv is unset. */
  apiBaseUrl?: string;
  /** Request-scoped customer JWT — never persisted by MemoryEngine. */
  customerAuthToken?: string;
  slots?: Record<string, string>;
  portal?: PortalUrls;
  /** Conversation language (en | fr) for localized tool messages. */
  language?: string;
  /** Tenant locale string table for the active language. */
  locale?: Record<string, string>;
}

function locText(locale: Record<string, string> | undefined, key: string, fallback: string): string {
  return locale?.[key]?.trim() || fallback;
}

function locTemplate(
  locale: Record<string, string> | undefined,
  key: string,
  fallback: string,
  vars: Record<string, string>,
): string {
  let text = locText(locale, key, fallback);
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  return text;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '');
}

/** Resolve logistics API origin: env var → tenant settings → generic API_BASE_URL. */
export function resolveToolBaseUrl(
  def: ToolDefinition,
  ctx: ToolRuntimeContext,
): { baseUrl: string; baseEnv: string } | { error: string } {
  const baseEnv = def.baseUrlEnv ?? 'API_BASE_URL';
  const raw =
    ctx.env[baseEnv]?.trim() ||
    ctx.apiBaseUrl?.trim() ||
    ctx.env.API_BASE_URL?.trim() ||
    '';
  const baseUrl = normalizeBaseUrl(raw);
  if (!baseUrl) {
    return {
      error: `Base URL not configured. Set ${baseEnv} in .env or apiBaseUrl in tenant settings.`,
    };
  }
  return { baseUrl, baseEnv };
}

function describeFetchError(err: unknown, baseUrl: string, baseEnv: string, timeoutMs: number): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return `Service timed out after ${timeoutMs}ms (is the logistics API running at ${baseUrl}?)`;
  }
  const cause =
    err instanceof Error && err.cause && typeof err.cause === 'object'
      ? (err.cause as NodeJS.ErrnoException)
      : null;
  const code = cause?.code ?? (err as NodeJS.ErrnoException)?.code;
  if (code === 'ECONNREFUSED') {
    return `Cannot connect to logistics API at ${baseUrl} (connection refused — check ${baseEnv} and ensure the API server is running)`;
  }
  if (code === 'ENOTFOUND') {
    return `Cannot reach logistics API host for ${baseUrl} (host not found — check ${baseEnv})`;
  }
  if (err instanceof Error && err.message === 'fetch failed' && cause?.message) {
    return `Cannot reach logistics API at ${baseUrl} (${cause.message})`;
  }
  return err instanceof Error ? err.message : 'Tool request failed';
}

function isHtmlBody(text: string): boolean {
  return /^\s*<!DOCTYPE html/i.test(text) || /^\s*<html[\s>]/i.test(text);
}

function isTransientNetworkError(err: unknown): boolean {
  const cause =
    err instanceof Error && err.cause && typeof err.cause === 'object'
      ? (err.cause as NodeJS.ErrnoException)
      : null;
  const code = cause?.code ?? (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNRESET' || code === 'ETIMEDOUT';
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt === 0 && isTransientNetworkError(err)) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function interpolate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(slots[key] ?? ''));
}

function splitLocation(text: string, defaultCountry = 'Canada'): { city: string; country: string; address: string } {
  const trimmed = text.trim();
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts[0]!,
      country: parts[parts.length - 1]!,
      address: trimmed,
    };
  }
  return { city: trimmed, country: defaultCountry, address: trimmed };
}

function enrichQuoteSlots(slots: Record<string, string>, defaultCountry = 'Canada'): Record<string, string> {
  const out = { ...slots };
  if (slots.origin) {
    const o = splitLocation(slots.origin, defaultCountry);
    out.origin_city = o.city;
    out.origin_country = o.country;
    if (!out.origin) out.origin = o.address;
  }
  if (slots.destination) {
    const d = splitLocation(slots.destination, defaultCountry);
    out.destination_city = d.city;
    out.destination_country = d.country;
    if (!out.destination) out.destination = d.address;
  }
  if (!out.consignee_name && out.contact_name) {
    out.consignee_name = out.contact_name;
  }
  if (/^same$/i.test(out.consignee_name?.trim() ?? '') && out.contact_name) {
    out.consignee_name = out.contact_name;
  }
  if (out.bookingIntent === 'true') {
    out._booking = 'true';
  }
  return out;
}

function buildBodyFromTemplate(template: Record<string, unknown>, slots: Record<string, string>): unknown {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      out[key] = slots[value] ?? '';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = buildBodyFromTemplate(value as Record<string, unknown>, slots);
    }
  }
  return out;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    return obj.data as Record<string, unknown>;
  }
  if (obj.shipment && typeof obj.shipment === 'object' && !Array.isArray(obj.shipment)) {
    return obj.shipment as Record<string, unknown>;
  }
  return obj;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function formatStatus(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatHistory(history: unknown, locale?: Record<string, string>): string[] {
  if (!Array.isArray(history) || !history.length) return [];
  const lines: string[] = ['', locText(locale, 'tool.trackHistoryHeader', 'Recent updates:')];
  for (const entry of history.slice(0, 5)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const status = pickString(e, ['status', 'event', 'title', 'description', 'message']);
    const location = pickString(e, ['location', 'place', 'city']);
    const at = pickString(e, ['created_at', 'timestamp', 'date', 'time', 'updated_at']);
    const parts = [status, location, at].filter(Boolean);
    if (parts.length) lines.push(`- ${parts.join(' — ')}`);
  }
  return lines.length > 1 ? lines : [];
}

/** Human-readable tracking card for ACOCAM public track API. */
export function summarizeTracking(
  data: unknown,
  fallbackTrackingNumber: string,
  locale?: Record<string, string>,
): string {
  const obj = asRecord(data);
  if (!obj) {
    return locTemplate(
      locale,
      'tool.trackEmpty',
      'I looked up **{{tracking}}**, but the tracking response was empty. Please try again or use [Track Now](https://acocamtrading.ca/) on the ACOCAM website.',
      { tracking: fallbackTrackingNumber },
    );
  }

  const trackingNumber =
    pickString(obj, ['tracking_number', 'trackingNumber', 'tracking_id', 'trackingId']) ||
    fallbackTrackingNumber;
  const status = pickString(obj, ['status', 'shipmentStatus', 'currentStatus', 'state']);
  const origin = pickString(obj, ['origin', 'origin_city', 'from']);
  const destination = pickString(obj, ['destination', 'destination_city', 'to']);
  const carrier = pickString(obj, ['carrier', 'carrier_name']);
  const eta = pickString(obj, [
    'expected_delivery',
    'estimatedDelivery',
    'estimatedArrival',
    'eta',
    'expectedDelivery',
  ]);
  const receiver = pickString(obj, ['receiver_name', 'receiverName', 'consignee']);

  const lines = [
    locTemplate(locale, 'tool.trackTitle', 'Tracking for **{{tracking}}**:', { tracking: trackingNumber }),
  ];
  if (status) lines.push(`- ${locText(locale, 'tool.trackStatus', 'Status')}: ${formatStatus(status)}`);
  if (origin) lines.push(`- ${locText(locale, 'tool.trackOrigin', 'Origin')}: ${origin}`);
  if (destination) lines.push(`- ${locText(locale, 'tool.trackDestination', 'Destination')}: ${destination}`);
  if (carrier) lines.push(`- ${locText(locale, 'tool.trackCarrier', 'Carrier')}: ${carrier}`);
  if (eta) lines.push(`- ${locText(locale, 'tool.trackEta', 'Expected delivery')}: ${eta}`);
  if (receiver) lines.push(`- ${locText(locale, 'tool.trackReceiver', 'Receiver')}: ${receiver}`);
  lines.push(...formatHistory(obj.tracking_history ?? obj.trackingHistory ?? obj.history, locale));

  if (lines.length === 1) {
    lines.push('```json');
    lines.push(JSON.stringify(obj, null, 2).slice(0, 1800));
    lines.push('```');
  }

  lines.push(`\n${locText(locale, 'tool.trackFooter', 'You can also track on [acocamtrading.ca](https://acocamtrading.ca/) (Track Now).')}`);
  lines.push(locText(locale, 'tool.trackHelp', 'Need more help? Ask me another question or talk to a human agent.'));
  return lines.join('\n');
}

function summarizeQuotation(data: unknown, locale?: Record<string, string>): string {
  if (!data || typeof data !== 'object') {
    return locText(
      locale,
      'tool.quoteEmpty',
      'Your quotation request was submitted, but I did not receive details back from the API.',
    );
  }
  const q = data as Record<string, unknown>;
  const id = q.id ?? q.quotation_id;
  const status = q.status ?? 'pending';
  const lines = [locText(locale, 'tool.quoteSubmitted', 'Your **quotation request** has been submitted to ACOCAM.')];
  if (id) lines.push(`- ${locText(locale, 'tool.quoteRef', 'Reference ID')}: **${id}**`);
  lines.push(`- ${locText(locale, 'tool.quoteStatus', 'Status')}: **${status}**`);
  lines.push(`\n${locText(locale, 'tool.quoteReview', 'An ACOCAM specialist will review your request. No price is confirmed in chat until you receive an official quote in your account.')}`);
  if (typeof q.requires_manual_quote === 'boolean' && q.requires_manual_quote) {
    lines.push(`\n${locText(locale, 'tool.quoteManual', 'This request requires manual review — our team will follow up by email.')}`);
  }
  return lines.join('\n');
}

function summarizeBooking(data: unknown, portal?: PortalUrls, locale?: Record<string, string>): string {
  if (!data || typeof data !== 'object') {
    return locText(
      locale,
      'tool.bookEmpty',
      'Your shipment booking was submitted, but I did not receive details back from the API.',
    );
  }
  const q = data as Record<string, unknown>;
  const id = q.id ?? q.quotation_id;
  const status = q.status ?? 'pending';
  const login = portal?.loginUrl ?? 'https://acocamtrading.ca/login';
  const lines = [locText(locale, 'tool.bookSubmitted', 'Your **shipment booking** has been submitted to your ACOCAM account.')];
  if (id) lines.push(`- ${locText(locale, 'tool.bookRef', 'Booking reference')}: **${id}**`);
  lines.push(`- ${locText(locale, 'tool.quoteStatus', 'Status')}: **${status}**`);
  lines.push(
    `\n${locText(locale, 'tool.bookReview', 'Our team will review routing, pricing, and documentation. Final rates are confirmed in your account — not in chat.')}`,
  );
  if (typeof q.requires_manual_quote === 'boolean' && q.requires_manual_quote) {
    lines.push(`\n${locText(locale, 'tool.bookManual', 'This route requires specialist review — we will follow up by email.')}`);
  }
  lines.push(
    `\n${locTemplate(locale, 'tool.bookAccount', 'Track progress in [your ACOCAM account]({{loginUrl}}).', { loginUrl: login })}`,
  );
  return lines.join('\n');
}

function profileToWorkflowSlots(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  const user = data as Record<string, unknown>;
  const slots: Record<string, string> = {};
  if (typeof user.name === 'string' && user.name.trim()) slots.contact_name = user.name.trim();
  if (typeof user.email === 'string' && user.email.trim()) slots.contact_email = user.email.trim();
  if (typeof user.phone === 'string' && user.phone.trim()) slots.contact_phone = user.phone.trim();
  if (typeof user.address === 'string' && user.address.trim()) slots.origin = user.address.trim();
  return slots;
}

function loginPrompt(portal?: PortalUrls, locale?: Record<string, string>): string {
  const login = portal?.loginUrl ?? 'https://acocamtrading.ca/login';
  const signup = portal?.signupUrl ?? login;
  const quote = portal?.quoteUrl ?? 'https://acocamtrading.ca/get-quote/';
  const authLines =
    signup === login
      ? [`- [${locText(locale, 'auth.loginCombined', 'Log in or create an account')}](${login})`]
      : [
          `- [${locText(locale, 'auth.login', 'Log in')}](${login})`,
          `- [${locText(locale, 'auth.signup', 'Create account')}](${signup})`,
        ];
  return [
    locText(
      locale,
      'auth.loginIntro',
      'To **book a shipment** or **get a quote** through the live ACOCAM system, please sign in to your account first:',
    ),
    '',
    ...authLines,
    `- [${locText(locale, 'auth.quoteOnline', 'Get a quote on the website')}](${quote})`,
    '',
    locText(
      locale,
      'auth.loginReturn',
      'After you sign in on the website, return to chat and tap **Get a quote** again — your session will be detected automatically.',
    ),
    locText(
      locale,
      'auth.loginTokenHint',
      'If your website passes a customer login token to the chat widget, I can submit the quotation API on your behalf.',
    ),
  ].join('\n');
}

/** Step-by-step account creation guide for signup / registration questions. */
function accountSignupGuide(portal?: PortalUrls, locale?: Record<string, string>): string {
  const login = portal?.loginUrl ?? 'https://acocamtrading.ca/login';
  const quote = portal?.quoteUrl ?? 'https://acocamtrading.ca/get-quote/';
  return [
    locText(
      locale,
      'auth.accountGuideIntro',
      'To **create your ACOCAM customer account** (quotes, bookings, tracking, and documents):',
    ),
    '',
    locTemplate(
      locale,
      'auth.accountStep1',
      '1. Go to [Log in / Create account]({{loginUrl}}) on acocamtrading.ca',
      { loginUrl: login },
    ),
    locText(
      locale,
      'auth.accountStep2',
      '2. Choose **Create account** / **Sign up** and complete your profile (name, email, phone).',
    ),
    locText(
      locale,
      'auth.accountStep3',
      '3. Sign in after registration (verify your email if prompted).',
    ),
    locText(
      locale,
      'auth.accountStep4',
      '4. Return to this chat — your session may be detected automatically if the website links the widget to your login.',
    ),
    '',
    locTemplate(
      locale,
      'auth.accountGuest',
      'Prefer not to register yet? [Get a quote online]({{quoteUrl}}) as a guest — our team will follow up by email.',
      { quoteUrl: quote },
    ),
  ].join('\n');
}

export class ToolEngine {
  async execute(def: ToolDefinition, ctx: ToolRuntimeContext): Promise<ToolResult> {
    const resolved = resolveToolBaseUrl(def, ctx);
    if ('error' in resolved) {
      return { ok: false, error: resolved.error };
    }
    const { baseUrl, baseEnv } = resolved;
    const defaultCountry = ctx.env.DEFAULT_COUNTRY ?? ctx.env.ACOCAM_DEFAULT_COUNTRY ?? 'Canada';

    let path = def.path;
    let slots = enrichQuoteSlots({ ...(ctx.slots ?? {}) }, defaultCountry);
    if (def.inputFrom) {
      for (const [param, slotKey] of Object.entries(def.inputFrom)) {
        slots[param] = slots[slotKey] ?? slots[param] ?? '';
      }
    }
    path = interpolate(path, slots);

    if (def.requireAuth && !ctx.customerAuthToken) {
      return {
        ok: false,
        authRequired: true,
        error: 'Customer sign-in required.',
      };
    }

    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (ctx.customerAuthToken) {
      headers.Authorization = `Bearer ${ctx.customerAuthToken}`;
    }

    let body: string | undefined;
    if (def.method === 'POST') {
      const payload = def.bodyFrom ? buildBodyFromTemplate(def.bodyFrom, slots) : slots;
      body = JSON.stringify(payload);
    }

    const timeoutMs = Number(ctx.env.TOOL_TIMEOUT_MS ?? 15000);

    try {
      const res = await fetchWithRetry(
        url,
        {
          method: def.method,
          headers,
          body,
        },
        timeoutMs,
      );
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* keep text */
      }
      if (!res.ok) {
        const bodyText = typeof text === 'string' ? text : '';
        if (isHtmlBody(bodyText)) {
          return {
            ok: false,
            httpStatus: res.status,
            data,
            error:
              res.status === 404
                ? `Logistics API endpoint not found at ${url} — ${baseEnv} may point to the website instead of the ACOCAM logistics backend`
                : `Logistics API at ${baseUrl} returned HTML instead of JSON (HTTP ${res.status}) — check ${baseEnv}`,
          };
        }
        return { ok: false, httpStatus: res.status, data, error: `API returned ${res.status}` };
      }
      return { ok: true, httpStatus: res.status, data };
    } catch (err) {
      return {
        ok: false,
        error: describeFetchError(err, baseUrl, baseEnv, timeoutMs),
      };
    }
  }

  formatResult(def: ToolDefinition, result: ToolResult, ctx?: ToolRuntimeContext): string {
    const slots = ctx?.slots;
    const locale = ctx?.locale;
    const devMode = isDevMode(ctx?.env);
    const errText = sanitizeUserFacingError(result.error, devMode);
    if (result.authRequired) {
      return loginPrompt(ctx?.portal, locale);
    }
    if (!result.ok) {
      if (def.id === 'track_shipment') {
        const tn = slots?.trackingNumber ? ` **${slots.trackingNumber}**` : '';
        if (result.httpStatus === 401 || result.httpStatus === 403) {
          return [
            locTemplate(locale, 'tool.trackAuthRequired', 'Sign-in is required to look up shipment{{tracking}} in the live system.', {
              tracking: tn,
            }),
            loginPrompt(ctx?.portal, locale),
          ].join('\n\n');
        }
        if (result.httpStatus === 404) {
          return locTemplate(
            locale,
            'tool.trackNotFound',
            'I could not find a shipment{{tracking}}. Please double-check the tracking / file / AWB / B/L number and try again, or use [Track Now](https://acocamtrading.ca/), or ask to speak with a human agent.',
            { tracking: tn },
          );
        }
        const detail = errText
          ? locTemplate(locale, 'tool.genericErrorDetail', ': {{detail}}', { detail: errText })
          : '';
        return locTemplate(
          locale,
          'tool.trackError',
          'I could not look up that shipment right now{{detail}}. Please confirm the tracking / file number, try [Track Now](https://acocamtrading.ca/), or ask to speak with a human agent.',
          { detail },
        );
      }
      if (def.id === 'create_quotation') {
        if (result.httpStatus === 401 || result.httpStatus === 403) {
          return loginPrompt(ctx?.portal, locale);
        }
        const isBooking = slots?.bookingIntent === 'true';
        const action = locText(
          locale,
          isBooking ? 'tool.quoteActionBooking' : 'tool.quoteActionQuotation',
          isBooking ? 'shipment booking' : 'quotation request',
        );
        const detail = errText
          ? locTemplate(locale, 'tool.genericErrorDetail', ': {{detail}}', { detail: errText })
          : '';
        const loginUrl = ctx?.portal?.loginUrl ?? 'https://acocamtrading.ca/login';
        const quoteUrl = ctx?.portal?.quoteUrl ?? 'https://acocamtrading.ca/get-quote/';
        return locTemplate(
          locale,
          'tool.quoteSubmitError',
          'I could not submit your {{action}}{{detail}}. Please sign in at [acocamtrading.ca/login]({{loginUrl}}) or [get a quote online]({{quoteUrl}}), then try again. You can also ask for a human agent.',
          { action, detail, loginUrl, quoteUrl },
        );
      }
      const detail = errText
        ? locTemplate(locale, 'tool.genericErrorDetail', ': {{detail}}', { detail: errText })
        : locText(locale, 'tool.genericErrorEnd', '.');
      return locTemplate(
        locale,
        'tool.genericError',
        'I could not complete **{{label}}** right now{{detail}} Would you like a human agent instead?',
        { label: def.label, detail },
      );
    }
    if (def.id === 'track_shipment') {
      const fallback = slots?.trackingNumber || 'your shipment';
      return summarizeTracking(result.data, fallback, locale);
    }
    if (def.id === 'create_quotation') {
      if (slots?.bookingIntent === 'true') {
        return summarizeBooking(result.data, ctx?.portal, locale);
      }
      return summarizeQuotation(result.data, locale);
    }
    return `Here is the result for **${def.label}**:\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 2500)}\n\`\`\``;
  }
}

export { loginPrompt, accountSignupGuide, profileToWorkflowSlots, splitLocation, enrichQuoteSlots };
