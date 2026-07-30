# Go live on Render now (no credit card)

Fast checklist for **Step 1** — public chatbot API URL. WordPress is Step 2.

Your local `.env` is ready (`npm run check:prod` passes). Pick **Path A** or **Path B**.

---

## Path A — Docker Hub (no GitHub) — recommended

### You need (one-time)

| Item | Link | Cost |
|------|------|------|
| Render account | [render.com](https://render.com) | Free, **no card** |
| Docker Hub | [hub.docker.com](https://hub.docker.com) | Free |
| Docker Desktop | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) | Free |

### Run on your PC

```powershell
cd D:\acocam-ai-chatbot
.\scripts\deploy-render.ps1
```

Or manually:

```powershell
npm run check:prod
node scripts/render-env-export.mjs

docker login
docker build -t YOUR_DOCKERHUB_USER/acocam-chatbot-api:latest .
docker push YOUR_DOCKERHUB_USER/acocam-chatbot-api:latest
```

### Render Dashboard

1. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**
2. **Deploy an existing image from a registry**
3. **Image URL:** `docker.io/YOUR_DOCKERHUB_USER/acocam-chatbot-api:latest`
4. **Name:** `acocam-chatbot-api`
5. **Region:** Ohio (or closest)
6. **Instance type:** **Free**
7. **Health Check Path:** `/v1/health`
8. **Environment** → paste output from `node scripts/render-env-export.mjs`
   - Mark `ACOCAM_PUBLISHABLE_KEY` and `ACOCAM_SECRET_KEY` as **Secret**
9. **Create Web Service** — wait for deploy (~2–5 min)

**Do not add a payment method** unless you upgrade to paid.

### Verify

```powershell
$Base = "https://acocam-chatbot-api.onrender.com"   # your Render URL
Invoke-RestMethod "$Base/v1/health"
```

Browser:
- `https://YOUR-SERVICE.onrender.com/v1/health`
- `https://YOUR-SERVICE.onrender.com/demo`

First load after idle may take **30–60 seconds** (free tier sleep).

---

## Path B — GitHub on Render (no local Docker)

Use if you **cannot** install Docker Desktop.

1. Push this repo to a **private** GitHub repo (do not commit `.env`)
2. Render → **New +** → **Web Service** → connect GitHub repo
3. Settings:
   - **Language:** Docker
   - **Dockerfile path:** `./Dockerfile`
   - **Plan:** Free
   - **Health check:** `/v1/health`
4. Paste env vars from `node scripts/render-env-export.mjs`
5. Deploy

Render builds the image on their servers — no Docker on your PC.

---

## After live — save your URL

Write down:

```
API base:     https://YOUR-SERVICE.onrender.com/v1
Embed script: https://YOUR-SERVICE.onrender.com/embed/agent-embed.js
Publishable:  (same as ACOCAM_PUBLISHABLE_KEY in .env)
```

Use these in WordPress **Step 2** (`docs/GO_LIVE.md` Phase 3).

---

## Update after code changes

**Path A (Docker):**

```powershell
.\scripts\deploy-render.ps1
```

Then Render → **Manual Deploy** → Deploy latest image.

**Path B (GitHub):** push to repo → auto-redeploy.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Docker not found | Install Docker Desktop, restart PC |
| Health check failed | Check Render logs; wait for build to finish |
| 502 on first visit | Free tier waking up — wait 60s, retry |
| CORS error on site | `CORS_ORIGIN` must include `https://acocamtrading.ca` |
| Tracking fails once | Set `TOOL_TIMEOUT_MS=20000`, retry after cold start |

---

## npm scripts

```powershell
npm run render:env      # print env vars for Render dashboard
npm run deploy:render   # full Docker build + push helper
```
