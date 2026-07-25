import type { KnowledgeHit, LlmMessage } from '@agent-platform/domain';

export class PromptEngine {
  compose(opts: {
    system: string;
    safety: string;
    companyName: string;
    hits: KnowledgeHit[];
    history: LlmMessage[];
    userMessage: string;
  }): LlmMessage[] {
    const snippets = opts.hits
      .map((h, i) => `[${i + 1}] ${h.heading}\n${h.content.slice(0, 1200)}`)
      .join('\n\n');

    const system: LlmMessage = {
      role: 'system',
      content: [
        opts.system,
        '',
        `Company: ${opts.companyName}`,
        opts.safety,
        '',
        'Use only the knowledge snippets below. If insufficient, say you do not have that information and offer human help.',
        'Never invent prices, tracking status, quotas, or account details.',
        '',
        'Knowledge snippets:',
        snippets || '(none)',
      ].join('\n'),
    };

    const history = opts.history.slice(-8);
    return [system, ...history, { role: 'user', content: opts.userMessage }];
  }
}
