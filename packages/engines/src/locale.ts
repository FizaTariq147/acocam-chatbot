import type { AgentSettings, TenantSettings } from '@agent-platform/domain';
import type { TenantPack } from './config.js';

export type SupportedLang = 'en' | 'fr';

const SUPPORTED = new Set<string>(['en', 'fr']);

/** Normalize a language code to a supported value (defaults to English). */
export function normalizeLanguage(lang: string | undefined | null): SupportedLang {
  const code = (lang ?? 'en').trim().toLowerCase().split(/[-_]/)[0] ?? 'en';
  return SUPPORTED.has(code) ? (code as SupportedLang) : 'en';
}

export function agentSupportsLanguage(agent: AgentSettings, lang: SupportedLang): boolean {
  const list = agent.supportedLanguages;
  if (!list?.length) return lang === normalizeLanguage(agent.defaultLanguage);
  return list.map((l) => normalizeLanguage(l)).includes(lang);
}

export function resolveSessionLanguage(
  pack: TenantPack,
  agent: AgentSettings,
  requested?: string | null,
  stored?: string | null,
): SupportedLang {
  const candidates = [requested, stored, agent.defaultLanguage, 'en'];
  for (const c of candidates) {
    const lang = normalizeLanguage(c);
    if (agentSupportsLanguage(agent, lang)) return lang;
  }
  return 'en';
}

/** French conversational / logistics cues in user text (accent-insensitive). */
const FR_MESSAGE_RE =
  /\b(bonjour|salut|bonsoir|merci|au revoir|a bientot|devis|expedier|expédier|expedition|expédition|envoi|envoyer|suivre|suivi|parler|agent|francais|français|comment|pourquoi|quels|quelles|puis je|pouvez|avez vous|combien|ou est|adresse|courriel|telephone|téléphone|ca va|ça va|allez vous|comment allez|comment ca va|comment ça va|je voudrais|je veux|est ce que|qu est ce|quels services|obtenir un|demander un|réserver|réserver|reserver|reservation|réservation|colis|marchandise|cargaison|conteneur|douane|cameroon|cameroun|moncton|acocam)\b/i;

/** Infer language from message when session/widget did not set French explicitly. */
export function detectLanguageFromMessage(message: string): SupportedLang | null {
  const m = message.trim();
  if (!m || m.length < 2) return null;
  const norm = m
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (FR_MESSAGE_RE.test(norm)) return 'fr';
  if (/^(hi|hello|hey|thanks|thank you|bye|goodbye|good morning|good afternoon)\b/i.test(norm)) {
    return 'en';
  }
  return null;
}

/** Resolve language: explicit request → stored session → message detection → agent default. */
export function resolveTurnLanguage(
  pack: TenantPack,
  agent: AgentSettings,
  message: string,
  requested?: string | null,
  stored?: string | null,
): SupportedLang {
  if (requested?.trim()) {
    const lang = normalizeLanguage(requested);
    if (agentSupportsLanguage(agent, lang)) return lang;
  }
  if (stored?.trim()) {
    const lang = normalizeLanguage(stored);
    if (agentSupportsLanguage(agent, lang)) return lang;
  }
  const fromMessage = detectLanguageFromMessage(message);
  if (fromMessage && agentSupportsLanguage(agent, fromMessage)) return fromMessage;
  return resolveSessionLanguage(pack, agent, null, stored);
}

export function welcomeForLanguage(agent: AgentSettings, lang: SupportedLang): string {
  const byLang = agent.welcomeByLanguage;
  if (byLang?.[lang]?.trim()) return byLang[lang]!.trim();
  return agent.welcome;
}

export function localeString(
  pack: TenantPack,
  lang: SupportedLang,
  key: string,
  fallback: string,
): string {
  const table = pack.locales[lang] ?? pack.locales.en;
  return table?.[key]?.trim() || pack.locales.en?.[key]?.trim() || fallback;
}

export function promptsForLanguage(
  pack: TenantPack,
  lang: SupportedLang,
): { system: string; safety: string } {
  if (lang === 'fr' && pack.promptsByLang?.fr) {
    return {
      system: pack.promptsByLang.fr.system || pack.prompts.system,
      safety: pack.promptsByLang.fr.safety || pack.prompts.safety,
    };
  }
  return pack.prompts;
}

export function workflowsForLanguage(
  pack: TenantPack,
  lang: SupportedLang,
): Record<string, import('@agent-platform/domain').WorkflowDefinition> {
  if (lang === 'fr' && pack.workflowsByLang?.fr && Object.keys(pack.workflowsByLang.fr).length) {
    return { ...pack.workflows, ...pack.workflowsByLang.fr };
  }
  return pack.workflows;
}

export function supportedLanguagesForAgent(agent: AgentSettings): SupportedLang[] {
  const list = agent.supportedLanguages?.map((l) => normalizeLanguage(l)).filter((l) => SUPPORTED.has(l));
  if (list?.length) return [...new Set(list)] as SupportedLang[];
  return [normalizeLanguage(agent.defaultLanguage)];
}

export function uiStringsForLanguage(
  pack: TenantPack,
  lang: SupportedLang,
): Record<string, string> {
  const keys = [
    'inputPlaceholder',
    'sendLabel',
    'closeLabel',
    'dismissLabel',
    'thinkingLabel',
    'teaserAssist',
    'teaserIntro',
    'actionQuoteAuth',
    'langEnglish',
    'langEnglishShort',
    'langFrench',
    'langFrenchShort',
    'langMenuLabel',
    'errorGeneric',
    'launcherLabel',
  ] as const;
  const out: Record<string, string> = {};
  for (const key of keys) {
    out[key] = localeString(pack, lang, `ui.${key}`, '');
  }
  return out;
}
