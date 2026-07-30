# Go live — ACOCAM chatbot (local prep, no GitHub required)

This guide prepares **this repo** for production and embedding on **https://acocamtrading.ca**. All steps are on your machine/server until you choose to push code.

## Architecture

| Piece | URL example | Role |
|-------|-------------|------|
| Main website | `https://acocamtrading.ca` | WordPress + embed script |
| **Chatbot API** (this repo) | `https://chat-api.acocamtrading.ca` | Chat, KB, workflows |
| **Logistics API** | Your Hostinger / Node backend | Track, quote, profile |

---

## Phase 1 — Local production test

### 1. Copy production env template

```powershell
copy env.production.example .env.production.local
# Edit .env.production.local — set live keys and URLs
# For a dry run, copy to .env:
copy .env.production.local .env
```

Generate new keys (do not use `pk_acocam_demo`):

```env
ACOCAM_PUBLISHABLE_KEY=pk_live_xxxxxxxx
ACOCAM_SECRET_KEY=sk_live_xxxxxxxx
CORS_ORIGIN=https://acocamtrading.ca,https://www.acocamtrading.ca
NODE_ENV=production
ACOCAM_API_BASE_URL=https://YOUR-LIVE-LOGISTICS-API
```

### 2. Run checks

```powershell
npm run check:prod
npm run check:acocam-api
npm run check:local
```

### 3. Start production build locally

```powershell
.\scripts\start-production.ps1
# or: npm run start:prod
```

Test: `http://localhost:8787/demo` and `http://localhost:8787/v1/health`

---

## Phase 2 — Deploy chatbot API to a server

**Primary guide:** [DEPLOY_STEP1.md](./DEPLOY_STEP1.md) — Render.com or Hostinger VPS/hPanel. **Free tier:** [DEPLOY_STEP1_FREE.md](./DEPLOY_STEP1_FREE.md). **Fly.io (~$3–5/mo):** [DEPLOY_FLYIO.md](./DEPLOY_FLYIO.md).

Quick summary:

1. Package locally: `npm run package:deploy` (or build Docker image — see DEPLOY_STEP1)
2. Deploy to Render or VPS; set env vars from your local `.env` (never commit secrets)
3. Verify `https://YOUR-URL/v1/health` returns `knowledgeReady: true`
4. Optional custom domain: `chat-api.acocamtrading.ca` with `TRUST_PROXY=true`

---

## Phase 3 — Embed on acocamtrading.ca (WordPress)

1. Zip folder `adapters/wordpress/acocam-agent-embed/`
2. WordPress → Plugins → Upload → Activate
3. **Settings → Agent Embed**:

| Field | Example |
|-------|---------|
| API base | `https://chat-api.acocamtrading.ca/v1` |
| Embed script | `https://chat-api.acocamtrading.ca/embed/agent-embed.js` |
| Tenant | `acocam` |
| Agent ID | `customer-support` |
| Publishable key | `pk_live_...` |
| Customer JWT key | `token` (match your site login localStorage key) |
| Enabled | ✓ |

4. Visit acocamtrading.ca — chat launcher should appear.

---

## Phase 4 — Logged-in users (Book shipment)

After login, your site must store JWT in `localStorage` (e.g. key `token`). The plugin passes `data-customer-token-key="token"` to the widget.

Optional in theme (if token is not in localStorage):

```html
<script>window.ACOCAM_AUTH_TOKEN = '...';</script>
```

---

## GitHub — when you are ready (optional)

| Do | Don't |
|----|--------|
| Push code to **private** repo | Commit `.env` or live secret keys |
| Use branches (`main`, `production`) | Push demo keys to production server |
| Tag releases | Push `data/sessions/` or ML weights |

**Nothing on GitHub is required to go live** — only a deployed server + WordPress embed.

---

## Launch checklist

- [ ] Logistics API `/api/health` returns 200 in browser
- [ ] `npm run check:prod` passes on server
- [ ] HTTPS on chat API subdomain
- [ ] CORS only allows acocamtrading.ca
- [ ] Live publishable/secret keys set via env
- [ ] WordPress plugin enabled with live URLs
- [ ] Test: guest FAQ, track (real number), login → Book shipment
- [ ] Reindex after KB changes: `npm run reindex`

---

## Commands reference

```powershell
npm run build          # compile all packages
npm run reindex        # refresh knowledge index
npm run start:prod     # build + reindex + start
npm run check:prod     # go-live checklist
npm run check:acocam-api
npm run package:deploy # zip for VPS upload (excludes secrets)
.\scripts\start-production.ps1
```
