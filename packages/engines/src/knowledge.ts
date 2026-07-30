import type { KnowledgeHit } from '@agent-platform/domain';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile, ensureDir } from './file-store.js';
import { sanitizeTenantId } from './security.js';

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

const STOP = new Set([
  'the', 'and', 'for', 'are', 'you', 'your', 'with', 'from', 'that', 'this',
  'what', 'when', 'where', 'which', 'who', 'how', 'can', 'does', 'do', 'is',
  'a', 'an', 'to', 'of', 'in', 'on', 'my', 'me', 'we', 'our', 'please', 'tell',
  'about', 'any', 'also', 'just', 'like', 'need', 'want', 'know', 'get', 'got',
]);

/** Domain synonyms so paraphrased questions still hit the right FAQ. */
const SYNONYM_GROUPS: string[][] = [
  ['cost', 'price', 'pricing', 'rate', 'rates', 'fee', 'fees', 'charge', 'charges', 'expensive', 'cheap'],
  ['quote', 'quotation', 'estimate', 'pricing'],
  ['ship', 'shipping', 'shipment', 'cargo', 'freight', 'consignment', 'send', 'sending', 'transport'],
  ['track', 'tracking', 'locate', 'status', 'follow', 'whereabouts'],
  ['contact', 'phone', 'email', 'call', 'reach', 'telephone', 'whatsapp', 'number'],
  ['location', 'located', 'address', 'office', 'hq', 'headquarters', 'based', 'where'],
  ['service', 'services', 'offer', 'offers', 'provide', 'provides', 'offering', 'help'],
  ['destination', 'destinations', 'country', 'countries', 'route', 'routes', 'worldwide', 'international'],
  ['document', 'documents', 'documentation', 'paperwork', 'papers', 'invoice', 'packing'],
  ['vehicle', 'car', 'cars', 'auto', 'automobile', 'motorcycle', 'bike', 'suv', 'truck'],
  ['container', 'fcl', 'lcl', 'groupage', 'consolidation', 'ocean', 'sea'],
  ['air', 'airplane', 'aircraft', 'airport', 'awb'],
  ['customs', 'clearance', 'duty', 'duties', 'import', 'export'],
  ['parcel', 'package', 'packages', 'courier', 'express', 'box'],
  ['warehouse', 'warehousing', 'storage', 'store'],
  ['insurance', 'insured', 'cover', 'coverage'],
  ['time', 'duration', 'transit', 'delay', 'days', 'weeks', 'eta', 'delivery'],
  ['book', 'booking', 'reserve', 'order', 'arrange'],
  ['business', 'company', 'commercial', 'corporate', 'individual', 'personal'],
  ['africa', 'cameroon', 'togo', 'gabon', 'senegal', 'ghana', 'nigeria', 'congo'],
  ['canada', 'montreal', 'halifax', 'toronto', 'moncton'],
  ['payment', 'pay', 'paid', 'online', 'card'],
  ['app', 'mobile', 'application'],
];

const SYNONYM_MAP = buildSynonymMap(SYNONYM_GROUPS);

function buildSynonymMap(groups: string[][]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of groups) {
    for (const word of group) {
      map.set(word, group.filter((w) => w !== word));
    }
  }
  return map;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const t of a) if (setB.has(t)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

/** Light stemmer for English logistics vocabulary (no external deps). */
export function stem(token: string): string {
  let t = token.toLowerCase();
  if (t.length <= 3) return t;
  if (t.endsWith('ies') && t.length > 4) t = `${t.slice(0, -3)}y`;
  else if (t.endsWith('ing') && t.length > 5) t = t.slice(0, -3);
  else if (t.endsWith('ed') && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith('es') && t.length > 4) t = t.slice(0, -2);
  else if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) t = t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map(stem);
}

function expandTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYM_MAP.get(t);
    if (syns) for (const s of syns) out.add(stem(s));
  }
  return [...out];
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/^q\d+\.\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(tokens: string[]): Set<string> {
  return new Set(tokens);
}

/** Lexical MVP index with synonym + stem matching for paraphrased questions. */
export class LexicalKnowledgeIndex implements VectorSearchPort {
  private readonly byTenant = new Map<string, KnowledgeChunk[]>();

  async upsert(tenantId: string, chunks: KnowledgeChunk[]): Promise<void> {
    this.byTenant.set(tenantId, chunks);
  }

  async search(tenantId: string, query: string, limit: number): Promise<KnowledgeHit[]> {
    const chunks = this.byTenant.get(tenantId) ?? [];
    if (!chunks.length) return [];

    const qNorm = normalizeQuestion(query);
    // Exact FAQ match first — needed for greetings like "hi" / "how are you"
    // where tokenize() drops short words and stopwords.
    if (qNorm) {
      const exactHits = chunks
        .filter((c) => c.kind === 'qa' && c.question && normalizeQuestion(c.question) === qNorm)
        .map((chunk) => ({
          id: chunk.id,
          title: chunk.title,
          heading: chunk.heading,
          content: chunk.content,
          score: 200,
          confidence: 0.99,
        }));
      if (exactHits.length) return exactHits.slice(0, limit);
    }

    const rawTokens = tokenize(query);
    if (!rawTokens.length) {
      // Soft fallback: match short queries that only contain stopwords / 1–2 letter words
      const soft = chunks
        .filter((c) => c.kind === 'qa' && c.question)
        .map((chunk) => {
          const qn = normalizeQuestion(chunk.question!);
          let score = 0;
          if (qn === qNorm) score = 100;
          else if (qNorm.length >= 2 && (qn.startsWith(qNorm) || qNorm.startsWith(qn))) score = 40;
          return { chunk, score };
        })
        .filter((x) => x.score >= 40)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return soft.map(({ chunk, score }) => ({
        id: chunk.id,
        title: chunk.title,
        heading: chunk.heading,
        content: chunk.content,
        score,
        confidence: Math.min(0.99, 0.7 + score / 200),
      }));
    }

    const qBigrams = bigrams(rawTokens);

    const scored = chunks
      .map((chunk) => {
        let score = 0;
        const isQa = chunk.kind === 'qa' && Boolean(chunk.question);
        const questionExact = isQa ? tokenize(chunk.question!) : [];
        const questionExactSet = tokenSet(questionExact);
        const questionExpandedSet = tokenSet(isQa ? expandTokens(questionExact) : []);
        const bodySet = tokenSet(chunk.tokens);

        // Exact user tokens in the FAQ question (strongest signal)
        let exactQHits = 0;
        for (const t of rawTokens) {
          if (questionExactSet.has(t)) {
            exactQHits += 1;
            score += 5;
          }
        }

        // Synonym / body overlap (weaker)
        for (const t of rawTokens) {
          if (questionExactSet.has(t)) continue;
          if (questionExpandedSet.has(t)) score += 1.2;
          else if (bodySet.has(t)) score += isQa ? 0.25 : 1.0;
        }

        if (isQa) {
          const qb = new Set(bigrams(questionExact));
          for (const bg of qBigrams) if (qb.has(bg)) score += 4;

          const qn = normalizeQuestion(chunk.question!);
          const exactQuestion = qn === qNorm;
          if (exactQuestion) score += 35;
          else if (qNorm.length > 8 && (qn.includes(qNorm) || qNorm.includes(qn))) score += 16;
          score += jaccard(rawTokens, questionExact) * 20;
          if (rawTokens.length) score += (exactQHits / rawTokens.length) * 14;

          // Short greetings / basics: exact match must win over longer FAQs
          if (exactQuestion && questionExact.length <= 3) score += 25;
        }

        const heading = (chunk.question || chunk.heading || '').toLowerCase();
        if (/\b(phone|email|contact|call|whatsapp|number)\b/.test(qNorm) && /\b(contact|phone|email|call|reach)\b/.test(heading)) {
          score += 12;
        }
        if (/\b(office|located|location|address|based|hq)\b/.test(qNorm) && /\b(located|location|address|office|moncton|brunswick)\b/.test(heading)) {
          score += 12;
        }
        if (/\b(offer|offers|services|provide|helps)\b/.test(qNorm) && /\b(main services|what services|services does)\b/.test(heading)) {
          score += 14;
        }
        if (/\b(about|who is|acocam)\b/.test(qNorm) && /\b(who is acocam|about acocam|mission)\b/.test(heading)) {
          score += 12;
        }
        if (/\b(car|cars|vehicle|motorcycle|auto)\b/.test(qNorm) && /\b(vehicle|car|motorcycle)\b/.test(heading)) {
          score += 10;
        }
        if (/\b(lcl|groupage|consolidation)\b/.test(qNorm) && /\b(lcl|groupage|consolidation)\b/.test(heading)) {
          score += 18;
        }
        if (/\b(fcl|full container)\b/.test(qNorm) && /\b(fcl|full container)\b/.test(heading)) {
          score += 18;
        }
        if (/^(hi|hello|hey|thanks|thank you|bye|goodbye|help)\b/.test(qNorm) && /^(hi|hello|hey|thanks|thank you|bye|goodbye|help)\b/.test(heading)) {
          score += 22;
        }

        // Prefer substantive FAQ questions over tiny ones like "Call me."
        // Do not penalize exact short greeting / basics matches.
        if (isQa && questionExact.length <= 1) {
          const qn = normalizeQuestion(chunk.question || '');
          if (qn !== qNorm) score -= exactQHits > 0 ? 4 : 10;
        }

        return { chunk, score };
      })
        .filter((x) => x.score >= 1.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(limit, 8));

    if (!scored.length) return [];

    const max = scored[0]?.score ?? 1;
    const minKeep = Math.max(2, max * 0.35);
    const kept = scored.filter((x) => x.score >= minKeep).slice(0, limit);

    return kept.map(({ chunk, score }) => ({
      id: chunk.id,
      title: chunk.title,
      heading: chunk.heading,
      content: chunk.content,
      score,
      confidence: Math.min(0.99, 0.42 + (score / max) * 0.55),
    }));
  }
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
      tokens: expandTokens(tokenize(`${pair.question} ${pair.answer}`)),
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
        tokens: expandTokens(tokenize(piece)),
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

  private chunksPath(tenantId: string): string {
    const safe = sanitizeTenantId(tenantId) ?? tenantId;
    return path.join(this.dataDir, 'indexes', `${safe}-chunks.json`);
  }

  private metaPath(tenantId: string): string {
    const safe = sanitizeTenantId(tenantId) ?? tenantId;
    return path.join(this.dataDir, 'indexes', `${safe}.json`);
  }

  async reindexTenant(tenantId: string, knowledgeDir: string): Promise<{ chunks: number; qaPairs: number }> {
    const files = await listMarkdown(knowledgeDir);
    const all: KnowledgeChunk[] = [];
    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      all.push(...splitMarkdown(raw, tenantId, path.basename(file)));
    }
    await this.index.upsert(tenantId, all);
    await ensureDir(path.join(this.dataDir, 'indexes'));
    const qaPairs = all.filter((c) => c.kind === 'qa').length;
    const meta = { tenantId, chunks: all.length, qaPairs, updatedAt: new Date().toISOString() };
    await writeJsonFile(this.metaPath(tenantId), meta);
    await writeJsonFile(this.chunksPath(tenantId), { tenantId, chunks: all });
    return { chunks: all.length, qaPairs };
  }

  async loadPersistedIndex(tenantId: string): Promise<boolean> {
    const data = await readJsonFile<{ chunks?: KnowledgeChunk[] }>(this.chunksPath(tenantId));
    if (!data?.chunks?.length) return false;
    await this.index.upsert(tenantId, data.chunks);
    return true;
  }

  async loadPersistedMeta(tenantId: string): Promise<boolean> {
    return this.loadPersistedIndex(tenantId);
  }

  async search(tenantId: string, query: string, limit = 4): Promise<KnowledgeHit[]> {
    return this.index.search(tenantId, query, limit);
  }

  async listTenantIdsFromDisk(): Promise<string[]> {
    const dir = path.join(this.dataDir, 'indexes');
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('-chunks.json'))
        .map((f) => f.replace(/-chunks\.json$/, ''));
    } catch {
      return [];
    }
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
  // Prefer merged Q&A corpus to avoid duplicating knowledge-base.md, but still
  // index supplemental files (e.g. website-faq.md).
  const merged = out.filter((f) => path.basename(f).toLowerCase() === 'knowledge-qa.md');
  if (merged.length) {
    const extras = out.filter((f) => {
      const name = path.basename(f).toLowerCase();
      return name !== 'knowledge-qa.md' && name !== 'knowledge-base.md';
    });
    return [...merged, ...extras];
  }
  return out;
}
