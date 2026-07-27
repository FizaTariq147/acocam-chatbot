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

function summarizeTracking(data: unknown, trackingNumber: string): string {
  if (!data || typeof data !== 'object') {
    return `I looked up **${trackingNumber}**, but the tracking response was empty. Please try again or use Track Now on https://acocamtrading.ca/`;
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
  lines.push('\nYou can also track on https://acocamtrading.ca/ (Track Now).');
  return lines.join('\n');
}

export class ToolEngine {
  async execute(def: ToolDefinition, ctx: ToolRuntimeContext): Promise<ToolResult> {
    const baseEnv = def.baseUrlEnv ?? 'API_BASE_URL';
    const baseUrl = (ctx.env[baseEnv] ?? ctx.env.API_BASE_URL ?? '').replace(/\/$/, '');
    if (!baseUrl) {
      return { ok: false, error: `Base URL not configured (${baseEnv}).` };
    }

    // Egress allowlist: only configured base URL + path from tenant tool JSON.
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

    const timeoutMs = Number(ctx.env.TOOL_TIMEOUT_MS ?? 8000);
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
          ? `Tracking service timed out after ${timeoutMs}ms (is ${baseEnv} running?)`
          : err instanceof Error
            ? err.message
            : 'Tool request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  formatResult(def: ToolDefinition, result: ToolResult): string {
    if (result.authRequired) {
      return 'Please sign in to your ACOCAM account on https://acocamtrading.ca/, then ask me again.';
    }
    if (!result.ok) {
      if (def.id === 'track_shipment') {
        return [
          `I could not look up that shipment right now${result.error ? ` (${result.error})` : ''}.`,
          'Please confirm the tracking / file number, try Track Now on https://acocamtrading.ca/, or ask to speak with a human agent.',
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
    return `Here is the result for **${def.label}**:\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 2500)}\n\`\`\``;
  }
}
