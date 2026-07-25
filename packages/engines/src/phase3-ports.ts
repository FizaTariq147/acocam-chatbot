/**
 * Phase 3 optional ports
 *
 * - Streaming: GET /v1/.../sessions/:id/stream (SSE) implemented in apps/api
 * - Redis sessions: RedisMemoryStore in packages/engines (falls back to in-memory until REDIS_URL client wired)
 * - Vector search: VectorSearchPort + LexicalKnowledgeIndex in packages/engines/knowledge.ts
 */

export {};
