import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlatform, bootstrapKnowledge } from './platform.js';
import { sanitizeTenantId, validateCustomerToken } from '@agent-platform/engines';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platform = createPlatform();

const MAX_MESSAGE_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH ?? 4000);

function getApiKey(headers: Record<string, unknown>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const key = headers['x-api-key'];
  return typeof key === 'string' ? key : undefined;
}

async function main() {
  const app = Fastify({
    logger: true,
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: Number(process.env.BODY_LIMIT_BYTES ?? 65536),
  });

  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  await app.register(cors, {
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
  });

  const sdkDist = path.resolve(__dirname, '../../../packages/sdk-js/dist');
  await app.register(fastifyStatic, {
    root: sdkDist,
    prefix: '/embed/',
    decorateReply: false,
  });

  app.get('/', async (_req, reply) => reply.redirect('/demo'));
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());

  app.get('/health', async () => ({ ok: true, service: 'ai-agent-platform' }));
  app.get('/v1/health', async () => {
    let knowledgeReady = false;
    try {
      const hits = await platform.knowledge.search('acocam', 'hello', 1);
      knowledgeReady = hits.length > 0;
    } catch {
      knowledgeReady = false;
    }
    return {
      ok: true,
      knowledgeReady,
      dataDir: platform.dataDir,
      sessionsPersisted: process.env.PERSIST_SESSIONS !== 'false',
    };
  });

  app.get('/demo', async (_req, reply) => {
    const pubKey =
      process.env.ACOCAM_PUBLISHABLE_KEY?.trim() ||
      process.env.TENANT_PUBLISHABLE_KEY?.trim() ||
      'pk_acocam_demo';
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Agent Embed Demo</title></head>
<body style="font-family:Georgia,serif;padding:2rem;background:#f8fafc">
  <h1>AI Agent Platform — Embed Demo</h1>
  <p>The chat widget should appear in the corner.</p>
  <script src="/embed/agent-embed.js"
    data-tenant="acocam"
    data-agent="customer-support"
    data-key="${pubKey.replace(/"/g, '&quot;')}"
    data-api="/v1"></script>
</body></html>`;
    return reply.type('text/html').send(html);
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/v1/tenants') && !req.url.startsWith('/v1/admin')) return;
    const parts = req.url.split('/');
    const tenantIdx = parts.indexOf('tenants');
    if (tenantIdx < 0 || !parts[tenantIdx + 1]) return;
    const tenantId = parts[tenantIdx + 1]!;
    if (!sanitizeTenantId(tenantId)) {
      return reply.code(400).send({ ok: false, error: 'Invalid tenant id' });
    }
    const key = getApiKey(req.headers as Record<string, unknown>);
    const ip = req.ip || 'unknown';
    if (!platform.rateLimiter.allow(`${tenantId}:${ip}`)) {
      return reply.code(429).send({ ok: false, error: 'Rate limit exceeded' });
    }
    try {
      const pack = await platform.config.load(tenantId);
      const requireSecret = req.url.includes('/admin/') || req.method !== 'GET' && req.url.includes('/reindex');
      const isAdmin = req.url.startsWith('/v1/admin');
      const auth = platform.auth.resolve(pack, key, isAdmin || requireSecret);
      if (!auth.ok) {
        return reply.code(401).send({ ok: false, error: auth.error ?? 'Unauthorized' });
      }
      (req as { tenantPack?: unknown }).tenantPack = pack;
      (req as { authMode?: string }).authMode = auth.mode;
    } catch (err) {
      return reply.code(404).send({ ok: false, error: err instanceof Error ? err.message : 'Tenant not found' });
    }
  });

  app.get<{ Params: { tenantId: string; agentId: string } }>(
    '/v1/tenants/:tenantId/agents/:agentId/config/public',
    async (req, reply) => {
      const pack = await platform.config.load(req.params.tenantId);
      const agent = platform.config.getAgent(pack, req.params.agentId);
      if (!agent) return reply.code(404).send({ ok: false, error: 'Agent not found' });
      return {
        tenantId: pack.settings.tenantId,
        agentId: agent.id,
        name: agent.name,
        welcome: agent.welcome,
        theme: pack.theme,
        actions: platform.publicActionsForTenant(pack),
      };
    },
  );

  app.post<{ Params: { tenantId: string; agentId: string } }>(
    '/v1/tenants/:tenantId/agents/:agentId/sessions',
    async (req, reply) => {
      const pack = await platform.config.load(req.params.tenantId);
      const agent = platform.config.getAgent(pack, req.params.agentId);
      if (!agent) return reply.code(404).send({ ok: false, error: 'Agent not found' });
      const session = await platform.memory.getStore().create(req.params.tenantId, req.params.agentId);
      platform.analytics.track({
        tenantId: req.params.tenantId,
        agentId: req.params.agentId,
        sessionId: session.sessionId,
        type: 'session.create',
      });
      return {
        ok: true,
        sessionId: session.sessionId,
        welcome: agent.welcome,
        conversation: session.state,
      };
    },
  );

  app.get<{ Params: { tenantId: string; agentId: string; sessionId: string } }>(
    '/v1/tenants/:tenantId/agents/:agentId/sessions/:sessionId',
    async (req, reply) => {
      const session = await platform.memory.getStore().get(req.params.tenantId, req.params.sessionId);
      if (!session || session.agentId !== req.params.agentId) {
        return reply.code(404).send({ ok: false, error: 'Session not found' });
      }
      return { ok: true, session };
    },
  );

  app.post<{
    Params: { tenantId: string; agentId: string; sessionId: string };
    Body: { message?: string; actionId?: string; customerAuthToken?: string };
  }>('/v1/tenants/:tenantId/agents/:agentId/sessions/:sessionId/messages', async (req, reply) => {
    const message = req.body?.message?.trim() ?? '';
    if (message.length > MAX_MESSAGE_LENGTH) {
      return reply.code(400).send({ ok: false, error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` });
    }
    if (!message && !req.body?.actionId) {
      return reply.code(400).send({ ok: false, error: 'message or actionId required' });
    }
    let customerAuthToken = req.body?.customerAuthToken;
    if (customerAuthToken) {
      const checked = validateCustomerToken(customerAuthToken, process.env);
      if (!checked.ok) {
        return reply.code(401).send({ ok: false, error: checked.error });
      }
      customerAuthToken = checked.token;
    }
    try {
      const result = await platform.pipeline.handleTurn({
        tenantId: req.params.tenantId,
        agentId: req.params.agentId,
        sessionId: req.params.sessionId,
        message: message || String(req.body?.actionId),
        actionId: req.body?.actionId,
        customerAuthToken,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Turn failed';
      const code = msg.includes('not found') || msg.includes('Unknown') ? 404 : 400;
      return reply.code(code).send({ ok: false, error: msg });
    }
  });

  app.post<{ Params: { tenantId: string; agentId: string; sessionId: string } }>(
    '/v1/tenants/:tenantId/agents/:agentId/sessions/:sessionId/reset',
    async (req, reply) => {
      const session = await platform.memory.getStore().reset(req.params.tenantId, req.params.sessionId);
      if (!session) return reply.code(404).send({ ok: false, error: 'Session not found' });
      return { ok: true, session };
    },
  );

  app.post<{
    Params: { tenantId: string; agentId: string; sessionId: string };
    Body: { reason?: string };
  }>('/v1/tenants/:tenantId/agents/:agentId/sessions/:sessionId/escalate', async (req, reply) => {
    try {
      const result = await platform.pipeline.handleTurn({
        tenantId: req.params.tenantId,
        agentId: req.params.agentId,
        sessionId: req.params.sessionId,
        message: req.body?.reason || 'I want to speak to a human agent',
        actionId: 'support.human',
      });
      return result;
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : 'Escalate failed' });
    }
  });

  // Optional SSE streaming stub (Phase 3)
  app.get<{ Params: { tenantId: string; agentId: string; sessionId: string }; Querystring: { message?: string; customerAuthToken?: string } }>(
    '/v1/tenants/:tenantId/agents/:agentId/sessions/:sessionId/stream',
    async (req, reply) => {
      const pack = await platform.config.load(req.params.tenantId);
      if (pack.settings.features?.streaming === false) {
        return reply.code(404).send({ ok: false, error: 'Streaming disabled for this tenant' });
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const message = (req.query.message || 'hello').slice(0, MAX_MESSAGE_LENGTH);
      let customerAuthToken = req.query.customerAuthToken;
      if (customerAuthToken) {
        const checked = validateCustomerToken(customerAuthToken, process.env);
        customerAuthToken = checked.ok ? checked.token : undefined;
      }
      try {
        const result = await platform.pipeline.handleTurn({
          tenantId: req.params.tenantId,
          agentId: req.params.agentId,
          sessionId: req.params.sessionId,
          message,
          customerAuthToken,
        });
        reply.raw.write(`data: ${JSON.stringify({ type: 'token', text: result.message })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', result })}\n\n`);
      } catch (err) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', error: err instanceof Error ? err.message : 'error' })}\n\n`,
        );
      }
      reply.raw.end();
    },
  );

  app.post<{ Params: { tenantId: string } }>('/v1/admin/tenants/:tenantId/knowledge/reindex', async (req) => {
    const pack = await platform.config.load(req.params.tenantId);
    platform.config.clearCache(req.params.tenantId);
    const result = await platform.knowledge.reindexTenant(req.params.tenantId, pack.knowledgeDir);
    return { ok: true, ...result };
  });

  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGIN?.trim()) {
      app.log.warn('Production: set CORS_ORIGIN to https://acocamtrading.ca (and www) before public launch.');
    }
    const pub = process.env.ACOCAM_PUBLISHABLE_KEY || '';
    if (!pub || pub.includes('demo')) {
      app.log.warn('Production: set ACOCAM_PUBLISHABLE_KEY to a live key (not pk_acocam_demo).');
    }
  }

  // Boot-time knowledge bootstrap for all tenants
  try {
    await bootstrapKnowledge(platform.config, platform.knowledge, platform.tenantsDir);
    app.log.info('Knowledge indexes ready');

    const pack = await platform.config.load('acocam');
    const apiBase =
      process.env.ACOCAM_API_BASE_URL?.trim() ||
      pack.settings.apiBaseUrl?.trim() ||
      '';
    if (!apiBase) {
      app.log.warn(
        'ACOCAM_API_BASE_URL is not set — tracking and quotation tools will fail until the logistics API URL is configured.',
      );
    } else {
      const healthUrl = `${apiBase.replace(/\/$/, '')}/api/health`;
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          app.log.info({ healthUrl }, 'ACOCAM logistics API reachable');
        } else {
          app.log.warn({ healthUrl, status: res.status }, 'ACOCAM logistics API returned non-OK status');
        }
      } catch (err) {
        app.log.warn(
          { healthUrl, err: err instanceof Error ? err.message : err },
          'ACOCAM logistics API unreachable — tracking will show connection errors until this is fixed',
        );
      }
    }
  } catch (err) {
    app.log.warn({ err }, 'Boot reindex skipped');
  }

  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
