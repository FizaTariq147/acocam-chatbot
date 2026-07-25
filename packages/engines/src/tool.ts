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

    try {
      const res = await fetch(url, {
        method: def.method,
        headers,
        body: def.method === 'POST' ? JSON.stringify(slots) : undefined,
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
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Tool request failed',
      };
    }
  }

  formatResult(def: ToolDefinition, result: ToolResult): string {
    if (result.authRequired) {
      return 'Please sign in to your account, then ask me again.';
    }
    if (!result.ok) {
      return `I could not complete **${def.label}** right now${result.error ? `: ${result.error}` : '.'} Would you like a human agent instead?`;
    }
    return `Here is the result for **${def.label}**:\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 2500)}\n\`\`\``;
  }
}
