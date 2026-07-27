import type {
  ActionButton,
  ConversationState,
  LlmMessage,
  TurnResponse,
} from '@agent-platform/domain';
import {
  AiEngine,
  AnalyticsEngine,
  ConfigEngine,
  EscalationEngine,
  IntentEngine,
  KnowledgeEngine,
  MemoryEngine,
  PromptEngine,
  ToolEngine,
  WorkflowEngine,
  type TenantPack,
} from '@agent-platform/engines';

export interface PlatformServices {
  config: ConfigEngine;
  memory: MemoryEngine;
  intent: IntentEngine;
  knowledge: KnowledgeEngine;
  prompt: PromptEngine;
  ai: AiEngine;
  workflow: WorkflowEngine;
  tool: ToolEngine;
  escalation: EscalationEngine;
  analytics: AnalyticsEngine;
  env: NodeJS.ProcessEnv;
}

export interface TurnInput {
  tenantId: string;
  agentId: string;
  sessionId: string;
  message: string;
  actionId?: string;
  customerAuthToken?: string;
}

const DEFAULT_ACTIONS: ActionButton[] = [
  { id: 'quote.request', label: 'Get a quote' },
  { id: 'shipment.track', label: 'Track shipment' },
  { id: 'support.human', label: 'Talk to human' },
];

/** Common English words that must never be treated as tracking numbers. */
const TRACKING_STOPWORDS = new Set(
  [
    'shipment', 'shipping', 'services', 'service', 'tracking', 'package', 'packages',
    'container', 'freight', 'customs', 'document', 'documents', 'worldwide',
    'individual', 'business', 'customer', 'customer', 'destination', 'destinations',
    'quotation', 'quotations', 'acocam', 'trading', 'canada', 'africa', 'vehicle',
    'motorcycle', 'personal', 'effects', 'commercial', 'support', 'customer',
    
  ].map((w) => w.toLowerCase()),
);

/** Strict tracking refs: ACO-#### or alphanumeric tokens that contain a digit. */
const TRACKING_REF_RE =
  /\b(?:ACO[- ]?\d{4,}|(?=[A-Z0-9-]*\d)(?![A-Z]*$)[A-Z0-9-]{6,})\b/gi;

function extractTrackingNumber(message: string): string | undefined {
  const matches = message.match(TRACKING_REF_RE) ?? [];
  for (const raw of matches.reverse()) {
    const cleaned = raw.replace(/\s+/g, '').toUpperCase();
    if (TRACKING_STOPWORDS.has(cleaned.toLowerCase())) continue;
    if (!/\d/.test(cleaned)) continue;
    if (cleaned.length < 5) continue;
    return cleaned;
  }
  return undefined;
}

function looksLikeFaqQuestion(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m || m.length < 3) return false;
  if (m.includes('?')) return true;
  return /^(what|who|where|when|why|how|do you|does|can you|can i|is |are |which|tell me|explain|please tell)\b/.test(
    m,
  );
}

function looksLikeTransactional(message: string): boolean {
  const m = message.trim().toLowerCase();
  // "Can I track…?" / "Do you offer tracking?" are FAQ, not a track request
  if (
    /^(can i|do you|does|is it possible|how (can|do) i)\b/.test(m) &&
    /\b(track|tracking|book|booking|quote)\b/.test(m) &&
    !/\b(track now|track this|here is my|my (number|ref|awb|bol))\b/.test(m)
  ) {
    return false;
  }
  return /\b(book|get a quote|request a quote|need a quote|i want to ship|ship my|send my|track my|track now|track shipment|start a booking)\b/.test(
    m,
  );
}

function refusesSensitive(message: string, patterns: string[]): string | null {
  const lower = message.toLowerCase();
  for (const p of patterns) {
    if (lower.includes(p.toLowerCase())) {
      return 'For your security, please never share passwords, full card numbers, or government IDs in chat. A human agent can help via a secure channel.';
    }
  }
  return null;
}

export class ConversationPipeline {
  constructor(private readonly svc: PlatformServices) {}

  async handleTurn(input: TurnInput): Promise<TurnResponse> {
    const pack = await this.svc.config.load(input.tenantId);
    const agent = this.svc.config.getAgent(pack, input.agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${input.agentId}`);
    }

    const store = this.svc.memory.getStore();
    const session = await store.get(input.tenantId, input.sessionId);
    if (!session || session.agentId !== input.agentId) {
      throw new Error('Session not found');
    }

    const state: ConversationState = { ...session.state, slots: { ...session.state.slots } };
    state.turnCount += 1;

    const refusal = refusesSensitive(input.message, pack.policies.escalation.refusalPatterns);
    if (refusal) {
      return this.finish(pack, input, session.sessionId, state, {
        message: refusal,
        source: 'safety',
        intent: 'safety.refusal',
        confidence: 1,
        actions: DEFAULT_ACTIONS,
      });
    }

    // Active workflow continues until complete/cancelled — unless the user
    // clearly switches to a different transactional intent (e.g. book while tracking).
    if (state.workflow?.status === 'active') {
      const switchIntent =
        !input.actionId &&
        looksLikeTransactional(input.message) &&
        !extractTrackingNumber(input.message);
      if (switchIntent) {
        state.workflow = null;
        state.phase = 'idle';
        state.awaitingSlot = null;
      }
    }

    if (state.workflow?.status === 'active') {
      const def = pack.workflows[state.workflow.workflowId];
      if (def) {
        const userText =
          input.actionId === 'cancel' || input.actionId === 'reset' ? 'cancel' : input.message;
        const advanced = this.svc.workflow.advance(
          def,
          { ...state.workflow, data: { ...state.workflow.data } },
          userText,
        );
        state.workflow = advanced.progress;
        Object.assign(state.slots, advanced.progress.data);

        if (advanced.complete) {
          state.phase = advanced.progress.status === 'complete' ? 'ready' : 'idle';
          if (advanced.progress.status === 'complete' && def.onComplete?.action === 'tool' && def.onComplete.toolId) {
            const toolDef = pack.tools[def.onComplete.toolId];
            if (toolDef) {
              const toolResult = await this.svc.tool.execute(toolDef, {
                env: this.svc.env,
                customerAuthToken: input.customerAuthToken,
                slots: state.slots,
              });
              const toolMsg = this.svc.tool.formatResult(toolDef, toolResult, state.slots);
              state.workflow = null;
              state.activeIntent = def.intent;
              return this.finish(pack, input, session.sessionId, state, {
                message: `${advanced.message}\n\n${toolMsg}`,
                source: 'workflow+tool',
                intent: def.intent,
                confidence: 0.9,
                actions: DEFAULT_ACTIONS,
              });
            }
          }
          if (advanced.progress.status === 'complete' && def.onComplete?.action === 'escalation') {
            return this.escalateNow(pack, input, session, state, 'workflow_complete_escalation', advanced.message);
          }
          state.workflow = advanced.progress.status === 'complete' ? null : state.workflow;
          return this.finish(pack, input, session.sessionId, state, {
            message: advanced.message,
            source: 'workflow',
            intent: def.intent,
            confidence: 0.9,
            actions: DEFAULT_ACTIONS,
          });
        }

        state.phase = 'collecting';
        state.awaitingSlot = def.steps[advanced.progress.stepIndex]?.id ?? null;
        return this.finish(pack, input, session.sessionId, state, {
          message: advanced.message,
          source: 'workflow',
          intent: def.intent,
          confidence: 0.95,
          actions: [{ id: 'cancel', label: 'Cancel' }],
        });
      }
    }

    const detected = this.svc.intent.detect(input.message, pack.intents, input.actionId);
    const intentDef = this.svc.intent.find(pack.intents, detected.intent);

    // FAQ-style questions should hit the knowledge base first (unless user
    // clicked an action button or clearly asked to book/track).
    const preferKnowledge =
      !input.actionId &&
      looksLikeFaqQuestion(input.message) &&
      !looksLikeTransactional(input.message) &&
      (detected.handler === 'workflow' || detected.handler === 'tool');

    if (preferKnowledge) {
      const faqAnswer = await this.answerFromKnowledgePath(pack, input, session, state, {
        intent: detected.intent.startsWith('company.') ? detected.intent : 'company.about',
        confidence: Math.max(detected.confidence, 0.7),
      });
      if (faqAnswer) return faqAnswer;
      // Fall through to workflow/tool if KB had no confident hit
    }

    const escEarly = this.svc.escalation.detect({
      message: input.message,
      failureStreak: state.failureStreak,
      confidence: detected.confidence,
      confidenceThreshold: agent.confidenceThreshold,
      policy: pack.policies.escalation,
      intent: detected.intent,
    });

    if (escEarly.shouldEscalate && (escEarly.mode === 'transfer' || detected.handler === 'escalation')) {
      return this.escalateNow(pack, input, session, state, escEarly.primaryReason);
    }

    if (detected.handler === 'workflow' && intentDef?.workflowId && pack.workflows[intentDef.workflowId]) {
      const def = pack.workflows[intentDef.workflowId]!;
      const started = this.svc.workflow.start(def);
      state.workflow = started.progress;
      state.activeIntent = detected.intent;
      state.phase = 'collecting';
      state.awaitingSlot = def.steps[0]?.id ?? null;
      return this.finish(pack, input, session.sessionId, state, {
        message: started.message,
        source: 'workflow',
        intent: detected.intent,
        confidence: detected.confidence,
        actions: [{ id: 'cancel', label: 'Cancel' }],
      });
    }

    if (detected.handler === 'tool' && intentDef?.toolId && pack.tools[intentDef.toolId]) {
      const toolDef = pack.tools[intentDef.toolId]!;
      const extracted = extractTrackingNumber(input.message);
      if (extracted && !state.slots.trackingNumber) {
        state.slots.trackingNumber = extracted;
      }
      if (toolDef.pathParams?.includes('trackingNumber') && !state.slots.trackingNumber) {
        const trackWf =
          (intentDef.workflowId && pack.workflows[intentDef.workflowId]) ||
          Object.values(pack.workflows).find((w) => w.id.includes('track'));
        if (trackWf) {
          const started = this.svc.workflow.start(trackWf);
          state.workflow = started.progress;
          state.phase = 'collecting';
          state.activeIntent = detected.intent;
          return this.finish(pack, input, session.sessionId, state, {
            message: started.message,
            source: 'workflow',
            intent: detected.intent,
            confidence: detected.confidence,
            actions: [{ id: 'cancel', label: 'Cancel' }],
          });
        }
      }
      const toolResult = await this.svc.tool.execute(toolDef, {
        env: this.svc.env,
        customerAuthToken: input.customerAuthToken,
        slots: state.slots,
      });
      state.activeIntent = detected.intent;
      state.phase = 'ready';
      if (!toolResult.ok && !toolResult.authRequired) state.failureStreak += 1;
      else state.failureStreak = 0;
      return this.finish(pack, input, session.sessionId, state, {
        message: this.svc.tool.formatResult(toolDef, toolResult, state.slots),
        source: 'tool',
        intent: detected.intent,
        confidence: detected.confidence,
        actions: DEFAULT_ACTIONS,
      });
    }

    // Knowledge / conversational / fallback
    const knowledgeTurn = await this.answerFromKnowledgePath(pack, input, session, state, {
      intent: detected.intent,
      confidence: detected.confidence,
    });
    if (knowledgeTurn) return knowledgeTurn;

    return this.finish(pack, input, session.sessionId, state, {
      message:
        "I don't have enough information in the knowledge base to answer that confidently. Would you like me to connect you with a human agent?",
      source: 'fallback',
      intent: detected.intent,
      confidence: 0.2,
      actions: DEFAULT_ACTIONS,
    });
  }

  private async answerFromKnowledgePath(
    pack: TenantPack,
    input: TurnInput,
    session: { sessionId: string; messages: Array<{ role: string; content: string }> },
    state: ConversationState,
    detected: { intent: string; confidence: number },
  ): Promise<TurnResponse | null> {
    const agent = this.svc.config.getAgent(pack, input.agentId);
    if (!agent) return null;

    const hits = await this.svc.knowledge.search(input.tenantId, input.message, 4);
    if (!hits.length) return null;

    const history: LlmMessage[] = session.messages.slice(-8).map((m) => ({
      role: (m.role === 'system' || m.role === 'assistant' ? m.role : 'user') as LlmMessage['role'],
      content: m.content,
    }));
    const llmMessages = this.svc.prompt.compose({
      system: pack.prompts.system,
      safety: pack.prompts.safety,
      companyName: pack.settings.name,
      hits,
      history,
      userMessage: input.message,
    });

    const answer = await this.svc.ai.answerFromKnowledge(hits, input.message, llmMessages);
    if (answer.source === 'fallback') return null;

    state.activeIntent = detected.intent;
    state.phase = 'ready';

    if (answer.confidence < agent.confidenceThreshold || answer.source === 'fallback') {
      state.failureStreak += 1;
    } else {
      state.failureStreak = 0;
    }

    let message = answer.message;

    const escLate = this.svc.escalation.detect({
      message: input.message,
      failureStreak: state.failureStreak,
      confidence: answer.confidence,
      confidenceThreshold: agent.confidenceThreshold,
      policy: pack.policies.escalation,
      intent: detected.intent,
    });

    if (escLate.shouldEscalate && escLate.mode === 'offer') {
      message += `\n\n${pack.policies.escalation.offerPhrases[0] ?? 'Would you like a human agent?'}`;
    } else if (escLate.shouldEscalate && escLate.mode === 'transfer') {
      return this.escalateNow(pack, input, session, state, escLate.primaryReason, message);
    }

    return this.finish(pack, input, session.sessionId, state, {
      message,
      source: answer.source,
      intent: detected.intent,
      confidence: answer.confidence,
      actions: DEFAULT_ACTIONS,
      citations: answer.citations,
    });
  }

  private async escalateNow(
    pack: TenantPack,
    input: TurnInput,
    session: { sessionId: string; messages: Array<{ role: string; content: string }> },
    state: ConversationState,
    reason: string,
    preface?: string,
  ): Promise<TurnResponse> {
    const summary = this.svc.escalation.buildSummary(
      [...session.messages, { role: 'user', content: input.message }],
      reason,
    );
    const ticket = this.svc.escalation.createTicket({
      tenantId: input.tenantId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      reason,
      reasons: [reason],
      summary,
    });
    state.escalated = true;
    state.phase = 'escalated';
    state.lastEscalationReason = reason;
    state.workflow = null;
    const message = [
      preface,
      'I am connecting you with a human agent. A summary of this conversation has been prepared for them.',
      `Reference: ${ticket.id}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return this.finish(pack, input, session.sessionId, state, {
      message,
      source: 'escalation',
      intent: 'support.human',
      confidence: 1,
      actions: [{ id: 'reset', label: 'Start over' }],
      escalate: true,
      escalationId: ticket.id,
    });
  }

  private async finish(
    pack: TenantPack,
    input: TurnInput,
    sessionId: string,
    state: ConversationState,
    partial: {
      message: string;
      source: string;
      intent: string | null;
      confidence: number;
      actions: ActionButton[];
      citations?: TurnResponse['citations'];
      escalate?: boolean;
      escalationId?: string;
    },
  ): Promise<TurnResponse> {
    const store = this.svc.memory.getStore();
    const now = new Date().toISOString();
    await store.appendMessage(input.tenantId, sessionId, {
      role: 'user',
      content: input.message,
      at: now,
    });
    await store.appendMessage(input.tenantId, sessionId, {
      role: 'assistant',
      content: partial.message,
      at: now,
      meta: { source: partial.source, intent: partial.intent },
    });
    await store.updateState(input.tenantId, sessionId, state);

    this.svc.analytics.track({
      tenantId: input.tenantId,
      agentId: input.agentId,
      sessionId,
      type: 'message.turn',
      data: {
        intent: partial.intent,
        source: partial.source,
        confidence: partial.confidence,
        escalate: partial.escalate,
      },
    });

    return {
      ok: true,
      sessionId,
      message: partial.message,
      source: partial.source,
      intent: partial.intent,
      confidence: partial.confidence,
      actions: partial.actions,
      citations: partial.citations,
      disclaimer: null,
      escalate: partial.escalate,
      escalationId: partial.escalationId,
      conversation: state,
      slots: state.slots,
      awaiting: state.awaitingSlot,
      failureStreak: state.failureStreak,
    };
  }
}

export function publicActionsForTenant(_pack: TenantPack): ActionButton[] {
  return DEFAULT_ACTIONS;
}
