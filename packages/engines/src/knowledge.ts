import type { KnowledgeHit } from '@agent-platform/domain';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface KnowledgeChunk {
  id: string;
  tenantId: string;
  title: string;
  heading: string;
  content: string;
  tokens: string[];
  kind?: 'qa' | 'section';
  question?: string;
}

export interface VectorSearchPort {
  upsert(tenantId: string, chunks: KnowledgeChunk[]): Promise<void>;
  search(tenantId: string, query: string, limit: number): Promise<KnowledgeHit[]>;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const t of a) if (setB.has(t)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

/** Lexical MVP index; VectorSearchPort reserved for Phase 3 embeddings. */
export class LexicalKnowledgeIndex implements VectorSearchPort {
  private readonly byTenant = new Map<string, KnowledgeChunk[]>();

  async upsert(tenantId: string, chunks: KnowledgeChunk[]): Promise<void> {
    this.byTenant.set(tenantId, chunks);
  }

  async search(tenantId: string, query: string, limit: number): Promise<KnowledgeHit[]> {
    const chunks = this.byTenant.get(tenantId) ?? [];
    const qTokens = tokenize(query);
    if (!qTokens.length || !chunks.length) return [];
    const qNorm = normalizeQuestion(query);

    const scored = chunks
      .map((chunk) => {
        let score = 0;
        for (const t of qTokens) {
          if (chunk.tokens.includes(t)) score += 1;
        }
        if (chunk.title.toLowerCase().includes(query.toLowerCase())) score += 2;
        if (chunk.heading.toLowerCase().includes(query.toLowerCase())) score += 1.5;

        if (chunk.kind === 'qa' && chunk.question) {
          const qToks = tokenize(chunk.question);
          score += jaccard(qTokens, qToks) * 12;
          const qn = normalizeQuestion(chunk.question);
          if (qn === qNorm) score += 20;
          else if (qn.includes(qNorm) || qNorm.includes(qn)) score += 10;
        }

        return { chunk, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const max = scored[0]?.score ?? 1;
    return scored.map(({ chunk, score }) => ({
      id: chunk.id,
      title: chunk.title,
      heading: chunk.heading,
      content: chunk.content,
      score,
      confidence: Math.min(0.99, 0.4 + (score / max) * 0.55),
    }));
  }
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/^q\d+\.\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract discrete Qn / answer pairs from ACOCAM-style knowledge markdown. */
export function extractQaPairs(md: string): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];
  const lines = md.split(/\r?\n/);
  let currentQ: string | null = null;
  let answerLines: string[] = [];

  const flush = () => {
    if (!currentQ) return;
    const answer = answerLines.join('\n').trim();
    if (answer.length >= 20) {
      pairs.push({ question: currentQ, answer });
    }
    currentQ = null;
    answerLines = [];
  };

  for (const line of lines) {
    const qm = line.match(/^Q\d+\.\s*(.+)\s*$/i);
    if (qm) {
      flush();
      currentQ = qm[1]!.trim();
      continue;
    }
    if (currentQ) {
      if (/^#{1,3}\s/.test(line) || /^Q\d+\.\s*/i.test(line)) {
        flush();
        if (/^#{1,3}\s/.test(line)) continue;
      }
      answerLines.push(line);
    }
  }
  flush();
  return pairs;
}

function splitMarkdown(md: string, tenantId: string, fileName: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let title = fileName.replace(/\.md$/i, '');

  // Prefer discrete Q&A chunks so every catalog question is answerable.
  for (const pair of extractQaPairs(md)) {
    const content = `Q: ${pair.question}\n\nA: ${pair.answer}`;
    const id = createHash('sha1')
      .update(`${tenantId}:${fileName}:qa:${pair.question}`)
      .digest('hex')
      .slice(0, 16);
    chunks.push({
      id,
      tenantId,
      title,
      heading: pair.question,
      content: content.slice(0, 4000),
      tokens: tokenize(`${pair.question} ${pair.answer}`),
      kind: 'qa',
      question: pair.question,
    });
  }

  const sections = md.split(/\n(?=#{1,3}\s)/);
  for (const section of sections) {
    const lines = section.trim().split('\n');
    if (!lines.length) continue;
    const first = lines[0] ?? '';
    let heading = first.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim() || title;
    if (/^#\s/.test(first)) title = heading;
    const content = section.trim();
    if (content.length < 80) continue;

    // Skip pure Q&A sections already covered as pairs (heuristic).
    if (/^Q\d+\./m.test(content) && extractQaPairs(content).length > 0) {
      continue;
    }

    const pieces =
      content.length > 3500
        ? content.match(/[\s\S]{1,3000}(?=\n|$)/g) ?? [content]
        : [content];

    pieces.forEach((piece, idx) => {
      const id = createHash('sha1')
        .update(`${tenantId}:${fileName}:${heading}:${idx}:${piece.slice(0, 80)}`)
        .digest('hex')
        .slice(0, 16);
      chunks.push({
        id,
        tenantId,
        title,
        heading: idx === 0 ? heading : `${heading} (cont.)`,
        content: piece.slice(0, 4000),
        tokens: tokenize(piece),
        kind: 'section',
      });
    });
  }
  return chunks;
}

export class KnowledgeEngine {
  constructor(
    private readonly index: VectorSearchPort,
    private readonly dataDir: string,
  ) {}

  async reindexTenant(tenantId: string, knowledgeDir: string): Promise<{ chunks: number; qaPairs: number }> {
    const files = await listMarkdown(knowledgeDir);
    const all: KnowledgeChunk[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      all.push(...splitMarkdown(raw, tenantId, path.basename(file)));
    }
    await this.index.upsert(tenantId, all);
    await fs.mkdir(path.join(this.dataDir, 'indexes'), { recursive: true });
    const qaPairs = all.filter((c) => c.kind === 'qa').length;
    await fs.writeFile(
      path.join(this.dataDir, 'indexes', `${tenantId}.json`),
      JSON.stringify({ tenantId, chunks: all.length, qaPairs, updatedAt: new Date().toISOString() }, null, 2),
    );
    return { chunks: all.length, qaPairs };
  }

  async loadPersistedMeta(tenantId: string): Promise<boolean> {
    void tenantId;
    return false;
  }

  async search(tenantId: string, query: string, limit = 4): Promise<KnowledgeHit[]> {
    return this.index.search(tenantId, query, limit);
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...(await listMarkdown(full)));
      else if (e.name.endsWith('.md')) out.push(full);
    }
  } catch {
    /* missing dir */
  }
  return out;
}
