import type { ChatMessage, ConversationState, SessionRecord } from '@agent-platform/domain';

import { emptyConversationState } from '@agent-platform/domain';

import { randomUUID } from 'node:crypto';

import { promises as fs } from 'node:fs';

import path from 'node:path';

import { readJsonFile, writeJsonFile, ensureDir } from './file-store.js';



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



/** Disk-backed sessions for local durability (survives API restart). */

export class FileMemoryStore implements MemoryStore {

  constructor(private readonly sessionsDir: string) {}



  private filePath(tenantId: string, sessionId: string): string {

    return path.join(this.sessionsDir, tenantId, `${sessionId}.json`);

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

    await this.save(session);

    return structuredClone(session);

  }



  async get(tenantId: string, sessionId: string): Promise<SessionRecord | null> {

    const session = await readJsonFile<SessionRecord>(this.filePath(tenantId, sessionId));

    if (!session) return null;

    if (new Date(session.expiresAt).getTime() < Date.now()) {

      await fs.unlink(this.filePath(tenantId, sessionId)).catch(() => undefined);

      return null;

    }

    return session;

  }



  async save(session: SessionRecord): Promise<void> {

    session.updatedAt = new Date().toISOString();

    if (session.messages.length > MAX_MESSAGES) {

      session.messages = session.messages.slice(-MAX_MESSAGES);

    }

    await writeJsonFile(this.filePath(session.tenantId, session.sessionId), session);

  }



  appendMessage(tenantId: string, sessionId: string, message: ChatMessage): Promise<SessionRecord | null> {

    return this.get(tenantId, sessionId).then(async (session) => {

      if (!session) return null;

      session.messages.push(message);

      await this.save(session);

      return session;

    });

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



/** Optional Redis-backed store port (Phase 3). Falls back to file/in-memory when unset. */

export class RedisMemoryStore implements MemoryStore {

  private readonly delegate: MemoryStore;



  constructor(redisUrl: string | undefined, dataDir: string) {

    const persist = process.env.PERSIST_SESSIONS !== 'false';

    if (redisUrl) {

      // Redis client not wired yet — use file store when persistence enabled

      this.delegate = persist

        ? new FileMemoryStore(path.join(dataDir, 'sessions'))

        : new InMemoryStore();

    } else {

      this.delegate = persist

        ? new FileMemoryStore(path.join(dataDir, 'sessions'))

        : new InMemoryStore();

    }

  }



  create(tenantId: string, agentId: string, ttlMs?: number): Promise<SessionRecord> {

    return this.delegate.create(tenantId, agentId, ttlMs);

  }

  get(tenantId: string, sessionId: string): Promise<SessionRecord | null> {

    return this.delegate.get(tenantId, sessionId);

  }

  save(session: SessionRecord): Promise<void> {

    return this.delegate.save(session);

  }

  appendMessage(tenantId: string, sessionId: string, message: ChatMessage): Promise<SessionRecord | null> {

    return this.delegate.appendMessage(tenantId, sessionId, message);

  }

  updateState(tenantId: string, sessionId: string, state: ConversationState): Promise<SessionRecord | null> {

    return this.delegate.updateState(tenantId, sessionId, state);

  }

  reset(tenantId: string, sessionId: string): Promise<SessionRecord | null> {

    return this.delegate.reset(tenantId, sessionId);

  }

}



export function createMemoryStore(env: NodeJS.ProcessEnv, dataDir: string): MemoryStore {

  return new RedisMemoryStore(env.REDIS_URL, dataDir);

}



export class MemoryEngine {

  constructor(private readonly store: MemoryStore) {}



  getStore(): MemoryStore {

    return this.store;

  }

}


