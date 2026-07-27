import type { ToolDefinition, ToolResult } from '@agent-platform/domain';

export interface PortalUrls {
  loginUrl: string;
  signupUrl: string;
  quoteUrl?: string;
}

export interface ToolRuntimeContext {
  env: NodeJS.ProcessEnv;
  /** Request-scoped customer JWT — never persisted by MemoryEngine. */
  customerAuthToken?: string;
  slots?: Record<string, string>;
  portal?: PortalUrls;
}

function interpolate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(slots[key] ?? ''));
}

function splitLocation(text: string): { city: string; country: string; address: string } {
  const trimmed = text.trim();
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      city: parts[0]!,
      country: parts[parts.length - 1]!,
      address: trimmed,
    };
  }
  return { city: trimmed, country: 'Canada', address: trimmed };
}

function enrichQuoteSlots(slots: Record<string, string>): Record<string, string> {
  const out = { ...slots };
  if (slots.origin) {
    const o = splitLocation(slots.origin);
    out.origin_city = o.city;
    out.origin_country = o.country;
    if (!out.origin) out.origin = o.address;
  }
  if (slots.destination) {
    const d = splitLocation(slots.destination);
    out.destination_city = d.city;
    out.destination_country = d.country;
    if (!out.destination) out.destination = d.address;
  }
  if (!out.consignee_name && out.contact_name) {
    out.consignee_name = out.contact_name;
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

function summarizeTracking(data: unknown, trackingNumber: string): string {
  if (!data || typeof data !== 'object') {
    return `I looked up **${trackingNumber}**, but the tracking response was empty. Please try again or use [Track Now](https://acocamtrading.ca/) on the ACOCAM website.`;
  }
  const obj = data as Record<string, unknown>;
  const status =
    (obj.status as string) ||
    (obj.shipmentStatus as string) ||
    (obj.currentStatus as string) ||
    (obj.state as string);
  const location = (obj.location as string) || (obj.currentLocation as string) || (obj.lastLocation as string);
  const eta = (obj.eta as string) || (obj.estimatedDelivery as string) || (obj.estimatedArrival as string);
  const lines = [`Tracking for **${trackingNumber}**:`];
  if (status) lines.push(`• Status: ${status}`);
  if (location) lines.push(`• Location: ${location}`);
  if (eta) lines.push(`• ETA: ${eta}`);
  if (lines.length === 1) {
    lines.push('```json');
    lines.push(JSON.stringify(data, null, 2).slice(0, 1800));
    lines.push('```');
  }
  lines.push('\nYou can also track on [acocamtrading.ca](https://acocamtrading.ca/) (Track Now).');
  return lines.join('\n');
}

function summarizeQuotation(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return 'Your quotation request was submitted, but I did not receive details back from the API.';
  }
  const q = data as Record<string, unknown>;
  const id = q.id ?? q.quotation_id;
  const status = q.status ?? 'pending';
  const lines = ['Your **quotation request** has been submitted to ACOCAM.'];
  if (id) lines.push(`• Reference ID: **${id}**`);
  lines.push(`• Status: **${status}**`);
  lines.push(
    '\nAn ACOCAM specialist will review your request. No price is confirmed in chat until you receive an official quote in your account.',
  );
  if (typeof q.requires_manual_quote === 'boolean' && q.requires_manual_quote) {
    lines.push('\nThis request requires manual review — our team will follow up by email.');
  }
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

function loginPrompt(portal?: PortalUrls): string {
  const login = portal?.loginUrl ?? 'https://acocamtrading.ca/login';
  const signup = portal?.signupUrl ?? login;
  const quote = portal?.quoteUrl ?? 'https://acocamtrading.ca/get-quote/';
  const authLines =
    signup === login
      ? [`• [Log in or create an account](${login})`]
      : [`• [Log in](${login})`, `• [Create account](${signup})`];
  return [
    'To **get a quote** or submit a booking through the live ACOCAM system, please sign in to your account first:',
    '',
    ...authLines,
    `• [Get a quote on the website](${quote})`,
    '',
    'After you sign in, you can request a quote on the website or return here and tap **Get a quote in chat**.',
    'If you are already logged in on acocamtrading.ca, the chat widget will detect your session and continue with shipment details.',
    'If your website passes a customer login token to the chat widget, I can submit the quotation API on your behalf.',
  ].join('\n');
}

export class ToolEngine {
  async execute(def: ToolDefinition, ctx: ToolRuntimeContext): Promise<ToolResult> {
    const baseEnv = def.baseUrlEnv ?? 'API_BASE_URL';
    const baseUrl = (ctx.env[baseEnv] ?? ctx.env.API_BASE_URL ?? '').replace(/\/$/, '');
    if (!baseUrl) {
      return { ok: false, error: `Base URL not configured (${baseEnv}).` };
    }

    let path = def.path;
    let slots = enrichQuoteSlots({ ...(ctx.slots ?? {}) });
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: def.method,
        headers,
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* keep text */
      }
      if (!res.ok) {
        return { ok: false, httpStatus: res.status, data, error: `API returned ${res.status}` };
      }
      return { ok: true, httpStatus: res.status, data };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        error: aborted
          ? `Service timed out after ${timeoutMs}ms (is ${baseEnv} running?)`
          : err instanceof Error
            ? err.message
            : 'Tool request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  formatResult(def: ToolDefinition, result: ToolResult, ctx?: ToolRuntimeContext): string {
    if (result.authRequired) {
      return loginPrompt(ctx?.portal);
    }
    if (!result.ok) {
      if (def.id === 'track_shipment') {
        return [
          `I could not look up that shipment right now${result.error ? ` (${result.error})` : ''}.`,
          'Please confirm the tracking / file number, try [Track Now](https://acocamtrading.ca/), or ask to speak with a human agent.',
        ].join(' ');
      }
      if (def.id === 'create_quotation') {
        if (result.httpStatus === 401 || result.httpStatus === 403) {
          return loginPrompt(ctx?.portal);
        }
        return [
          `I could not submit your quotation request${result.error ? ` (${result.error})` : ''}.`,
          `Please sign in at [acocamtrading.ca/login](${ctx?.portal?.loginUrl ?? 'https://acocamtrading.ca/login'}) or [get a quote online](${ctx?.portal?.quoteUrl ?? 'https://acocamtrading.ca/get-quote/'}), then try again. You can also ask for a human agent.`,
        ].join(' ');
      }
      return `I could not complete **${def.label}** right now${result.error ? `: ${result.error}` : '.'} Would you like a human agent instead?`;
    }
    if (def.id === 'track_shipment') {
      const tn =
        typeof result.data === 'object' && result.data && 'trackingNumber' in (result.data as object)
          ? String((result.data as { trackingNumber?: string }).trackingNumber)
          : 'your shipment';
      return summarizeTracking(result.data, tn);
    }
    if (def.id === 'create_quotation') {
      return summarizeQuotation(result.data);
    }
    return `Here is the result for **${def.label}**:\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 2500)}\n\`\`\``;
  }
}

export { loginPrompt, profileToWorkflowSlots, splitLocation, enrichQuoteSlots };
