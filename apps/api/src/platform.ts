import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { promises as fs } from 'node:fs';

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

  ToolEngine,

  WorkflowEngine,

  createAiProviderFromEnv,

  createMemoryStore,

} from '@agent-platform/engines';

import { ConversationPipeline, publicActionsForTenant } from '@agent-platform/application';



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, '../../..');



// Prefer repo-root .env (monorepo), then cwd — npm workspace may run with apps/api as cwd.

dotenv.config({ path: path.join(repoRoot, '.env') });

dotenv.config({ path: path.resolve(process.cwd(), '.env') });



export async function bootstrapKnowledge(

  config: ConfigEngine,

  knowledge: KnowledgeEngine,

  tenantsDir: string,

): Promise<void> {

  const force = process.env.FORCE_REINDEX === 'true';

  let tenantIds: string[] = [];

  try {

    const entries = await fs.readdir(tenantsDir, { withFileTypes: true });

    tenantIds = entries.filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);

  } catch {

    tenantIds = ['acocam'];

  }



  for (const tenantId of tenantIds) {

    try {

      const loaded = force ? false : await knowledge.loadPersistedIndex(tenantId);

      if (loaded && process.env.CONFIG_DEBUG !== 'false') {

        console.info(`[knowledge] loaded persisted index for ${tenantId}`);

      }

      if (!loaded || force) {

        const pack = await config.load(tenantId);

        await knowledge.reindexTenant(tenantId, pack.knowledgeDir);

        console.info(`[knowledge] reindexed ${tenantId}`);

      }

    } catch (err) {

      console.warn(`[knowledge] bootstrap skipped for ${tenantId}:`, err instanceof Error ? err.message : err);

    }

  }

}



export function createPlatform() {

  const tenantsDir = process.env.TENANTS_DIR

    ? path.resolve(repoRoot, process.env.TENANTS_DIR)

    : path.join(repoRoot, 'tenants');

  const dataDir = process.env.DATA_DIR

    ? path.resolve(repoRoot, process.env.DATA_DIR)

    : path.join(repoRoot, 'data');



  const config = new ConfigEngine(tenantsDir);

  const auth = new AuthEngine();

  const memory = new MemoryEngine(createMemoryStore(process.env, dataDir));

  const intent = new IntentEngine();

  const knowledgeIndex = new LexicalKnowledgeIndex();

  const knowledge = new KnowledgeEngine(knowledgeIndex, dataDir);

  const prompt = new PromptEngine();

  const ai = new AiEngine(createAiProviderFromEnv(process.env), process.env);

  const workflow = new WorkflowEngine();

  const tool = new ToolEngine();

  const escalation = new EscalationEngine(dataDir);

  const analytics = new AnalyticsEngine(dataDir);

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

    knowledgeIndex,

    escalation,

    analytics,

    rateLimiter,

    pipeline,

    publicActionsForTenant,

  };

}



export type Platform = ReturnType<typeof createPlatform>;


