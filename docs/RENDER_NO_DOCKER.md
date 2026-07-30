# Go live on Render — no Docker on your PC

Render **builds on their servers**. You never install or run Docker locally.

You only need:
- A **GitHub** account (free)
- A **private** repo with this project
- A **Render** account (free, no credit card)

---

## Step 1 — Push to a private GitHub repo

**Do not commit `.env`** (it has secrets).

```powershell
cd D:\acocam-ai-chatbot

# Confirm .env is gitignored
git status
# .env should NOT appear in "Changes to be committed"

# Create a new PRIVATE repo on github.com (empty, no README)
# Then connect and push (replace YOUR_USER and repo name):

git remote add render-origin https://github.com/YOUR_USER/acocam-chatbot.git
git add .
git commit -m "Deploy chatbot API to Render"
git push render-origin HEAD:main
```

If you already have a remote, use your existing branch name instead of `main`.

> Only push when you are ready. Use a **private** repo so keys in tenant settings stay off the public web.

---

## Step 2 — Create Render web service

1. Open https://dashboard.render.com (sign up with GitHub — **no credit card** for Free)
2. **New +** → **Web Service**
3. Connect your **private GitHub** repo
4. Settings:

| Field | Value |
|-------|--------|
| **Name** | `acocam-chatbot-api` |
| **Region** | Ohio (or nearest) |
| **Branch** | `main` (or your branch) |
| **Runtime** | **Node** |
| **Build Command** | `npm install && npm run build && npm run reindex` |
| **Start Command** | `node apps/api/dist/index.js` |
| **Instance type** | **Free** |
| **Health Check Path** | `/v1/health` |

5. **Environment** → add variables from:

```powershell
npm run render:env
```

Mark `ACOCAM_PUBLISHABLE_KEY` and `ACOCAM_SECRET_KEY` as **Secret**.

Also add:

| Key | Value |
|-----|--------|
| `NODE_VERSION` | `20` |

6. **Create Web Service** — wait for first deploy (5–15 min)

---

## Step 3 — Verify live

Render gives you a URL like `https://acocam-chatbot-api.onrender.com`

```powershell
Invoke-RestMethod "https://YOUR-SERVICE.onrender.com/v1/health"
```

Browser:
- `https://YOUR-SERVICE.onrender.com/demo`
- `https://YOUR-SERVICE.onrender.com/v1/health`

First visit after idle may take **30–60 seconds** (free tier sleep).

---

## Step 4 — WordPress (later)

Save these for wp-admin → **Agent Embed**:

| Field | Value |
|-------|--------|
| API base | `https://YOUR-SERVICE.onrender.com/v1` |
| Embed script | `https://YOUR-SERVICE.onrender.com/embed/agent-embed.js` |
| Publishable key | same as `ACOCAM_PUBLISHABLE_KEY` |

---

## Alternative — Render builds Dockerfile (still no local Docker)

If native Node build fails, use **Docker runtime on Render** (Docker runs only on Render’s machines):

| Field | Value |
|-------|--------|
| **Runtime** | **Docker** |
| **Dockerfile path** | `./Dockerfile` |

Or use **Blueprint** → Render reads `render.yaml` from the repo.

---

## Update after code changes

```powershell
git add .
git commit -m "Update chatbot"
git push
```

Render redeploys automatically.

---

## Uninstall Docker Desktop (optional)

If you installed Docker only for this project, you can remove it:

- Windows **Settings → Apps → Docker Desktop → Uninstall**

You do **not** need Docker for this path.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Build fails on Render | Check **Logs** tab; ensure `NODE_VERSION=20` |
| Health check failed | Wait for build to finish; path must be `/v1/health` |
| 502 after idle | Free tier waking up — wait 60s, retry |
| CORS on website | `CORS_ORIGIN` includes `https://acocamtrading.ca` |

---

## Quick checklist

- [ ] Private GitHub repo (no `.env` committed)
- [ ] Render Web Service — **Node**, Free plan
- [ ] Env vars pasted from `npm run render:env`
- [ ] `/v1/health` returns OK
- [ ] `/demo` shows chat widget
