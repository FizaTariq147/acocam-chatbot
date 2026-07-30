# Step 1 — Deploy chatbot API (go live)

Deploy the **ACOCAM chatbot API** so WordPress can call it at a public HTTPS URL (target: `https://chat-api.acocamtrading.ca`).

**Free tier only (Render, Fly.io, Railway limits):** see **[DEPLOY_STEP1_FREE.md](./DEPLOY_STEP1_FREE.md)**.

**Prerequisites (you already have these locally):**

- Production `.env` configured and `npm run check:prod` passing
- Logistics API live at `https://mediumblue-jackal-717379.hostingersite.com`
- Node 20+ on your Windows machine

**This step does not require GitHub.** All packaging happens locally.

---

## Choose a path

| Path | Best when | You need |
|------|-----------|----------|
| **A — Render.com** (recommended) | You only have WordPress wp-admin today; no VPS/SSH yet | Render account, Docker Desktop (or Docker Hub account) |
| **B — Hostinger VPS / hPanel** | You have SSH or Hostinger Node app access | VPS, subdomain DNS, optional nginx |

**Recommendation:** Use **Path A (Render.com)** until Hostinger VPS or hPanel Node access is available. Render gives you a public HTTPS URL in ~15 minutes with no server admin.

---

## Environment variables (set on hosting platform)

Copy values from your working local `.env` (based on `env.production.example`). **Never commit `.env` to git or upload it in the deploy zip.**

### Required

| Variable | Example / notes |
|----------|-----------------|
| `NODE_ENV` | `production` |
| `PORT` | `8787` (Render sets `PORT` automatically — app reads it) |
| `HOST` | `0.0.0.0` on Render/Docker; `127.0.0.1` behind nginx on VPS |
| `TRUST_PROXY` | `true` when behind Render/nginx (HTTPS termination) |
| `TENANTS_DIR` | `./tenants` |
| `DATA_DIR` | `./data` |
| `ACOCAM_PUBLISHABLE_KEY` | Your live `pk_live_...` key (**Secret**) |
| `ACOCAM_SECRET_KEY` | Your live `sk_live_...` key (**Secret**) |
| `ACOCAM_API_BASE_URL` | `https://mediumblue-jackal-717379.hostingersite.com` |
| `CORS_ORIGIN` | `https://acocamtrading.ca,https://www.acocamtrading.ca` |
| `JWT_VALIDATE_EXP` | `true` |

### Portal URLs (match acocamtrading.ca)

| Variable | Value |
|----------|-------|
| `ACOCAM_PORTAL_LOGIN_URL` | `https://acocamtrading.ca/login` |
| `ACOCAM_PORTAL_SIGNUP_URL` | `https://acocamtrading.ca/login` |
| `ACOCAM_PORTAL_QUOTE_URL` | `https://acocamtrading.ca/get-quote/` |

### Recommended defaults

| Variable | Value |
|----------|-------|
| `AI_PROVIDER` | `null` |
| `PERSIST_SESSIONS` | `true` |
| `PERSIST_ANALYTICS` | `true` |
| `PERSIST_ESCALATIONS` | `true` |
| `RATE_LIMIT_PER_MINUTE` | `120` |
| `MAX_MESSAGE_LENGTH` | `4000` |
| `TOOL_TIMEOUT_MS` | `15000` |
| `DEFAULT_COUNTRY` | `Canada` |

### Optional

| Variable | When to set |
|----------|-------------|
| `PUBLIC_API_URL` | After custom domain: `https://chat-api.acocamtrading.ca` |
| `ACOCAM_API_CHECK_TIMEOUT_MS` | If logistics health check is slow (e.g. `20000`) |
| `EXPOSE_INTERNAL_ERRORS` | Leave unset/`false` in production |

---

## Path A — Render.com (recommended, no VPS)

Render runs the API with HTTPS. Two ways to deploy **without pushing this repo to GitHub**:

### A1 — Docker image (no GitHub required)

**On your Windows machine:**

```powershell
cd D:\acocam-ai-chatbot

# 1. Final local check
npm run check:prod

# 2. Build Docker image (requires Docker Desktop)
docker build -t acocam-chatbot-api .

# 3. Test locally (optional)
docker run --rm -p 8787:8787 --env-file .env acocam-chatbot-api
# Browser: http://localhost:8787/v1/health

# 4. Tag and push to Docker Hub (create free account at hub.docker.com)
docker tag acocam-chatbot-api YOUR_DOCKERHUB_USER/acocam-chatbot-api:latest
docker login
docker push YOUR_DOCKERHUB_USER/acocam-chatbot-api:latest
```

**On Render.com:**

1. Sign up at [render.com](https://render.com)
2. **New → Web Service → Deploy an existing image from a registry**
3. Image URL: `docker.io/YOUR_DOCKERHUB_USER/acocam-chatbot-api:latest`
4. Name: `acocam-chatbot-api`
5. Region: Ohio (or nearest)
6. Instance: **Free** (see [DEPLOY_STEP1_FREE.md](./DEPLOY_STEP1_FREE.md) for sleep/cold-start limits; paid Starter ~$7/mo removes spin-down)
7. **Environment → Add every variable** from the table above (mark keys as **Secret**)
8. Health check path: `/v1/health`
9. Create Web Service

Render assigns a URL like `https://acocam-chatbot-api.onrender.com`.

**Custom domain (when ready):**

1. Render → your service → **Settings → Custom Domains** → add `chat-api.acocamtrading.ca`
2. In your DNS provider, add the CNAME Render shows
3. Set `PUBLIC_API_URL=https://chat-api.acocamtrading.ca` in Render env

### A2 — Render Blueprint + Git (when you connect GitHub later)

If you later connect this repo to GitHub:

1. Render → **New → Blueprint** → point at repo
2. Uses root `render.yaml` (build/start commands and env template included)
3. Set `ACOCAM_PUBLISHABLE_KEY` and `ACOCAM_SECRET_KEY` as secrets in dashboard

---

## Path B — Hostinger VPS / hPanel

Use when you have SSH, File Manager upload, or Hostinger **Node.js** app.

### B1 — Package on Windows

```powershell
cd D:\acocam-ai-chatbot
npm run check:prod
npm run package:deploy
```

Output: `acocam-chatbot-deploy.zip` in repo root (no `node_modules`, `.env`, or session data).

### B2 — Upload and install on server

```bash
# On VPS (SSH)
mkdir -p ~/acocam-chatbot && cd ~/acocam-chatbot
# Upload zip via SFTP / Hostinger File Manager, then:
unzip acocam-chatbot-deploy-*.zip -d .

cp env.production.example .env
nano .env   # paste your live values from local .env

node -v     # must be 20+
npm install
npm run build
npm run reindex

mkdir -p data/logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Ensure `.env` includes:

```env
HOST=127.0.0.1
PORT=8787
TRUST_PROXY=true
```

### B3 — Subdomain + HTTPS (nginx)

1. DNS: **A record** `chat-api.acocamtrading.ca` → VPS IP
2. Copy `deploy/nginx-chat-api.conf.example` to nginx sites-enabled
3. `sudo certbot --nginx -d chat-api.acocamtrading.ca`
4. `sudo nginx -t && sudo systemctl reload nginx`

---

## Post-deploy verification

Replace `BASE` with your live URL (`https://acocam-chatbot-api.onrender.com` or `https://chat-api.acocamtrading.ca`).

| Check | URL | Expected |
|-------|-----|----------|
| Health | `BASE/v1/health` | JSON with `"ok": true`, `"knowledgeReady": true` |
| Demo page | `BASE/demo` | Chat widget loads in corner |
| Embed script | `BASE/embed/agent-embed.js` | JavaScript file (200) |
| Logistics (separate) | `https://mediumblue-jackal-717379.hostingersite.com/api/health` | 200 OK |

**From your Windows machine** (set `$Base` first):

```powershell
$Base = "https://YOUR-RENDER-OR-CUSTOM-URL"
Invoke-RestMethod "$Base/v1/health"
Invoke-WebRequest "$Base/embed/agent-embed.js" -UseBasicParsing | Select-Object StatusCode
```

**Public agent config** (no auth required):

```
GET BASE/v1/tenants/acocam/agents/customer-support/config/public
```

Should return tenant theme, welcome message, and actions.

---

## After Step 1 succeeds

1. Note your public API base: `https://YOUR-URL/v1`
2. Note embed script URL: `https://YOUR-URL/embed/agent-embed.js`
3. Continue to **Phase 3** in [GO_LIVE.md](./GO_LIVE.md) — WordPress plugin settings

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `knowledgeReady: false` | Run `npm run reindex` on server or rebuild Docker image |
| CORS errors in browser | Set `CORS_ORIGIN` exactly to `https://acocamtrading.ca,https://www.acocamtrading.ca` |
| Tracking fails | Confirm `ACOCAM_API_BASE_URL` and logistics `/api/health` |
| 502 behind nginx | Check PM2: `pm2 logs acocam-chatbot-api`; confirm `HOST=127.0.0.1` |
| Render cold start | Free/starter tier sleeps; first request may take ~30s |

---

## Files reference

| File | Purpose |
|------|---------|
| `Dockerfile` | Container build (Node 20, port 8787) |
| `render.yaml` | Render Blueprint (Git deploy) |
| `ecosystem.config.cjs` | PM2 on VPS |
| `deploy/nginx-chat-api.conf.example` | nginx reverse proxy |
| `scripts/package-for-deploy.ps1` | Windows deploy zip |
