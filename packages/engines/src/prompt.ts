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
        'Speak like a warm, knowledgeable ACOCAM human agent: clear, confident, and concise.',
        'Never say you lack information in a knowledge base, database, or training data.',
        'If the snippets are thin, still give helpful ACOCAM guidance and invite the user to share details or talk to a human.',
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
