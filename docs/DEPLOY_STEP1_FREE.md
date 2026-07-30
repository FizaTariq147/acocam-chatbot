# Step 1 — Free hosting for the chatbot API (no GitHub push required)

Deploy the **ACOCAM chatbot API** (this repo, Node 20) to a public HTTPS URL so WordPress on [acocamtrading.ca](https://acocamtrading.ca) can load the embed widget.

**You do not need to push code to GitHub** to go live. The clearest free path is **Render.com (free web service) + Docker Hub (free registry)**, built from your Windows PC.

See also: [GO_LIVE.md](GO_LIVE.md) (WordPress embed, env template, checklist).

---

## Recommended free path (non-technical friendly)

| Choice | Why |
|--------|-----|
| **Render free + Docker Hub** | No GitHub required. Dashboard-only env vars. Free HTTPS URL. Works with wp-admin-only users if someone runs the PowerShell commands once. |
| Render free + GitHub | Easier auto-deploy, but requires connecting a Git repo (you said no GitHub push for now). |
| Fly.io | **Not free** for new accounts (short trial only). Listed for reference. |
| Railway | **~$5/month** Hobby minimum for reliable always-on; $1/month free credits are too small for this API. |
| Glitch / Replit | Sleep constantly; poor fit for a production Node API + logistics tool calls. |
| Oracle Cloud Always Free VM | Truly free but complex (Linux, firewall, PM2, nginx). Advanced option at bottom. |

### Limitations you must accept on free tiers

1. **Sleep / cold start** — Render free spins down after **15 minutes** with no traffic. First request after sleep takes **~30–60 seconds**. Visitors may see a delay before chat loads.
2. **Logistics timeouts** — Tracking and quotes call your Hostinger logistics API. During cold start, `TOOL_TIMEOUT_MS` (default 15s, recommend 20s on Render) may be exceeded. FAQ-only chat usually works; first track/quote after idle may fail — user can retry.
3. **No persistent disk on Render free** — Chat sessions, analytics, and escalations stored under `data/` are **lost when the container restarts** (deploy, crash, or platform restart). Knowledge index is baked into the Docker image at build time.
4. **750 instance hours/month** on Render — Enough for one service running 24/7 (~720 h). Spun-down services do not consume hours while idle.

---

## Files in this repo for deploy

| File | Purpose |
|------|---------|
| `Dockerfile` | Production Node 20 image (build + reindex + start) |
| `render.yaml` | Render Blueprint settings (free plan, health check, env template) |
| `.dockerignore` | Keeps image small; excludes secrets and dev junk |
| `scripts/package-for-deploy.ps1` | Optional zip for VPS backup / manual upload |
| `env.production.example` | Copy values into hosting dashboard (never commit `.env`) |

---

## Environment variables (paste in Render dashboard)

Copy from `env.production.example`. **Required for production:**

| Variable | Example | Notes |
|----------|---------|-------|
| `NODE_ENV` | `production` | |
| `HOST` | `0.0.0.0` | |
| `TRUST_PROXY` | `true` | Required behind Render proxy |
| `ACOCAM_PUBLISHABLE_KEY` | `pk_live_...` | Generate new; not `pk_acocam_demo` |
| `ACOCAM_SECRET_KEY` | `sk_live_...` | Generate new; not demo secret |
| `ACOCAM_API_BASE_URL` | `https://your-logistics-api.example.com` | Hostinger logistics API (no trailing slash) |
| `CORS_ORIGIN` | `https://acocamtrading.ca,https://www.acocamtrading.ca` | Comma-separated, no spaces |
| `ACOCAM_PORTAL_LOGIN_URL` | `https://acocamtrading.ca/login` | |
| `ACOCAM_PORTAL_SIGNUP_URL` | `https://acocamtrading.ca/login` | |
| `ACOCAM_PORTAL_QUOTE_URL` | `https://acocamtrading.ca/get-quote/` | |
| `TENANTS_DIR` | `./tenants` | Default OK |
| `DATA_DIR` | `./data` | Default OK |
| `AI_PROVIDER` | `null` | KB-only launch |
| `JWT_VALIDATE_EXP` | `true` | |
| `PERSIST_SESSIONS` | `true` | Ephemeral on free tier (see warnings) |
| `PERSIST_ANALYTICS` | `true` | |
| `PERSIST_ESCALATIONS` | `true` | |
| `RATE_LIMIT_PER_MINUTE` | `120` | |
| `MAX_MESSAGE_LENGTH` | `4000` | |
| `TOOL_TIMEOUT_MS` | `20000` | Raise if logistics host is slow |
| `DEFAULT_COUNTRY` | `Canada` | |

Render sets `PORT` automatically — do not hard-code it.

Optional: `ACOCAM_API_CHECK_TIMEOUT_MS=20000` for slow logistics hosts.

---

## Path A — Render FREE via Docker Hub (no GitHub)

Best when you will **not** push this repo to GitHub.

### Prerequisites (one-time)

1. [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) — installed and running.
2. Free [Docker Hub](https://hub.docker.com/) account — e.g. username `yourname`.
3. Free [Render](https://render.com/) account — no credit card required for free web services.

### Step 1 — Prepare env locally

```powershell
cd D:\acocam-ai-chatbot
copy env.production.example .env
# Edit .env with live keys and logistics URL, then verify:
npm run check:prod
```

### Step 2 — Build and push Docker image

Replace `yourname` with your Docker Hub username.

```powershell
cd D:\acocam-ai-chatbot

docker login

docker build -t yourname/acocam-chatbot-api:latest .

docker push yourname/acocam-chatbot-api:latest
```

First build takes several minutes (npm install + build + reindex).

### Step 3 — Create Render web service from image

1. Open [Render Dashboard](https://dashboard.render.com/) → **New +** → **Web Service**.
2. Choose **Deploy an existing image from a registry**.
3. Image URL: `docker.io/yourname/acocam-chatbot-api:latest`
4. **Instance type**: **Free**
5. **Name**: e.g. `acocam-chatbot-api`
6. **Region**: Ohio (or nearest)
7. **Health check path**: `/v1/health`
8. Click **Advanced** → add all env vars from the table above.
9. Create web service.

Render assigns a URL like `https://acocam-chatbot-api.onrender.com`.

### Step 4 — Verify

```powershell
# Replace with your Render URL
curl https://acocam-chatbot-api.onrender.com/v1/health
curl https://acocam-chatbot-api.onrender.com/embed/agent-embed.js -I
```

Open `https://YOUR-SERVICE.onrender.com/demo` — chat widget should appear (may be slow on first load if sleeping).

### Step 5 — WordPress (wp-admin)

**Settings → Agent Embed**:

| Field | Value |
|-------|-------|
| API base | `https://YOUR-SERVICE.onrender.com/v1` |
| Embed script | `https://YOUR-SERVICE.onrender.com/embed/agent-embed.js` |
| Tenant | `acocam` |
| Agent ID | `customer-support` |
| Publishable key | same as `ACOCAM_PUBLISHABLE_KEY` |

Optional custom domain (free SSL on Render): add `chat-api.acocamtrading.ca` in Render → Settings → Custom Domains, then CNAME in DNS.

### Updating after code changes (no GitHub)

```powershell
cd D:\acocam-ai-chatbot
docker build -t yourname/acocam-chatbot-api:latest .
docker push yourname/acocam-chatbot-api:latest
```

In Render → **Manual Deploy** → deploy latest image (or enable auto-deploy from registry if available).

---

## Path B — Render FREE via GitHub (easier auto-deploy)

Use if you later connect a **private** GitHub repo (read-only deploy is fine).

1. Push repo to GitHub (private). Do **not** commit `.env`.
2. Render → **New +** → **Blueprint** or **Web Service** → connect repo.
3. Render detects `render.yaml` or set:
   - **Runtime**: Docker
   - **Dockerfile path**: `./Dockerfile`
   - **Plan**: Free
   - **Health check**: `/v1/health`
4. Paste secret env vars in dashboard.
5. Deploy — each push redeploys automatically.

---

## Path C — Fly.io (not free for new accounts)

Fly.io removed ongoing free allowances for new signups (2024). New accounts get a **short trial** (~2 VM hours / 7 days), then pay-as-you-go (~**$5+/month** for a small always-on app).

If you already have legacy free allowances or accept paid:

```powershell
# Install: https://fly.io/docs/hands-on/install-flyctl/
cd D:\acocam-ai-chatbot
fly launch --no-deploy
fly secrets set NODE_ENV=production ACOCAM_PUBLISHABLE_KEY=pk_live_... ACOCAM_SECRET_KEY=sk_live_... CORS_ORIGIN=https://acocamtrading.ca,https://www.acocamtrading.ca ACOCAM_API_BASE_URL=https://...
fly deploy
```

A `fly.toml` is not required when using `Dockerfile`; `fly launch` can generate one.

---

## Path D — Railway (limited / mostly paid)

| Plan | Cost | Reality for this API |
|------|------|----------------------|
| Trial | $5 credits, 30 days | Good for testing |
| Free | $1/month credits | Too small for always-on Node + outbound logistics calls |
| Hobby | **$5/month** + usage | Minimum for reliable production |

Railway expects GitHub connect. Not recommended as a **free** Step 1 path in 2026.

---

## Path E — Glitch / Replit (not recommended)

| Platform | Issue |
|----------|-------|
| **Glitch** | Projects sleep; Node servers not meant for persistent API workloads. |
| **Replit** | Always-on requires paid plan; cold starts and resource limits. |

Fine for demos, not for acocamtrading.ca production embed.

---

## Path F — Oracle Cloud Always Free (advanced)

Truly free ARM VM (24 GB RAM total across instances) with persistent disk — but you must:

- Create Oracle Cloud account (credit card for verification)
- Provision Ubuntu ARM instance, open ports 80/443
- Install Node 20, clone/copy project, PM2, nginx/Caddy, Let's Encrypt
- Manage updates and security yourself

Use [GO_LIVE.md](GO_LIVE.md) Phase 2 VPS steps. Best if you outgrow Render sleep limits and want $0 infra with Linux comfort.

---

## Optional — package zip (VPS or backup)

```powershell
cd D:\acocam-ai-chatbot
.\scripts\package-for-deploy.ps1
```

Creates `acocam-chatbot-deploy.zip` (no `.env`, no `node_modules`). Upload to any VPS, then:

```bash
unzip acocam-chatbot-deploy.zip -d acocam-chatbot
cd acocam-chatbot
npm install --omit=dev
cp /path/to/.env .env
node apps/api/dist/index.js
```

---

## Cold start mitigation (free tier)

1. Set `TOOL_TIMEOUT_MS=20000` (or higher) in Render env.
2. Use an external free uptime pinger (e.g. UptimeRobot every 14 min) to **reduce** sleep — uses Render free hours faster; optional tradeoff.
3. Tell support staff: first track/quote after quiet period may need a retry.
4. For production SLA, upgrade Render to **Starter (~$7/month)** — no spin-down.

---

## Quick checklist

- [ ] `npm run check:prod` passes locally
- [ ] Docker image builds and `/v1/health` returns 200 on Render
- [ ] `CORS_ORIGIN` includes `https://acocamtrading.ca`
- [ ] Live keys set (not demo)
- [ ] Logistics API URL reachable from Render (public HTTPS)
- [ ] WordPress plugin points to Render URL
- [ ] Test: guest FAQ, track shipment, login → book shipment

---

## Commands reference (Windows PowerShell)

```powershell
# Local verify
npm run check:prod
npm run check:acocam-api

# Docker deploy (no GitHub)
docker build -t yourname/acocam-chatbot-api:latest .
docker push yourname/acocam-chatbot-api:latest

# Optional zip
.\scripts\package-for-deploy.ps1
```

No git commit or push is required for Path A.
