import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  AiEngine,
  AnalyticsEngine,
  AuthEngine,
  ConfigEngine,
  EscalationEngine,
  IntentEngine,
  KnowledgeEngine,
  LexicalKnowledgeIndex,
  MemoryEngine,
  PromptEngine,
  RateLimiter,
  RedisMemoryStore,
  ToolEngine,
  WorkflowEngine,
  createAiProviderFromEnv,
} from '@agent-platform/engines';
import { ConversationPipeline, publicActionsForTenant } from '@agent-platform/application';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export function createPlatform() {
  const tenantsDir = process.env.TENANTS_DIR
    ? path.resolve(process.cwd(), process.env.TENANTS_DIR)
    : path.join(repoRoot, 'tenants');
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.cwd(), process.env.DATA_DIR)
    : path.join(repoRoot, 'data');

  const config = new ConfigEngine(tenantsDir);
  const auth = new AuthEngine();
  const memory = new MemoryEngine(new RedisMemoryStore(process.env.REDIS_URL));
  const intent = new IntentEngine();
  const knowledge = new KnowledgeEngine(new LexicalKnowledgeIndex(), dataDir);
  const prompt = new PromptEngine();
  const ai = new AiEngine(createAiProviderFromEnv(process.env));
  const workflow = new WorkflowEngine();
  const tool = new ToolEngine();
  const escalation = new EscalationEngine();
  const analytics = new AnalyticsEngine();
  const rateLimiter = new RateLimiter(Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60));

  const pipeline = new ConversationPipeline({
    config,
    memory,
    intent,
    knowledge,
    prompt,
    ai,
    workflow,
    tool,
    escalation,
    analytics,
    env: process.env,
  });

  return {
    tenantsDir,
    dataDir,
    config,
    auth,
    memory,
    knowledge,
    escalation,
    analytics,
    rateLimiter,
    pipeline,
    publicActionsForTenant,
  };
}

export type Platform = ReturnType<typeof createPlatform>;
