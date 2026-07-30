import type {
  AgentSettings,
  BrandingPack,
  IntentDefinition,
  TenantSettings,
  ThemeConfig,
  ToolDefinition,
  WorkflowDefinition,
} from '@agent-platform/domain';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sanitizeTenantId } from './security.js';

export interface TenantPack {
  settings: TenantSettings;
  theme: ThemeConfig;
  intents: IntentDefinition[];
  workflows: Record<string, WorkflowDefinition>;
  tools: Record<string, ToolDefinition>;
  prompts: {
    system: string;
    safety: string;
  };
  policies: {
    escalation: EscalationPolicy;
  };
  knowledgeDir: string;
  rootDir: string;
}

export interface EscalationPolicy {
  softTriggers: string[];
  hardTriggers: string[];
  failureThreshold: number;
  offerPhrases: string[];
  refusalPatterns: string[];
}

const cache = new Map<string, TenantPack>();

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if (process.env.CONFIG_DEBUG === 'true') {
      console.warn('[config] read failed:', filePath, err instanceof Error ? err.message : err);
    }
    return fallback;
  }
}

async function readText(filePath: string, fallback = ''): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function loadWorkflows(dir: string): Promise<Record<string, WorkflowDefinition>> {
  const out: Record<string, WorkflowDefinition> = {};
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const def = await readJson<WorkflowDefinition | null>(path.join(dir, file), null);
      if (def?.id) out[def.id] = def;
    }
  } catch {
    /* empty */
  }
  return out;
}

async function loadTools(dir: string): Promise<Record<string, ToolDefinition>> {
  const out: Record<string, ToolDefinition> = {};
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const def = await readJson<ToolDefinition | null>(path.join(dir, file), null);
      if (def?.id) out[def.id] = def;
    }
  } catch {
    /* empty */
  }
  return out;
}

function resolveTenantKeys(tenantId: string, settings: TenantSettings): TenantSettings {
  const prefix = tenantId.toUpperCase().replace(/-/g, '_');
  const env = process.env;
  return {
    ...settings,
    publishableKey:
      env[`${prefix}_PUBLISHABLE_KEY`]?.trim() ||
      env.TENANT_PUBLISHABLE_KEY?.trim() ||
      settings.publishableKey,
    secretKey:
      env[`${prefix}_SECRET_KEY`]?.trim() ||
      env.TENANT_SECRET_KEY?.trim() ||
      settings.secretKey,
    apiBaseUrl:
      env[`${prefix}_API_BASE_URL`]?.trim() ||
      env.ACOCAM_API_BASE_URL?.trim() ||
      settings.apiBaseUrl,
  };
}

function validatePack(pack: TenantPack): void {
  const warnings: string[] = [];
  if (!pack.settings.publishableKey) warnings.push('missing publishableKey');
  if (!pack.intents.length) warnings.push('no intents loaded');
  if (!Object.keys(pack.workflows).length) warnings.push('no workflows loaded');
  if (warnings.length && process.env.CONFIG_DEBUG !== 'false') {
    console.warn(`[config] ${pack.settings.tenantId}:`, warnings.join(', '));
  }
}

export class ConfigEngine {
  constructor(private readonly tenantsRoot: string) {}

  clearCache(tenantId?: string): void {
    if (tenantId) cache.delete(tenantId);
    else cache.clear();
  }

  async load(tenantId: string): Promise<TenantPack> {
    const safeId = sanitizeTenantId(tenantId);
    if (!safeId) throw new Error(`Invalid tenant id: ${tenantId}`);

    const cached = cache.get(safeId);
    if (cached) return cached;

    const rootDir = path.join(this.tenantsRoot, safeId);
    const rawSettings = await readJson<TenantSettings>(path.join(rootDir, 'settings.json'), {
      tenantId: safeId,
      name: safeId,
      publishableKey: '',
      secretKey: '',
      agents: [],
    });
    const settings = resolveTenantKeys(safeId, rawSettings);

    const branding = await readJson<BrandingPack>(path.join(rootDir, 'branding', 'theme.json'), {
      theme: {
        primaryColor: '#0f766e',
        secondaryColor: '#134e4a',
        backgroundColor: '#ffffff',
        textColor: '#0f172a',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        position: 'bottom-right',
        launcherLabel: 'Chat',
      },
    });

    const intentsFile = await readJson<{ intents?: IntentDefinition[] } | IntentDefinition[]>(
      path.join(rootDir, 'intents', 'intents.json'),
      { intents: [] },
    );
    const intents = Array.isArray(intentsFile) ? intentsFile : intentsFile.intents ?? [];

    const pack: TenantPack = {
      settings,
      theme: branding.theme,
      intents,
      workflows: await loadWorkflows(path.join(rootDir, 'workflows')),
      tools: await loadTools(path.join(rootDir, 'tools')),
      prompts: {
        system: await readText(path.join(rootDir, 'prompts', 'system.md'), 'You are a helpful assistant.'),
        safety: await readText(
          path.join(rootDir, 'prompts', 'safety.md'),
          'Never invent prices, tracking numbers, or account data.',
        ),
      },
      policies: {
        escalation: await readJson<EscalationPolicy>(path.join(rootDir, 'policies', 'escalation.json'), {
          softTriggers: ['speak to human', 'talk to agent', 'real person'],
          hardTriggers: ['complaint', 'legal', 'refund'],
          failureThreshold: 2,
          offerPhrases: ['Would you like me to connect you with a human agent?'],
          refusalPatterns: ['password', 'credit card', 'ssn'],
        }),
      },
      knowledgeDir: path.join(rootDir, 'knowledge'),
      rootDir,
    };

    cache.set(safeId, pack);
    validatePack(pack);
    return pack;
  }

  getAgent(pack: TenantPack, agentId: string): AgentSettings | undefined {
    return pack.settings.agents.find((a) => a.id === agentId);
  }
}
