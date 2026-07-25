# Architecture

## Overview

The **AI Agent Platform** is a multi-tenant system for building company-specific AI agents from configuration packs. The core is company-agnostic; tenants supply knowledge, prompts, intents, workflows, tools, branding, and policies.

## Clean architecture layers

| Layer | Package | Role |
|-------|---------|------|
| Domain | `@agent-platform/domain` | Entities, ports (interfaces), shared types |
| Application | `@agent-platform/application` | Conversation turn pipeline / use cases |
| Engines | `@agent-platform/engines` | Config, Auth, Memory, Intent, Knowledge, Prompt, AI, Workflow, Tool, Escalation, Analytics |
| Infrastructure / API | `apps/api` | HTTP adapters, wiring, env |
| Clients | `@agent-platform/sdk-js`, `adapters/wordpress` | Embed + channel adapters |

## Request lifecycle

1. Resolve tenant + agent from path / headers.
2. Authenticate publishable or secret API key.
3. Rate-limit by key + IP.
4. Load session (Memory).
5. Detect intent (Intent) from tenant `intents.json`.
6. Escalation gate (policies).
7. If workflow active or intent maps to workflow → Workflow Engine.
8. Else route: knowledge → Prompt + AI; tool → Tool Engine; conversational; fallback.
9. Persist memory + emit analytics.
10. Return message, actions, citations, conversation state.

## Tenant isolation

Every session, index, analytics row, and escalation is keyed by `tenantId` (+ optional `agentId`).

## AI providers

`LlmProvider` port with:

- `null` — return KB excerpt only
- `openai_compatible` — OpenAI-style chat completions

Swap via env / tenant settings without changing orchestrator code.

## Tools

Declarative HTTP tools in `tenants/{id}/tools/*.json`. Core never hardcodes `/api/shipments/track`.

## Security

- Publishable key (`pk_`) for embeds; secret key (`sk_`) for admin/reindex.
- No long-term storage of customer JWTs in session (request-scoped `customerToken` for tools only).
- Input validation; PII/password/card refusal; analytics redaction.
