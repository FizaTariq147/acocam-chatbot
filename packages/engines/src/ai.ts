import type { AgentSettings, KnowledgeHit, LlmMessage, LlmResult } from '@agent-platform/domain';
import { acocamHumanFallback, acocamHumanFallbackLocalized, humanizeRetrievedAnswer } from './response-style.js';

export interface AiProvider {
  readonly name: string;
  complete(messages: LlmMessage[]): Promise<LlmResult>;
}

export class NullAiProvider implements AiProvider {
  readonly name = 'null';

  async complete(messages: LlmMessage[]): Promise<LlmResult> {
    const user = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return {
      ok: true,
      content: acocamHumanFallback(user),
      provider: this.name,
    };
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    name = 'openai-compatible',
    private readonly timeoutMs = 12_000,
  ) {
    this.name = name;
  }

  async complete(messages: LlmMessage[]): Promise<LlmResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.2,
          max_tokens: 700,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, content: '', provider: this.name, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim() ?? '';
      return { ok: Boolean(content), content, provider: this.name };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        content: '',
        provider: this.name,
        error: aborted
          ? `LLM timed out after ${this.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : 'LLM request failed',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function formatHitAnswer(hit: KnowledgeHit): string {
  const text = hit.content.trim();
  const qa = text.match(/^Q:\s*[\s\S]+?\n\nA:\s*([\s\S]+)$/i);
  if (qa?.[1]) return qa[1].trim();
  return text.replace(/^#+\s.*\n/, '').trim();
}

export class AiEngine {
  constructor(
    private provider: AiProvider,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  setProvider(provider: AiProvider): void {
    this.provider = provider;
  }

  providerForAgent(agent?: AgentSettings): AiProvider {
    return agent ? createAiProviderFromEnv(this.env, agent) : this.provider;
  }

  async answerFromKnowledge(
    hits: KnowledgeHit[],
    userMessage: string,
    llmMessages?: LlmMessage[],
    opts?: {
      agent?: AgentSettings;
      customerName?: string;
      priorIntent?: string | null;
      language?: string;
    },
  ): Promise<{
    message: string;
    source: string;
    confidence: number;
    citations: Array<{ id: string; title: string; score: number }>;
  }> {
    if (!hits.length) {
      const fallback = acocamHumanFallbackLocalized(userMessage, opts?.language ?? 'en');
      return {
        message: opts?.customerName ? `${opts.customerName} — ${fallback}` : fallback,
        source: 'assistant',
        confidence: 0.62,
        citations: [],
      };
    }

    const top = hits[0]!;
    const citations = hits.slice(0, 3).map((h) => ({ id: h.id, title: h.heading || h.title, score: h.score }));

    const provider = this.providerForAgent(opts?.agent);
    const useLocalModel =
      provider.name === 'local-finetuned' ||
      provider.name === 'openai-compatible';

    // Strong KB hit → answer from knowledge directly (fast + accurate for FAQ).
    // Local model is only used for weaker paraphrases.
    const strongHit = top.score >= 5 || top.confidence >= 0.8;

    const normalizeForCompare = (text: string): string => {
      return text
        .toLowerCase()
        .replace(/^q\d+\.\s*/i, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const userNorm = normalizeForCompare(userMessage);
    const topNorm = normalizeForCompare(top.heading || top.title || '');
    const exactQuestionMatch = Boolean(userNorm && topNorm && userNorm === topNorm);

    // If the user phrasing exactly matches the stored FAQ question, return the
    // KB answer (most reliable). Otherwise humanize slightly for a natural feel.
    if (!useLocalModel || !llmMessages || (strongHit && exactQuestionMatch)) {
      const primary = formatHitAnswer(top);
      const extras = hits
        .slice(1, 2)
        .map((h) => formatHitAnswer(h))
        .filter((a) => a && a !== primary && a.length < 600);
      let message = primary.slice(0, 1500);
      if (extras.length && primary.length < 400) {
        message = `${message}\n\n${extras[0]!.slice(0, 500)}`;
      }
      if (message.length >= 1500) message += '…';
      if (!exactQuestionMatch) {
        message = humanizeRetrievedAnswer(message, userMessage, opts);
      } else if (opts?.customerName) {
        message = `${opts.customerName} — ${message}`;
      }
      return {
        message,
        source: 'knowledge',
        confidence: Math.max(top.confidence, strongHit ? 0.75 : 0.55),
        citations,
      };
    }

    const result = await provider.complete(llmMessages);
    if (!result.ok || !result.content) {
      return {
        message: humanizeRetrievedAnswer(formatHitAnswer(top).slice(0, 1200), userMessage, opts),
        source: 'knowledge',
        confidence: top.confidence,
        citations,
      };
    }

    return {
      message: result.content,
      source: 'local-model+knowledge',
      confidence: Math.max(top.confidence, 0.75),
      citations,
    };
  }
}

export function createAiProviderFromEnv(env: NodeJS.ProcessEnv, agent?: AgentSettings): AiProvider {
  const provider = (agent?.aiProvider ?? env.AI_PROVIDER ?? 'null').toLowerCase();
  const model = agent?.aiModel ?? env.AI_MODEL ?? 'acocam-lora';

  // Local fine-tuned model served on your machine (no cloud LLM API).
  if (provider === 'local' || provider === 'local-finetuned') {
    return new OpenAiCompatibleProvider(
      env.AI_API_KEY || 'local',
      env.AI_BASE_URL ?? 'http://127.0.0.1:8090/v1',
      model,
      'local-finetuned',
    );
  }

  if (provider === 'openai' || provider === 'openai-compatible') {
    const key = env.AI_API_KEY ?? '';
    if (!key) return new NullAiProvider();
    return new OpenAiCompatibleProvider(
      key,
      env.AI_BASE_URL ?? 'https://api.openai.com/v1',
      model,
    );
  }
  return new NullAiProvider();
}
