import type { EscalationDecision } from '@agent-platform/domain';

import type { EscalationPolicy } from './config.js';

import { randomUUID } from 'node:crypto';



export interface EscalationTicket {

  id: string;

  tenantId: string;

  agentId: string;

  sessionId: string;

  reason: string;

  reasons: string[];

  summary: string;

  createdAt: string;

}



export class EscalationEngine {

  private readonly tickets: EscalationTicket[] = [];

  private readonly persistPath?: string;



  constructor(dataDir?: string) {

    if (dataDir && process.env.PERSIST_ESCALATIONS !== 'false') {

      this.persistPath = `${dataDir}/escalations/tickets.jsonl`;

    }

  }



  detect(opts: {

    message: string;

    failureStreak: number;

    confidence: number;

    confidenceThreshold: number;

    policy: EscalationPolicy;

    intent?: string;

    agentFailureThreshold?: number;

  }): EscalationDecision {

    const text = opts.message.toLowerCase();

    const reasons: string[] = [];

    const failureThreshold = opts.agentFailureThreshold ?? opts.policy.failureThreshold;



    for (const t of opts.policy.hardTriggers) {

      if (text.includes(t.toLowerCase())) reasons.push(`hard:${t}`);

    }

    for (const t of opts.policy.softTriggers) {

      if (text.includes(t.toLowerCase())) reasons.push(`soft:${t}`);

    }

    if (opts.failureStreak >= failureThreshold) {

      reasons.push('repeated_failures');

    }

    if (opts.confidence < opts.confidenceThreshold && opts.intent === 'fallback.unknown') {

      reasons.push('low_confidence');

    }

    if (opts.intent?.includes('escalat') || opts.intent === 'support.human') {

      reasons.push('intent_escalation');

    }



    if (!reasons.length) {

      return { shouldEscalate: false, mode: 'none', reasons: [], primaryReason: '' };

    }



    const hard = reasons.some((r) => r.startsWith('hard:') || r === 'intent_escalation' || r === 'repeated_failures');

    return {

      shouldEscalate: true,

      mode: hard ? 'transfer' : 'offer',

      reasons,

      primaryReason: reasons[0]!,

    };

  }



  createTicket(input: Omit<EscalationTicket, 'id' | 'createdAt'>): EscalationTicket {

    const ticket: EscalationTicket = {

      ...input,

      id: randomUUID(),

      createdAt: new Date().toISOString(),

    };

    this.tickets.push(ticket);

    if (this.persistPath) {

      void import('./file-store.js').then(({ appendJsonl, ensureDir }) => {

        const dir = this.persistPath!.replace(/[/\\][^/\\]+$/, '');

        return ensureDir(dir).then(() => appendJsonl(this.persistPath!, ticket));

      });

    }

    return ticket;

  }



  list(tenantId: string): EscalationTicket[] {

    return this.tickets.filter((t) => t.tenantId === tenantId);

  }



  buildSummary(messages: Array<{ role: string; content: string }>, reason: string): string {

    const last = messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n');

    return `Escalation reason: ${reason}\n\nRecent turns:\n${last}`;

  }

}


