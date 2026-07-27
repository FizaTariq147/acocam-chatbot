export type IntentHandler =
  | 'knowledge'
  | 'workflow'
  | 'tool'
  | 'conversational'
  | 'escalation'
  | 'fallback';

export interface IntentDefinition {
  code: string;
  label: string;
  priority: number;
  phrases: string[];
  keywords: string[];
  patterns?: string[];
  handler: IntentHandler;
  workflowId?: string;
  toolId?: string;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  secondary: string[];
  handler: IntentHandler;
}

export interface WorkflowStep {
  id: string;
  prompt: string;
  required?: boolean;
  validator?: 'text' | 'email' | 'phone' | 'choice' | 'number' | 'tracking_ref';
  help?: string;
  choices?: string[];
}

export interface WorkflowDefinition {
  id: string;
  intent: string;
  label: string;
  intro: string;
  steps: WorkflowStep[];
  completionMessage: string;
  /** When true, workflow/API submission needs a signed-in customer JWT. */
  requireAuth?: boolean;
  onComplete?: { action: 'tool' | 'escalation' | 'none'; toolId?: string };
}

export interface WorkflowProgress {
  workflowId: string;
  intent: string;
  status: 'active' | 'complete' | 'cancelled';
  stepIndex: number;
  data: Record<string, string>;
  lastError?: string | null;
}

export interface ToolDefinition {
  id: string;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  baseUrlEnv?: string;
  requireAuth?: boolean;
  inputFrom?: Record<string, string>;
  pathParams?: string[];
  /** Nested POST body: leaf values are slot keys. */
  bodyFrom?: Record<string, unknown>;
}

export interface ThemeConfig {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  position: 'bottom-right' | 'bottom-left';
  launcherLabel: string;
  darkMode?: boolean;
  logoUrl?: string;
}

export interface AgentSettings {
  id: string;
  name: string;
  welcome: string;
  defaultLanguage: string;
  confidenceThreshold: number;
  escalationFailureThreshold: number;
  aiProvider?: string;
  aiModel?: string;
}

export interface TenantPortalConfig {
  loginUrl: string;
  signupUrl: string;
  quoteUrl?: string;
}

export interface TenantSettings {
  tenantId: string;
  name: string;
  publishableKey: string;
  secretKey: string;
  agents: AgentSettings[];
  portal?: TenantPortalConfig;
  features?: {
    workflows?: boolean;
    tools?: boolean;
    escalation?: boolean;
    streaming?: boolean;
  };
}

export interface BrandingPack {
  theme: ThemeConfig;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  heading: string;
  content: string;
  score: number;
  confidence: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: string;
  meta?: Record<string, unknown>;
}

export interface ConversationState {
  phase: 'idle' | 'collecting' | 'ready' | 'escalated';
  activeIntent: string | null;
  slots: Record<string, string>;
  awaitingSlot: string | null;
  workflow: WorkflowProgress | null;
  failureStreak: number;
  turnCount: number;
  escalated: boolean;
  lastEscalationReason?: string | null;
}

export interface SessionRecord {
  sessionId: string;
  tenantId: string;
  agentId: string;
  messages: ChatMessage[];
  state: ConversationState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ActionButton {
  id: string;
  label: string;
  url?: string;
}

export interface TurnResponse {
  ok: boolean;
  sessionId: string;
  message: string;
  source: string;
  intent: string | null;
  confidence: number;
  actions: ActionButton[];
  citations?: Array<{ id: string; title: string; score: number }>;
  disclaimer?: string | null;
  escalate?: boolean;
  escalationId?: string;
  conversation: ConversationState;
  slots?: Record<string, string>;
  awaiting?: string | null;
  failureStreak?: number;
}

export interface PublicAgentConfig {
  tenantId: string;
  agentId: string;
  name: string;
  welcome: string;
  theme: ThemeConfig;
  actions: ActionButton[];
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  ok: boolean;
  content: string;
  provider: string;
  error?: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  httpStatus?: number;
  authRequired?: boolean;
}

export interface EscalationDecision {
  shouldEscalate: boolean;
  mode: 'none' | 'offer' | 'workflow' | 'transfer';
  reasons: string[];
  primaryReason: string;
}

export function emptyConversationState(): ConversationState {
  return {
    phase: 'idle',
    activeIntent: null,
    slots: {},
    awaitingSlot: null,
    workflow: null,
    failureStreak: 0,
    turnCount: 0,
    escalated: false,
    lastEscalationReason: null,
  };
}
