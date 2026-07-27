import type { ToolDefinition, ToolResult } from '@agent-platform/domain';

export interface ToolRuntimeContext {
  env: NodeJS.ProcessEnv;
  /** Request-scoped customer JWT — never persisted by MemoryEngine. */
  customerAuthToken?: string;
  slots?: Record<string, string>;
}

function interpolate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(slots[key] ?? ''));
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  // Some APIs wrap payload: { data: {...} } or { shipment: {...} }
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

function formatHistory(history: unknown): string[] {
  if (!Array.isArray(history) || !history.length) return [];
  const lines: string[] = ['', 'Recent updates:'];
  for (const entry of history.slice(0, 5)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const status = pickString(e, ['status', 'event', 'title', 'description', 'message']);
    const location = pickString(e, ['location', 'place', 'city']);
    const at = pickString(e, ['created_at', 'timestamp', 'date', 'time', 'updated_at']);
    const parts = [status, location, at].filter(Boolean);
    if (parts.length) lines.push(`• ${parts.join(' — ')}`);
  }
  return lines.length > 1 ? lines : [];
}

/** Human-readable tracking card for ACOCAM public track API. */
export function summarizeTracking(data: unknown, fallbackTrackingNumber: string): string {
  const obj = asRecord(data);
  if (!obj) {
    return `I looked up **${fallbackTrackingNumber}**, but the tracking response was empty. Please try again or use Track Now on https://acocamtrading.ca/`;
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

  const lines = [`Tracking for **${trackingNumber}**:`];
  if (status) lines.push(`• Status: ${formatStatus(status)}`);
  if (origin) lines.push(`• Origin: ${origin}`);
  if (destination) lines.push(`• Destination: ${destination}`);
  if (carrier) lines.push(`• Carrier: ${carrier}`);
  if (eta) lines.push(`• Expected delivery: ${eta}`);
  if (receiver) lines.push(`• Receiver: ${receiver}`);
  lines.push(...formatHistory(obj.tracking_history ?? obj.trackingHistory ?? obj.history));

  if (lines.length === 1) {
    lines.push('```json');
    lines.push(JSON.stringify(obj, null, 2).slice(0, 1800));
    lines.push('```');
  }

  lines.push('\nNeed more help? Ask me another question or talk to a human agent.');
  return lines.join('\n');
}

export class ToolEngine {
  async execute(def: ToolDefinition, ctx: ToolRuntimeContext): Promise<ToolResult> {
    const baseEnv = def.baseUrlEnv ?? 'API_BASE_URL';
    const baseUrl = (ctx.env[baseEnv] ?? ctx.env.API_BASE_URL ?? '').replace(/\/$/, '');
    if (!baseUrl) {
      return { ok: false, error: `Base URL not configured (${baseEnv}).` };
    }

    let path = def.path;
    const slots = { ...(ctx.slots ?? {}) };
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
        error: 'This action requires the customer to be signed in.',
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

    const timeoutMs = Number(ctx.env.TOOL_TIMEOUT_MS ?? 12000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: def.method,
        headers,
        body: def.method === 'POST' ? JSON.stringify(slots) : undefined,
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
          ? `Tracking service timed out after ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : 'Tool request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  formatResult(def: ToolDefinition, result: ToolResult, slots?: Record<string, string>): string {
    if (result.authRequired) {
      return 'Please sign in to your ACOCAM account on https://acocamtrading.ca/, then ask me again.';
    }
    if (!result.ok) {
      if (def.id === 'track_shipment') {
        const tn = slots?.trackingNumber ? ` **${slots.trackingNumber}**` : '';
        if (result.httpStatus === 404) {
          return [
            `I could not find a shipment${tn}.`,
            'Please double-check the tracking / file / AWB / B/L number and try again,',
            'or use Track Now on https://acocamtrading.ca/, or ask to speak with a human agent.',
          ].join(' ');
        }
        return [
          `I could not look up that shipment right now${result.error ? ` (${result.error})` : ''}.`,
          'Please confirm the tracking number, try Track Now on https://acocamtrading.ca/, or ask to speak with a human agent.',
        ].join(' ');
      }
      return `I could not complete **${def.label}** right now${result.error ? `: ${result.error}` : '.'} Would you like a human agent instead?`;
    }
    if (def.id === 'track_shipment') {
      const fallback = slots?.trackingNumber || 'your shipment';
      return summarizeTracking(result.data, fallback);
    }
    return `Here is the result for **${def.label}**:\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 2500)}\n\`\`\``;
  }
}
