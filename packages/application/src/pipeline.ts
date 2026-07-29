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
  acocamHumanFallback,
  loginPrompt,
  profileToWorkflowSlots,
  extractTrackingNumber,
  type PortalUrls,
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


function defaultActionsForUser(input: TurnInput): ActionButton[] {
  return [
    { id: 'quote.request', label: input.customerAuthToken ? 'Book shipment' : 'Get a quote' },
    { id: 'shipment.track', label: 'Track shipment' },
    { id: 'support.human', label: 'Talk to human' },
  ];
}

function tenantFeatures(pack: TenantPack) {
  const f = pack.settings.features ?? {};
  return {
    workflows: f.workflows !== false,
    tools: f.tools !== false,
    escalation: f.escalation !== false,
    streaming: f.streaming !== false,
  };
}

function resolveWorkflow(
  pack: TenantPack,
  input: TurnInput,
  workflowId: string,
): NonNullable<TenantPack['workflows'][string]> | undefined {
  if (
    input.customerAuthToken &&
    (workflowId === 'quote_request' || workflowId === 'book_shipment') &&
    pack.workflows['book_shipment']
  ) {
    return pack.workflows['book_shipment'];
  }
  return pack.workflows[workflowId];
}

function looksLikeFaqQuestion(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m || m.length < 2) return false;
  if (m.includes('?')) return true;
  return /^(what|who|where|when|why|how|do you|does|can you|can i|is |are |which|tell me|explain|please tell|i (have a|need a) question)\b/.test(
    m,
  );
}

function looksLikeGreeting(message: string): boolean {
  const m = message.trim().toLowerCase().replace(/[!.,]+$/g, '');
  if (!m || m.length > 80) return false;
  return /^(hi|hello|hey|hola|bonjour|good\s*(morning|afternoon|evening|day)|greetings|howdy|yo|salam|assalamu\s*alaikum|hiya|helo|hii+|helloo+)\b/.test(
    m,
  );
}

function looksLikeThanksOrBye(message: string): boolean {
  const m = message.trim().toLowerCase().replace(/[!.,]+$/g, '');
  return /^(thanks|thank you|thx|ty|bye|goodbye|see you|ok thanks|that('|’)s all|nothing else)\b/.test(m);
}

/** Short answers that look like workflow slot fills (name, email, phone, city). */
function looksLikeSlotFill(message: string): boolean {
  const m = message.trim();
  if (!m || m.includes('?')) return false;
  if (looksLikeGreeting(m) || looksLikeFaqQuestion(m) || looksLikeThanksOrBye(m)) return false;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) return true;
  if (/^\+?[\d\s().-]{7,}$/.test(m)) return true;
  // short plain text / "City, Country" — typical slot replies
  if (m.length <= 80 && !/\b(track|quote|book|ship|lcl|fcl|customs|price|cost|office|contact)\b/i.test(m)) {
    return true;
  }
  return false;
}

function looksLikeTopicChange(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) return false;
  if (looksLikeGreeting(m) || looksLikeThanksOrBye(m) || looksLikeFaqQuestion(m)) return true;
  if (/\b(actually|instead|by the way|btw|different (question|topic)|change (the )?topic|never ?mind|cancel)\b/.test(m)) {
    return true;
  }
  if (extractTrackingNumber(message)) return true;
  return looksLikeTransactional(m);
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

/** Short actionable words — route to intents, not the generic help prompt. */
const SHORT_ACTION_WORDS = new Set(['ok', 'okay', 'no', 'yes', 'y', 'n', 'quote', 'track', 'ship']);

/** Real short tokens — not random keyboard noise (SAA, ssaa, etc.). */
const SHORT_ALLOWED_WORDS = new Set([
  ...SHORT_ACTION_WORDS,
  'fcl',
  'lcl',
  'awb',
  'cbm',
  'eta',
  'bl',
  'hbl',
  'mbl',
  'kg',
  'lb',
  'what',
  'when',
  'where',
  'who',
  'why',
  'how',
  'can',
  'the',
  'for',
  'good',
  'day',
]);

const KEYBOARD_MASH_RE =
  /^(asdf|qwerty|qwertyuiop|zxcv|zxcvb|qwer|hjkl|jkl|fdsa|wasd|test|abc|xyz|xxx+|asdfgh|sdfgh|dfghj|fghjk|ghjkl)$/i;

function vowelRatio(text: string): number {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (!letters.length) return 0;
  const vowels = (letters.match(/[aeiouAEIOU]/g) ?? []).length;
  return vowels / letters.length;
}

function hasRepeatedLetterRuns(text: string): boolean {
  return /(.)\1/.test(text.toLowerCase());
}

function tokenLooksLikeGibberish(token: string): boolean {
  const t = token.trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (SHORT_ALLOWED_WORDS.has(lower)) return false;
  if (extractTrackingNumber(t)) return false;
  if (KEYBOARD_MASH_RE.test(lower)) return true;
  if (/^(\d)\1+$/.test(t) || /^([a-zA-Z])\1{2,}$/.test(t)) return true;
  if (/^\d+$/.test(t) && t.length < 6) return true;
  const lettersOnly = /^[a-zA-Z]+$/.test(t);
  if (lettersOnly && t.length >= 2 && t.length <= 5) {
    if (vowelRatio(t) === 0) return true;
    if (hasRepeatedLetterRuns(t)) return true;
    if (t.length <= 4) return true;
  }
  if (lettersOnly && t.length <= 12 && vowelRatio(t) === 0) return true;
  if (lettersOnly && t.length >= 6 && t.length <= 12 && vowelRatio(t) < 0.2) return true;
  if (/^[a-zA-Z0-9]+$/.test(t) && t.length <= 8 && vowelRatio(t) === 0) return true;
  return false;
}

function isNoiseMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  const lower = m.toLowerCase();
  if (SHORT_ACTION_WORDS.has(lower)) return false;
  if (extractTrackingNumber(m)) return false;
  if (looksLikeFaqQuestion(m) || looksLikeTransactional(m)) return false;
  if (!/[a-zA-Z0-9]/.test(m)) return true;

  const tokens = m.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return tokenLooksLikeGibberish(tokens[0]!);
  }
  if (tokens.length <= 4 && tokens.every(tokenLooksLikeGibberish)) {
    return true;
  }
  return false;
}

const GREETING_RE =
  /^(?:hi|hey|hello|hiya|yo|howdy|greetings|help|thanks|thank\s+you|good\s+(?:morning|afternoon|evening|day)|morning|afternoon|evening)(?:\s+there)?[!?.…]*$/i;

function isGreetingMessage(message: string): boolean {
  const m = message.trim().replace(/[!?.…]+$/g, '').trim();
  if (!m) return false;
  if (extractTrackingNumber(m)) return false;
  if (looksLikeTransactional(m) || looksLikeFaqQuestion(m)) return false;
  return GREETING_RE.test(m);
}

function helpPromptMessage(input: TurnInput): string {
  const bookOrQuote = input.customerAuthToken ? 'book a shipment' : 'get a quote';
  return [
    'How can I help you today?',
    '',
    `I can help you **${bookOrQuote}**, **track a shipment**, answer questions about ACOCAM services and destinations, or connect you with a human agent.`,
    '',
    'Choose an option below or type your question.',
  ].join('\n');
}

/** Formal reply when the user sends random / invalid characters. */
function noiseReplyMessage(): string {
  return [
    'I could not understand that message.',
    '',
    'Please enter a clear question in English — for example about shipping rates, tracking a shipment, requesting a quote, documents, or ACOCAM services.',
    '',
    'You may also use the buttons below, or type **talk to human** to speak with an ACOCAM agent.',
  ].join('\n');
}

function getPortalUrls(pack: TenantPack, env: NodeJS.ProcessEnv): PortalUrls {
  return {
    loginUrl:
      pack.settings.portal?.loginUrl ??
      env.ACOCAM_PORTAL_LOGIN_URL ??
      'https://acocamtrading.ca/login',
    signupUrl:
      pack.settings.portal?.signupUrl ??
      pack.settings.portal?.loginUrl ??
      env.ACOCAM_PORTAL_SIGNUP_URL ??
      env.ACOCAM_PORTAL_LOGIN_URL ??
      'https://acocamtrading.ca/login',
    quoteUrl:
      pack.settings.portal?.quoteUrl ??
      env.ACOCAM_PORTAL_QUOTE_URL ??
      'https://acocamtrading.ca/get-quote/',
  };
}

function quotePortalAction(portal: PortalUrls): ActionButton {
  return {
    id: 'portal.quote',
    label: 'Get a quote online',
    url: portal.quoteUrl ?? 'https://acocamtrading.ca/get-quote/',
  };
}

function loginActions(portal: PortalUrls): ActionButton[] {
  const sameAuthUrl = portal.signupUrl === portal.loginUrl;
  const authButtons: ActionButton[] = sameAuthUrl
    ? [{ id: 'portal.login', label: 'Log in / Create account', url: portal.loginUrl }]
    : [
        { id: 'portal.login', label: 'Log in', url: portal.loginUrl },
        { id: 'portal.signup', label: 'Create account', url: portal.signupUrl },
      ];
  return [
    ...authButtons,
    quotePortalAction(portal),
    { id: 'support.human', label: 'Talk to human' },
  ];
}

function toolContext(
  pack: TenantPack,
  svc: PlatformServices,
  input: TurnInput,
  slots?: Record<string, string>,
) {
  return {
    env: svc.env,
    apiBaseUrl: pack.settings.apiBaseUrl,
    customerAuthToken: input.customerAuthToken,
    slots,
    portal: getPortalUrls(pack, svc.env),
  };
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
    const features = tenantFeatures(pack);

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
        actions: defaultActionsForUser(input),
      });
    }

    if (
      !input.actionId &&
      state.workflow?.status !== 'active' &&
      isNoiseMessage(input.message)
    ) {
      return this.finish(pack, input, session.sessionId, state, {
        message: noiseReplyMessage(),
        source: 'prompt',
        intent: 'support.clarify',
        confidence: 1,
        actions: defaultActionsForUser(input),
      });
    }

    if (
      !input.actionId &&
      state.workflow?.status !== 'active' &&
      isGreetingMessage(input.message)
    ) {
      return this.finish(pack, input, session.sessionId, state, {
        message: helpPromptMessage(input),
        source: 'prompt',
        intent: 'support.help',
        confidence: 1,
        actions: defaultActionsForUser(input),
      });
    }

    // Active workflow continues until complete/cancelled — unless the user
    // greets, asks a FAQ, or clearly switches topic (not a slot fill).
    if (state.workflow?.status === 'active' && !input.actionId) {
      const topicChange =
        looksLikeTopicChange(input.message) && !looksLikeSlotFill(input.message);
      if (topicChange) {
        state.workflow = null;
        state.phase = 'idle';
        state.awaitingSlot = null;
        state.activeIntent = null;
      }
    }

    if (state.workflow?.status === 'active' && features.workflows) {
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
              const ctx = toolContext(pack, this.svc, input, state.slots);
              const toolResult = await this.svc.tool.execute(toolDef, ctx);
              const toolMsg = this.svc.tool.formatResult(toolDef, toolResult, ctx);
              const portal = getPortalUrls(pack, this.svc.env);
              state.workflow = null;
              state.activeIntent = def.intent;
              return this.finish(pack, input, session.sessionId, state, {
                message: `${advanced.message}\n\n${toolMsg}`,
                source: 'workflow+tool',
                intent: def.intent,
                confidence: 0.9,
                actions: toolResult.authRequired ? loginActions(portal) : defaultActionsForUser(input),
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
            actions: defaultActionsForUser(input),
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

    // FAQ / greetings / thanks should hit the knowledge base first (unless user
    // clicked an action button or clearly asked to book/track).
    const preferKnowledge =
      !input.actionId &&
      (looksLikeFaqQuestion(input.message) ||
        looksLikeGreeting(input.message) ||
        looksLikeThanksOrBye(input.message)) &&
      !looksLikeTransactional(input.message) &&
      (detected.handler === 'workflow' ||
        detected.handler === 'tool' ||
        detected.handler === 'fallback' ||
        detected.handler === 'knowledge' ||
        looksLikeGreeting(input.message) ||
        looksLikeThanksOrBye(input.message));

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
      agentFailureThreshold: agent.escalationFailureThreshold,
    });

    if (
      features.escalation &&
      escEarly.shouldEscalate &&
      (escEarly.mode === 'transfer' || detected.handler === 'escalation')
    ) {
      return this.escalateNow(pack, input, session, state, escEarly.primaryReason);
    }

    if (detected.handler === 'workflow' && features.workflows && intentDef?.workflowId) {
      const def = resolveWorkflow(pack, input, intentDef.workflowId);
      if (def) {
        return this.startWorkflow(pack, input, session.sessionId, state, def, detected.intent, detected.confidence);
      }
    }

    if (detected.handler === 'tool' && features.tools && intentDef?.toolId && pack.tools[intentDef.toolId]) {
      const toolDef = pack.tools[intentDef.toolId]!;
      if (toolDef.requireAuth && !input.customerAuthToken) {
        const portal = getPortalUrls(pack, this.svc.env);
        return this.finish(pack, input, session.sessionId, state, {
          message: loginPrompt(portal),
          source: 'auth',
          intent: detected.intent,
          confidence: detected.confidence,
          actions: loginActions(portal),
        });
      }
      const extracted = extractTrackingNumber(input.message);
      if (extracted && !state.slots.trackingNumber) {
        state.slots.trackingNumber = extracted;
      }
      if (toolDef.pathParams?.includes('trackingNumber') && !state.slots.trackingNumber) {
        const trackWf =
          (intentDef.workflowId && pack.workflows[intentDef.workflowId]) ||
          Object.values(pack.workflows).find((w) => w.id.includes('track'));
        if (trackWf) {
          return this.startWorkflow(
            pack,
            input,
            session.sessionId,
            state,
            trackWf,
            detected.intent,
            detected.confidence,
          );
        }
      }
      const ctx = toolContext(pack, this.svc, input, state.slots);
      const toolResult = await this.svc.tool.execute(toolDef, ctx);
      state.activeIntent = detected.intent;
      state.phase = 'ready';
      if (!toolResult.ok && !toolResult.authRequired) state.failureStreak += 1;
      else state.failureStreak = 0;
      const portal = getPortalUrls(pack, this.svc.env);
      return this.finish(pack, input, session.sessionId, state, {
        message: this.svc.tool.formatResult(toolDef, toolResult, ctx),
        source: 'tool',
        intent: detected.intent,
        confidence: detected.confidence,
        actions: toolResult.authRequired ? loginActions(portal) : defaultActionsForUser(input),
      });
    }

    // Knowledge / conversational / fallback — always give a helpful ACOCAM reply
    const knowledgeTurn = await this.answerFromKnowledgePath(pack, input, session, state, {
      intent: detected.intent,
      confidence: detected.confidence,
    });
    if (knowledgeTurn) return knowledgeTurn;

    return this.finish(pack, input, session.sessionId, state, {
      message: acocamHumanFallback(input.message),
      source: 'assistant',
      intent: detected.intent,
      confidence: 0.6,
      actions: defaultActionsForUser(input),
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
    const features = tenantFeatures(pack);

    const hits = await this.svc.knowledge.search(input.tenantId, input.message, 4);

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

    const answer = await this.svc.ai.answerFromKnowledge(hits, input.message, llmMessages, {
      agent,
      customerName: state.slots.contact_name,
      priorIntent: state.activeIntent,
    });

    state.activeIntent = detected.intent;
    state.phase = 'ready';

    if (answer.confidence < agent.confidenceThreshold) {
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
      agentFailureThreshold: agent.escalationFailureThreshold,
    });

    if (features.escalation && escLate.shouldEscalate && escLate.mode === 'offer') {
      message += `\n\n${pack.policies.escalation.offerPhrases[0] ?? 'Would you like a human agent?'}`;
    } else if (features.escalation && escLate.shouldEscalate && escLate.mode === 'transfer') {
      return this.escalateNow(pack, input, session, state, escLate.primaryReason, message);
    }

    return this.finish(pack, input, session.sessionId, state, {
      message,
      source: answer.source,
      intent: detected.intent,
      confidence: answer.confidence,
      actions: defaultActionsForUser(input),
      citations: answer.citations,
    });
  }

  private async resolveCustomerProfile(
    pack: TenantPack,
    input: TurnInput,
  ): Promise<{ slots: Record<string, string>; authRequired: boolean }> {
    if (!input.customerAuthToken) return { slots: {}, authRequired: false };
    const profileTool = pack.tools['get_profile'];
    if (!profileTool) return { slots: {}, authRequired: false };

    const result = await this.svc.tool.execute(profileTool, toolContext(pack, this.svc, input));
    if (result.authRequired || result.httpStatus === 401 || result.httpStatus === 403) {
      return { slots: {}, authRequired: true };
    }
    if (!result.ok) return { slots: {}, authRequired: false };
    return { slots: profileToWorkflowSlots(result.data), authRequired: false };
  }

  private async startWorkflow(
    pack: TenantPack,
    input: TurnInput,
    sessionId: string,
    state: ConversationState,
    def: NonNullable<TenantPack['workflows'][string]>,
    intent: string,
    confidence: number,
  ): Promise<TurnResponse> {
    const portal = getPortalUrls(pack, this.svc.env);
    if (def.id === 'book_shipment') {
      state.slots.bookingIntent = 'true';
    }
    if (def.requireAuth && !input.customerAuthToken) {
      return this.finish(pack, input, sessionId, state, {
        message: loginPrompt(portal),
        source: 'auth',
        intent,
        confidence,
        actions: loginActions(portal),
      });
    }

    let prefill = { ...state.slots };
    if (def.requireAuth && input.customerAuthToken) {
      const profile = await this.resolveCustomerProfile(pack, input);
      if (profile.authRequired) {
        return this.finish(pack, input, sessionId, state, {
          message: loginPrompt(portal),
          source: 'auth',
          intent,
          confidence,
          actions: loginActions(portal),
        });
      }
      prefill = { ...prefill, ...profile.slots };
    }

    const started = this.svc.workflow.startWithPrefill(def, prefill);
    state.workflow = started.progress;
    state.activeIntent = intent;
    state.phase = started.progress.status === 'complete' ? 'ready' : 'collecting';
    state.awaitingSlot =
      started.progress.status === 'complete'
        ? null
        : (def.steps[started.progress.stepIndex]?.id ?? null);
    Object.assign(state.slots, started.progress.data);

    if (started.progress.status === 'complete' && def.onComplete?.action === 'tool' && def.onComplete.toolId) {
      const toolDef = pack.tools[def.onComplete.toolId];
      if (toolDef) {
        const ctx = toolContext(pack, this.svc, input, state.slots);
        const toolResult = await this.svc.tool.execute(toolDef, ctx);
        const toolMsg = this.svc.tool.formatResult(toolDef, toolResult, ctx);
        state.workflow = null;
        return this.finish(pack, input, sessionId, state, {
          message: `${started.message}\n\n${toolMsg}`,
          source: 'workflow+tool',
          intent,
          confidence: 0.9,
          actions: toolResult.authRequired ? loginActions(portal) : defaultActionsForUser(input),
        });
      }
    }

    return this.finish(pack, input, sessionId, state, {
      message: started.message,
      source: 'workflow',
      intent,
      confidence,
      actions: [{ id: 'cancel', label: 'Cancel' }],
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

export function publicActionsForTenant(
  pack: TenantPack,
  env: NodeJS.ProcessEnv = process.env,
): ActionButton[] {
  const portal = getPortalUrls(pack, env);
  const sameAuthUrl = portal.signupUrl === portal.loginUrl;
  const authButtons: ActionButton[] = sameAuthUrl
    ? [{ id: 'portal.login', label: 'Log in / Create account', url: portal.loginUrl }]
    : [
        { id: 'portal.login', label: 'Log in', url: portal.loginUrl },
        { id: 'portal.signup', label: 'Sign up', url: portal.signupUrl },
      ];
  return [
    { id: 'quote.request', label: 'Get a quote' },
    { id: 'shipment.track', label: 'Track shipment' },
    ...authButtons,
    quotePortalAction(portal),
    { id: 'support.human', label: 'Talk to human' },
  ];
}
