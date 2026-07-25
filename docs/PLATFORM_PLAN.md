# AI Agent Platform — Implementation Plan

## Goals

- One **reusable core** for many company AI agents (logistics, healthcare, real estate, etc.).
- **Embed anywhere**: web apps, mobile (WebView/REST), WordPress, desktop — via REST + JS embed script.
- **ACOCAM** is the first tenant pack (not the product).
- Company differences live only in tenant config: knowledge, prompts, workflows, tools, branding, settings.

**Defaults locked for this plan**

- Runtime: **TypeScript monorepo** (API + engines + JS embed).
- MVP scope: **core + ACOCAM tenant + embed widget + workflows + tools (tracking/quotes) + escalation**.
- WordPress: thin adapter later (Phase 2); apps integrate via REST/embed from day one.

---

## Current project assets (inputs only)

| Path | Use |
|------|-----|
| `knowledge base/AI-Chatbot-knowledge Base-EN-Expanded(1).md` | Authoritative ACOCAM KB + intents/workflows source |
| `knowledge base/AI-Chatbot-knowledge Base-EN.md` | Baseline subset (do not dual-ingest) |
| `knowledge base/AI-Chatbot-knowledge Base-EN-Expanded(2).md` | Duplicate of Expanded(1) — skip |
| `api/api.json` | ACOCAM live API contract for tenant tools |

---

## Target architecture

Core engines never import company business rules. They load `tenants/{id}/`.

```text
Clients (Embed / App / WP)
  → API Gateway (auth, rate limit, tenant resolve)
  → Conversation Pipeline
  → Engines (Config, Intent, Knowledge, Workflow, Tool, Prompt, AI, Memory, Escalation, Analytics)
  → Tenant packs (acocam, …)
```

---

## Repository structure

```text
apps/api/
packages/domain|application|engines|sdk-js/
tenants/_template|acocam/
adapters/wordpress/
docs/
```

## Success criteria

1. Embed script works on a plain HTML page talking to ACOCAM agent.
2. Mobile/web app can complete a session via REST alone.
3. KB questions answered from Expanded corpus with citations/confidence.
4. Tracking workflow can call live track tool when API base URL is configured.
5. Adding a second tenant requires **config only** (no core code change).
6. No ACOCAM-specific imports inside `packages/engines/*`.

See also: [ARCHITECTURE.md](./ARCHITECTURE.md), [TENANT_GUIDE.md](./TENANT_GUIDE.md), [EMBED.md](./EMBED.md).
