---
title: ACOCAM Chatbot API
emoji: 💬
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# ACOCAM Chatbot API

Chatbot API for [ACOCAM Trading](https://acocamtrading.ca) — knowledge base, shipment tracking, and quotes.

| Endpoint | URL |
|----------|-----|
| Health | `/v1/health` |
| Demo widget | `/demo` |
| Embed script | `/embed/agent-embed.js` |
| Public config | `/v1/tenants/acocam/agents/customer-support/config/public` |

Set environment variables in **Space Settings → Variables** (see `docs/DEPLOY_HUGGINGFACE.md` in the repo).

**Required:** `PORT=7860`, `HOST=0.0.0.0`, live API keys, `CORS_ORIGIN`, `ACOCAM_API_BASE_URL`.
