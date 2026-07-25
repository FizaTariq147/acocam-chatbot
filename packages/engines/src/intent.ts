import type { IntentDefinition, IntentResult } from '@agent-platform/domain';

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export class IntentEngine {
  detect(message: string, intents: IntentDefinition[], actionId?: string): IntentResult {
    if (actionId) {
      const byAction = intents.find((i) => i.code === actionId || i.workflowId === actionId || i.toolId === actionId);
      if (byAction) {
        return {
          intent: byAction.code,
          confidence: 0.99,
          secondary: [],
          handler: byAction.handler,
        };
      }
    }

    const text = normalize(message);
    const scored = intents
      .map((intent) => {
        let score = 0;
        for (const phrase of intent.phrases ?? []) {
          const p = normalize(phrase);
          if (!p) continue;
          if (text === p) score += 0.95;
          else if (text.includes(p)) score += 0.75;
        }
        for (const kw of intent.keywords ?? []) {
          const k = normalize(kw);
          if (k && text.includes(k)) score += 0.2;
        }
        for (const pat of intent.patterns ?? []) {
          try {
            if (new RegExp(pat, 'i').test(message)) score += 0.45;
          } catch {
            /* ignore bad patterns */
          }
        }
        return { intent, score: Math.min(1, score) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.intent.priority - a.intent.priority);

    if (!scored.length) {
      return { intent: 'fallback.unknown', confidence: 0.2, secondary: [], handler: 'fallback' };
    }

    const top = scored[0]!;
    return {
      intent: top.intent.code,
      confidence: top.score,
      secondary: scored.slice(1, 4).map((s) => s.intent.code),
      handler: top.intent.handler,
    };
  }

  find(intents: IntentDefinition[], code: string): IntentDefinition | undefined {
    return intents.find((i) => i.code === code);
  }
}
