import type { ChatMessage, ConversationState, SessionRecord } from '@agent-platform/domain';
import { emptyConversationState } from '@agent-platform/domain';
import { randomUUID } from 'node:crypto';

export interface MemoryStore {
  create(tenantId: string, agentId: string, ttlMs?: number): Promise<SessionRecord>;
  get(tenantId: string, sessionId: string): Promise<SessionRecord | null>;
  save(session: SessionRecord): Promise<void>;
  appendMessage(tenantId: string, sessionId: string, message: ChatMessage): Promise<SessionRecord | null>;
  updateState(tenantId: string, sessionId: string, state: ConversationState): Promise<SessionRecord | null>;
  reset(tenantId: string, sessionId: string): Promise<SessionRecord | null>;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 40;

export class InMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, SessionRecord>();

  private key(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }

  async create(tenantId: string, agentId: string, ttlMs = DEFAULT_TTL_MS): Promise<SessionRecord> {
    const now = new Date();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      tenantId,
      agentId,
      messages: [],
      state: emptyConversationState(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.sessions.set(this.key(tenantId, session.sessionId), session);
    return structuredClone(session);
  }

  async get(tenantId: string, sessionId: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(this.key(tenantId, sessionId));
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.sessions.delete(this.key(tenantId, sessionId));
      return null;
    }
    return structuredClone(session);
  }

  async save(session: SessionRecord): Promise<void> {
    session.updatedAt = new Date().toISOString();
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-MAX_MESSAGES);
    }
    this.sessions.set(this.key(session.tenantId, session.sessionId), structuredClone(session));
  }

  async appendMessage(
    tenantId: string,
    sessionId: string,
    message: ChatMessage,
  ): Promise<SessionRecord | null> {
    const session = await this.get(tenantId, sessionId);
    if (!session) return null;
    session.messages.push(message);
    await this.save(session);
    return session;
  }

  async updateState(
    tenantId: string,
    sessionId: string,
    state: ConversationState,
  ): Promise<SessionRecord | null> {
    const session = await this.get(tenantId, sessionId);
    if (!session) return null;
    session.state = state;
    await this.save(session);
    return session;
  }

  async reset(tenantId: string, sessionId: string): Promise<SessionRecord | null> {
    const session = await this.get(tenantId, sessionId);
    if (!session) return null;
    session.messages = [];
    session.state = emptyConversationState();
    await this.save(session);
    return session;
  }
}

/** Optional Redis-backed store port (Phase 3). Falls back to in-memory when Redis URL unset. */
export class RedisMemoryStore implements MemoryStore {
  private readonly fallback = new InMemoryStore();

  constructor(private readonly redisUrl?: string) {
    if (redisUrl) {
      console.info('[memory] Redis URL configured; using in-memory until redis client is wired:', redisUrl);
    }
  }

  create(tenantId: string, agentId: string, ttlMs?: number): Promise<SessionRecord> {
    return this.fallback.create(tenantId, agentId, ttlMs);
  }
  get(tenantId: string, sessionId: string): Promise<SessionRecord | null> {
    return this.fallback.get(tenantId, sessionId);
  }
  save(session: SessionRecord): Promise<void> {
    return this.fallback.save(session);
  }
  appendMessage(tenantId: string, sessionId: string, message: ChatMessage): Promise<SessionRecord | null> {
    return this.fallback.appendMessage(tenantId, sessionId, message);
  }
  updateState(tenantId: string, sessionId: string, state: ConversationState): Promise<SessionRecord | null> {
    return this.fallback.updateState(tenantId, sessionId, state);
  }
  reset(tenantId: string, sessionId: string): Promise<SessionRecord | null> {
    return this.fallback.reset(tenantId, sessionId);
  }
}

export class MemoryEngine {
  constructor(private readonly store: MemoryStore) {}

  getStore(): MemoryStore {
    return this.store;
  }
}
