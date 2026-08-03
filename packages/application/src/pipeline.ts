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
  acocamHumanFallbackLocalized,
  loginPrompt,
  accountSignupGuide,
  profileToWorkflowSlots,
  extractTrackingNumber,
  localeString,
  promptsForLanguage,
  resolveTurnLanguage,
  workflowsForLanguage,
  type PortalUrls,
  type SupportedLang,
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
  /** Requested conversation language (en | fr). Falls back to session or agent default. */
  language?: string;
}


function defaultActionsForUser(input: TurnInput, pack: TenantPack, lang: SupportedLang): ActionButton[] {
  const quoteLabel = input.customerAuthToken
    ? localeString(pack, lang, 'action.quoteAuth', 'Book shipment')
    : localeString(pack, lang, 'action.quote', 'Get a quote');
  return [
    { id: 'quote.request', label: quoteLabel },
    { id: 'shipment.track', label: localeString(pack, lang, 'action.track', 'Track shipment') },
    { id: 'support.human', label: localeString(pack, lang, 'action.human', 'Talk to human') },
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
  lang: SupportedLang,
): NonNullable<TenantPack['workflows'][string]> | undefined {
  const wfs = workflowsForLanguage(pack, lang);
  if (
    input.customerAuthToken &&
    (workflowId === 'quote_request' || workflowId === 'book_shipment') &&
    wfs['book_shipment']
  ) {
    return wfs['book_shipment'];
  }
  return wfs[workflowId];
}

/** Greeting small-talk — not a logistics FAQ even with "?". */
function looksLikeConversationalSmallTalk(message: string): boolean {
  const m = normalizeShortMessage(message)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return /^(how are you|how r u|how are u|how s it going|how is it going|how do you do|hope you re doing well|hope you're doing well|comment ca va|comment ça va|comment allez vous|comment vas tu|comment va tu|ca va|ça va|what s up|whats up|sup|vous allez bien|comment ca va aujourd hui)\b/.test(
    m,
  );
}

function looksLikeFaqQuestion(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m || m.length < 2) return false;
  if (looksLikeConversationalSmallTalk(message)) return false;
  if (m.includes('?')) return true;
  return /^(what|who|where|when|why|how|do you|does|can you|can i|is |are |which|tell me|explain|please tell|i (have a|need a) question|quoi|qui|où|comment|pourquoi|estce|puisje|pouvez|avez|faites|dites|expliquez|je (veux|voudrais) savoir)\b/.test(
    m,
  );
}

function looksLikeGreeting(message: string): boolean {
  const m = normalizeShortMessage(message);
  if (!m || m.length > 80) return false;
  const norm = m.normalize('NFD').replace(/\p{M}/gu, '');
  return /^(hi|hello|hey|hola|bonjour|salut|bonsoir|coucou|allo|allô|bonne journee|bonne journée|good\s*(morning|afternoon|evening|day)|greetings|howdy|yo|salam|assalamu\s*alaikum|hiya|helo|hii+|helloo+|comment ca va|comment allez vous|ca va|hi there|hello there|nice to meet|pleased to meet|good to see|are you there|anyone there|enchanté|enchantee|ravi de vous parler)\b/.test(
    norm,
  );
}

function looksLikeThanksOrBye(message: string): boolean {
  return looksLikeThanksOnly(message) || looksLikeGoodbye(message);
}

function normalizeShortMessage(message: string): string {
  return message.trim().toLowerCase().replace(/[!?.…]+$/g, '').trim();
}

/** Thanks without goodbye — e.g. "thank you", "thanks". */
function looksLikeThanksOnly(message: string): boolean {
  const m = normalizeShortMessage(message);
  if (!m || looksLikeGoodbye(message)) return false;
  return /^(thanks|thank you|thx|ty|much appreciated|appreciate it|ok thanks|merci|merci beaucoup)\b/.test(m);
}

/** Goodbye — including "thank you bye", "byee", "thanks bye". */
function looksLikeGoodbye(message: string): boolean {
  const m = normalizeShortMessage(message);
  if (!m) return false;
  if (/^(bye+|goodbye+|see you|see ya|good night|take care|that('|’)s all|nothing else|au revoir|a bientot|à bientôt|bonne nuit|bonne journée)\b/.test(m)) {
    return true;
  }
  return /\b(bye|goodbye|au revoir)\b/.test(m);
}

/** Hi / hello / good morning — not thanks or bye. */
function isPureGreetingMessage(message: string): boolean {
  const m = normalizeShortMessage(message);
  if (!m || extractTrackingNumber(m)) return false;
  if (looksLikeTransactional(m) || looksLikeFaqQuestion(m)) return false;
  if (looksLikeThanksOnly(message) || looksLikeGoodbye(message)) return false;
  if (looksLikeConversationalSmallTalk(message)) return false;
  if (looksLikeGreeting(m)) return true;
  const norm = m.normalize('NFD').replace(/\p{M}/gu, '');
  return /^(hi|hey|hello|hiya|yo|howdy|greetings|help|good\s+(?:morning|afternoon|evening|day)|morning|afternoon|evening|bonjour|salut|bonsoir|coucou|allo|allô|aide|hi there|hello there)\b/.test(
    norm,
  );
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
  return /\b(book|get a quote|request a quote|need a quote|i want to ship|ship my|send my|track my|track now|track shipment|start a booking|réserver|devis|expédier|envoyer|suivre mon|suivi|je veux expédier|demander un devis|obtenir un devis)\b/.test(
    m,
  );
}

/** Short actionable words — route to intents, not the generic help prompt. */
const SHORT_ACTION_WORDS = new Set(['ok', 'okay', 'no', 'yes', 'y', 'n', 'quote', 'track', 'ship']);

/** Real short tokens — not random keyboard noise (SAA, ssaa, etc.). */
const SHORT_ALLOWED_WORDS = new Set([
  ...SHORT_ACTION_WORDS,
  'hi',
  'hey',
  'hello',
  'hiya',
  'yo',
  'hola',
  'bye',
  'byee',
  'thanks',
  'thx',
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
    if (hasRepeatedLetterRuns(t) && t.length <= 4) return true;
  }
  if (lettersOnly && t.length <= 12 && vowelRatio(t) === 0) return true;
  if (lettersOnly && t.length >= 6 && t.length <= 12 && vowelRatio(t) < 0.2) return true;
  if (/^[a-zA-Z0-9]+$/.test(t) && t.length <= 8 && vowelRatio(t) === 0) return true;
  return false;
}

function isNoiseMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return true;
  if (
    isPureGreetingMessage(m) ||
    looksLikeThanksOnly(m) ||
    looksLikeGoodbye(m)
  ) {
    return false;
  }
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

function thanksReplyMessage(pack: TenantPack, lang: SupportedLang): string {
  return localeString(
    pack,
    lang,
    'thanksReply',
    "You're welcome!\n\nIf you need anything else — tracking, a quote, or service information — just ask.\nHave a great day.",
  );
}

function goodbyeReplyMessage(pack: TenantPack, lang: SupportedLang, thanksIncluded: boolean): string {
  const key = thanksIncluded ? 'goodbyeThanksReply' : 'goodbyeReply';
  return localeString(
    pack,
    lang,
    key,
    thanksIncluded
      ? "You're welcome — goodbye!\n\nThank you for contacting ACOCAM Trading Inc."
      : 'Goodbye!\n\nThank you for contacting ACOCAM Trading Inc.',
  );
}

function helpPromptMessage(input: TurnInput, pack: TenantPack, lang: SupportedLang): string {
  const bookOrQuote = input.customerAuthToken
    ? localeString(pack, lang, 'helpBookOrQuoteAuth', 'book a shipment')
    : localeString(pack, lang, 'helpBookOrQuoteGuest', 'get a quote');
  const template = localeString(
    pack,
    lang,
    'helpPrompt',
    'How can I help you today?\n\nI can help you **{{bookOrQuote}}**, **track a shipment**, answer questions about ACOCAM services and destinations, or connect you with a human agent.\n\nChoose an option below or type your question.',
  );
  return template.replace('{{bookOrQuote}}', bookOrQuote);
}

function noiseReplyMessage(pack: TenantPack, lang: SupportedLang): string {
  return localeString(
    pack,
    lang,
    'noiseReply',
    'I could not understand that message.\n\nPlease enter a clear question in English or French.',
  );
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

function quotePortalAction(portal: PortalUrls, pack: TenantPack, lang: SupportedLang): ActionButton {
  return {
    id: 'portal.quote',
    label: localeString(pack, lang, 'action.quoteOnline', 'Get a quote online'),
    url: portal.quoteUrl ?? 'https://acocamtrading.ca/get-quote/',
  };
}

function loginActions(portal: PortalUrls, pack: TenantPack, lang: SupportedLang): ActionButton[] {
  const sameAuthUrl = portal.signupUrl === portal.loginUrl;
  const authButtons: ActionButton[] = sameAuthUrl
    ? [{ id: 'portal.login', label: localeString(pack, lang, 'action.loginCombined', 'Log in / Create account'), url: portal.loginUrl }]
    : [
        { id: 'portal.login', label: localeString(pack, lang, 'action.login', 'Log in'), url: portal.loginUrl },
        { id: 'portal.signup', label: localeString(pack, lang, 'action.signup', 'Create account'), url: portal.signupUrl },
      ];
  return [
    ...authButtons,
    quotePortalAction(portal, pack, lang),
    { id: 'support.human', label: localeString(pack, lang, 'action.human', 'Talk to human') },
  ];
}

function toolContext(
  pack: TenantPack,
  svc: PlatformServices,
  input: TurnInput,
  slots: Record<string, string> | undefined,
  lang: SupportedLang,
) {
  return {
    env: svc.env,
    apiBaseUrl: pack.settings.apiBaseUrl,
    customerAuthToken: input.customerAuthToken,
    slots,
    portal: getPortalUrls(pack, svc.env),
    language: lang,
    locale: pack.locales[lang] ?? pack.locales.en ?? {},
  };
}

function looksLikeAccountHelp(message: string): boolean {
  const m = message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!m) return false;
  if (/\b(my account|account details|account status|delete account|close account|mon compte|details du compte)\b/.test(m)) {
    return false;
  }
  return /\b(create (an? )?account|sign[\s-]?up|register(ation)?|open (an? )?account|make (an? )?account|need (an? )?account|get (an? )?account|how (?:do|can|should|to) i (?:create|sign[\s-]?up|register|log[\s-]?in|login)|how to (?:create|sign[\s-]?up|register|log[\s-]?in|login)|how (?:do|can|should) i (?:log[\s-]?in|login)|log[\s-]?in (?:help|page|link)|login (?:help|page|link)|creer un compte|creer mon compte|comment creer (?:un )?compte|inscription|sinscrire|s inscrire|me connecter|comment me connecter|ouvrir un compte|connexion au compte)\b/.test(
    m,
  );
}

function loginPromptForLang(pack: TenantPack, portal: PortalUrls, lang: SupportedLang): string {
  return loginPrompt(portal, pack.locales[lang] ?? pack.locales.en);
}

function accountHelpMessage(pack: TenantPack, portal: PortalUrls, lang: SupportedLang): string {
  return accountSignupGuide(portal, pack.locales[lang] ?? pack.locales.en);
}

function refusesSensitive(message: string, patterns: string[], pack: TenantPack, lang: SupportedLang): string | null {
  const lower = message.toLowerCase();
  for (const p of patterns) {
    if (lower.includes(p.toLowerCase())) {
      return localeString(
        pack,
        lang,
        'safety.refusal',
        'For your security, please never share passwords, full card numbers, or government IDs in chat. A human agent can help via a secure channel.',
      );
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
    const lang = resolveTurnLanguage(pack, agent, input.message, input.language, state.language);
    state.language = lang;

    const refusal = refusesSensitive(input.message, pack.policies.escalation.refusalPatterns, pack, lang);
    if (refusal) {
      return this.finish(pack, input, session.sessionId, state, {
        message: refusal,
        source: 'safety',
        intent: 'safety.refusal',
        confidence: 1,
        actions: defaultActionsForUser(input, pack, lang),
      });
    }

    if (!input.actionId && state.workflow?.status !== 'active') {
      if (looksLikeGoodbye(input.message)) {
        const thanksIncluded = /\b(thank|thanks|thx|ty|merci)\b/i.test(input.message);
        return this.finish(pack, input, session.sessionId, state, {
          message: goodbyeReplyMessage(pack, lang, thanksIncluded),
          source: 'prompt',
          intent: 'conversational.goodbye',
          confidence: 1,
          actions: defaultActionsForUser(input, pack, lang),
        });
      }
      if (looksLikeThanksOnly(input.message)) {
        return this.finish(pack, input, session.sessionId, state, {
          message: thanksReplyMessage(pack, lang),
          source: 'prompt',
          intent: 'conversational.thanks',
          confidence: 1,
          actions: defaultActionsForUser(input, pack, lang),
        });
      }
      if (isPureGreetingMessage(input.message)) {
        return this.finish(pack, input, session.sessionId, state, {
          message: helpPromptMessage(input, pack, lang),
          source: 'prompt',
          intent: 'support.help',
          confidence: 1,
          actions: defaultActionsForUser(input, pack, lang),
        });
      }
      if (looksLikeAccountHelp(input.message)) {
        const portal = getPortalUrls(pack, this.svc.env);
        return this.finish(pack, input, session.sessionId, state, {
          message: accountHelpMessage(pack, portal, lang),
          source: 'auth',
          intent: 'account.signup',
          confidence: 1,
          actions: loginActions(portal, pack, lang),
        });
      }
    }

    if (
      !input.actionId &&
      state.workflow?.status !== 'active' &&
      isNoiseMessage(input.message)
    ) {
      return this.finish(pack, input, session.sessionId, state, {
        message: noiseReplyMessage(pack, lang),
        source: 'prompt',
        intent: 'support.clarify',
        confidence: 1,
        actions: defaultActionsForUser(input, pack, lang),
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
      const wfs = workflowsForLanguage(pack, lang);
      const def = wfs[state.workflow.workflowId];
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
              const ctx = toolContext(pack, this.svc, input, state.slots, lang);
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
                actions: toolResult.authRequired ? loginActions(portal, pack, lang) : defaultActionsForUser(input, pack, lang),
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
            actions: defaultActionsForUser(input, pack, lang),
          });
        }

        state.phase = 'collecting';
        state.awaitingSlot = def.steps[advanced.progress.stepIndex]?.id ?? null;
        return this.finish(pack, input, session.sessionId, state, {
          message: advanced.message,
          source: 'workflow',
          intent: def.intent,
          confidence: 0.95,
          actions: [{ id: 'cancel', label: localeString(pack, lang, 'action.cancel', 'Cancel') }],
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
        looksLikeConversationalSmallTalk(input.message) ||
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
      const def = resolveWorkflow(pack, input, intentDef.workflowId, lang);
      if (def) {
        return this.startWorkflow(pack, input, session.sessionId, state, def, detected.intent, detected.confidence);
      }
    }

    if (detected.handler === 'tool' && features.tools && intentDef?.toolId && pack.tools[intentDef.toolId]) {
      const toolDef = pack.tools[intentDef.toolId]!;
      if (toolDef.requireAuth && !input.customerAuthToken) {
        const portal = getPortalUrls(pack, this.svc.env);
        return this.finish(pack, input, session.sessionId, state, {
          message: loginPromptForLang(pack, portal, lang),
          source: 'auth',
          intent: detected.intent,
          confidence: detected.confidence,
          actions: loginActions(portal, pack, lang),
        });
      }
      const extracted = extractTrackingNumber(input.message);
      if (extracted && !state.slots.trackingNumber) {
        state.slots.trackingNumber = extracted;
      }
      if (toolDef.pathParams?.includes('trackingNumber') && !state.slots.trackingNumber) {
        const wfs = workflowsForLanguage(pack, lang);
        const trackWf =
          (intentDef.workflowId && wfs[intentDef.workflowId]) ||
          Object.values(wfs).find((w) => w.id.includes('track'));
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
      const ctx = toolContext(pack, this.svc, input, state.slots, lang);
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
        actions: toolResult.authRequired ? loginActions(portal, pack, lang) : defaultActionsForUser(input, pack, lang),
      });
    }

    // Knowledge / conversational / fallback — always give a helpful ACOCAM reply
    const knowledgeTurn = await this.answerFromKnowledgePath(pack, input, session, state, {
      intent: detected.intent,
      confidence: detected.confidence,
    });
    if (knowledgeTurn) return knowledgeTurn;

    return this.finish(pack, input, session.sessionId, state, {
      message: acocamHumanFallbackLocalized(input.message, lang),
      source: 'assistant',
      intent: detected.intent,
      confidence: 0.6,
      actions: defaultActionsForUser(input, pack, lang),
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
    const lang = resolveTurnLanguage(pack, agent, input.message, input.language, state.language);
    state.language = lang;

    const hits = await this.svc.knowledge.search(input.tenantId, input.message, 4, lang);
    if (!hits.length) return null;

    const history: LlmMessage[] = session.messages.slice(-8).map((m) => ({
      role: (m.role === 'system' || m.role === 'assistant' ? m.role : 'user') as LlmMessage['role'],
      content: m.content,
    }));
    const promptBundle = promptsForLanguage(pack, lang);
    const llmMessages = this.svc.prompt.compose({
      system: promptBundle.system,
      safety: promptBundle.safety,
      companyName: pack.settings.name,
      hits,
      history,
      userMessage: input.message,
    });

    const answer = await this.svc.ai.answerFromKnowledge(hits, input.message, llmMessages, {
      agent,
      customerName: state.slots.contact_name,
      priorIntent: state.activeIntent,
      language: lang,
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
      message += `\n\n${localeString(pack, lang, 'escalation.offer', pack.policies.escalation.offerPhrases[0] ?? 'Would you like a human agent?')}`;
    } else if (features.escalation && escLate.shouldEscalate && escLate.mode === 'transfer') {
      return this.escalateNow(pack, input, session, state, escLate.primaryReason, message);
    }

    return this.finish(pack, input, session.sessionId, state, {
      message,
      source: answer.source,
      intent: detected.intent,
      confidence: answer.confidence,
      actions: defaultActionsForUser(input, pack, lang),
      citations: answer.citations,
    });
  }

  private async resolveCustomerProfile(
    pack: TenantPack,
    input: TurnInput,
    lang: SupportedLang,
  ): Promise<{ slots: Record<string, string>; authRequired: boolean }> {
    if (!input.customerAuthToken) return { slots: {}, authRequired: false };
    const profileTool = pack.tools['get_profile'];
    if (!profileTool) return { slots: {}, authRequired: false };

    const result = await this.svc.tool.execute(profileTool, toolContext(pack, this.svc, input, undefined, lang));
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
    const lang = resolveTurnLanguage(
      pack,
      this.svc.config.getAgent(pack, input.agentId)!,
      input.message,
      input.language,
      state.language,
    );
    state.language = lang;
    if (def.id === 'book_shipment') {
      state.slots.bookingIntent = 'true';
    }
    if (def.requireAuth && !input.customerAuthToken) {
      return this.finish(pack, input, sessionId, state, {
        message: loginPromptForLang(pack, portal, lang),
        source: 'auth',
        intent,
        confidence,
        actions: loginActions(portal, pack, lang),
      });
    }

    let prefill = { ...state.slots };
    if (def.requireAuth && input.customerAuthToken) {
      const profile = await this.resolveCustomerProfile(pack, input, lang);
      if (profile.authRequired) {
        return this.finish(pack, input, sessionId, state, {
          message: loginPromptForLang(pack, portal, lang),
          source: 'auth',
          intent,
          confidence,
          actions: loginActions(portal, pack, lang),
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
        const ctx = toolContext(pack, this.svc, input, state.slots, lang);
        const toolResult = await this.svc.tool.execute(toolDef, ctx);
        const toolMsg = this.svc.tool.formatResult(toolDef, toolResult, ctx);
        state.workflow = null;
        return this.finish(pack, input, sessionId, state, {
          message: `${started.message}\n\n${toolMsg}`,
          source: 'workflow+tool',
          intent,
          confidence: 0.9,
          actions: toolResult.authRequired ? loginActions(portal, pack, lang) : defaultActionsForUser(input, pack, lang),
        });
      }
    }

    return this.finish(pack, input, sessionId, state, {
      message: started.message,
      source: 'workflow',
      intent,
      confidence,
      actions: [{ id: 'cancel', label: localeString(pack, lang, 'action.cancel', 'Cancel') }],
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
    const agent = this.svc.config.getAgent(pack, input.agentId)!;
    const lang = resolveTurnLanguage(
      pack,
      agent,
      input.message,
      input.language,
      state.language,
    );
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
      localeString(
        pack,
        lang,
        'escalation.connecting',
        'I am connecting you with a human agent. A summary of this conversation has been prepared for them.',
      ),
      localeString(pack, lang, 'escalation.reference', 'Reference: {{id}}').replace('{{id}}', ticket.id),
    ]
      .filter(Boolean)
      .join('\n\n');

    return this.finish(pack, input, session.sessionId, state, {
      message,
      source: 'escalation',
      intent: 'support.human',
      confidence: 1,
      actions: [{ id: 'reset', label: localeString(pack, lang, 'action.reset', 'Start over') }],
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
  lang: SupportedLang = 'en',
): ActionButton[] {
  const portal = getPortalUrls(pack, env);
  const sameAuthUrl = portal.signupUrl === portal.loginUrl;
  const authButtons: ActionButton[] = sameAuthUrl
    ? [{ id: 'portal.login', label: localeString(pack, lang, 'action.loginCombined', 'Log in / Create account'), url: portal.loginUrl }]
    : [
        { id: 'portal.login', label: localeString(pack, lang, 'action.login', 'Log in'), url: portal.loginUrl },
        { id: 'portal.signup', label: localeString(pack, lang, 'action.signup', 'Sign up'), url: portal.signupUrl },
      ];
  return [
    { id: 'quote.request', label: localeString(pack, lang, 'action.quote', 'Get a quote') },
    { id: 'shipment.track', label: localeString(pack, lang, 'action.track', 'Track shipment') },
    ...authButtons,
    quotePortalAction(portal, pack, lang),
    { id: 'support.human', label: localeString(pack, lang, 'action.human', 'Talk to human') },
  ];
}
