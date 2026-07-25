export interface AnalyticsEvent {
  at: string;
  tenantId: string;
  agentId?: string;
  sessionId?: string;
  type: string;
  data?: Record<string, unknown>;
}

const SENSITIVE = /(password|token|authorization|card|cvv|ssn|secret)/i;

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (SENSITIVE.test(value) || value.length > 500) return '[redacted]';
    return value.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[card]').replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[email]');
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE.test(k) ? '[redacted]' : redactValue(v);
    }
    return out;
  }
  return value;
}

export class AnalyticsEngine {
  private readonly events: AnalyticsEvent[] = [];

  track(event: Omit<AnalyticsEvent, 'at'>): void {
    const safe: AnalyticsEvent = {
      ...event,
      at: new Date().toISOString(),
      data: event.data ? (redactValue(event.data) as Record<string, unknown>) : undefined,
    };
    this.events.push(safe);
  }

  list(tenantId: string, limit = 100): AnalyticsEvent[] {
    return this.events.filter((e) => e.tenantId === tenantId).slice(-limit);
  }
}
