# Deploy on Hugging Face Spaces (Docker, no local Docker)

Host the chatbot API on a **Hugging Face Space** with a public URL like:

`https://YOUR-USER-acocam-chatbot.hf.space`

**No credit card** for free CPU Spaces. **No Docker** on your PC — HF builds the container.

---

## Important limitations

| Topic | Reality |
|-------|---------|
| Best use | Demo / testing / low-traffic launch |
| Production | HF Spaces are for ML demos; Render is better for 24/7 WordPress embed |
| Sleep | Free Spaces may pause when idle — cold start on next visit |
| Disk | No persistent sessions — `data/` resets on restart |
| Port | Must use **7860** (HF rule), not 8787 |
| Secrets | Set in Space **Settings → Variables** — never commit `.env` |

---

## Step 1 — Create a Hugging Face account

1. https://huggingface.co/join (free)
2. Verify email

---

## Step 2 — Create a Docker Space

1. https://huggingface.co/new-space
2. Settings:

| Field | Value |
|-------|--------|
| Space name | `acocam-chatbot` (or your choice) |
| License | Apache-2.0 or MIT |
| SDK | **Docker** |
| Hardware | **CPU basic** (free) |
| Visibility | **Public** (required for free embed URL) or Private (paid) |

3. Create Space

---

## Step 3 — Connect your GitHub repo

**Option A — GitHub sync (easiest if you already pushed code)**

1. Space → **Settings** → **Repository** → link GitHub
2. Select repo `acocam-chatbot`, branch `developer2`
3. HF builds from root `Dockerfile`

**Option B — Push directly to HF git**

```powershell
cd D:\acocam-ai-chatbot
git remote add hf https://huggingface.co/spaces/YOUR_HF_USER/acocam-chatbot
git push hf developer2:main
```

Replace `YOUR_HF_USER` and space name.

---

## Step 4 — Space README (required YAML)

HF needs this at the **top** of the Space `README.md`.  
If your repo README doesn’t have it, edit README on the HF Space web UI and add:

```markdown
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

Node.js chatbot for acocamtrading.ca — KB, tracking, quotes.

- Health: `/v1/health`
- Demo: `/demo`
- Embed: `/embed/agent-embed.js`
```

`app_port: 7860` **must** match `PORT=7860` below.

---

## Step 5 — Space environment variables

Space → **Settings** → **Variables and secrets** → add each:

| Variable | Value | Secret? |
|----------|--------|---------|
| `PORT` | `7860` | No |
| `NODE_ENV` | `production` | No |
| `HOST` | `0.0.0.0` | No |
| `TRUST_PROXY` | `true` | No |
| `TENANTS_DIR` | `./tenants` | No |
| `DATA_DIR` | `./data` | No |
| `ACOCAM_PUBLISHABLE_KEY` | your `pk_live_...` | **Yes** |
| `ACOCAM_SECRET_KEY` | your `sk_live_...` | **Yes** |
| `ACOCAM_API_BASE_URL` | `https://mediumblue-jackal-717379.hostingersite.com` | No |
| `CORS_ORIGIN` | `https://acocamtrading.ca,https://www.acocamtrading.ca` | No |
| `ACOCAM_PORTAL_LOGIN_URL` | `https://acocamtrading.ca/login` | No |
| `ACOCAM_PORTAL_SIGNUP_URL` | `https://acocamtrading.ca/login` | No |
| `ACOCAM_PORTAL_QUOTE_URL` | `https://acocamtrading.ca/get-quote/` | No |
| `AI_PROVIDER` | `null` | No |
| `JWT_VALIDATE_EXP` | `true` | No |
| `TOOL_TIMEOUT_MS` | `20000` | No |
| `PERSIST_SESSIONS` | `true` | No |

Generate list locally:

```powershell
npm run render:env
```

Then add **`PORT=7860`** (override — HF requires 7860, not 8787).

---

## Step 6 — Build

After env vars and README YAML are set:

1. Space → **Factory** (or wait for auto-build)
2. First build takes **10–20 minutes** (npm install + build + reindex)
3. Watch **Logs** for errors

Common fix if stuck on “Starting”:

- App must listen on **`0.0.0.0:7860`** → `HOST=0.0.0.0` and `PORT=7860`
- README must have `app_port: 7860`

---

## Step 7 — Verify live

Your base URL:

```
https://YOUR-HF-USER-acocam-chatbot.hf.space
```

```powershell
$Base = "https://YOUR-HF-USER-acocam-chatbot.hf.space"
Invoke-RestMethod "$Base/v1/health"
```

Browser:

- `BASE/v1/health`
- `BASE/demo`
- `BASE/embed/agent-embed.js`

---

## Step 8 — WordPress (later)

wp-admin → **Agent Embed**:

| Field | Value |
|-------|--------|
| API base | `https://YOUR-HF-USER-acocam-chatbot.hf.space/v1` |
| Embed script | `https://YOUR-HF-USER-acocam-chatbot.hf.space/embed/agent-embed.js` |
| Publishable key | same as `ACOCAM_PUBLISHABLE_KEY` |

---

## Update after code changes

Push to connected GitHub branch — HF rebuilds automatically.

Or:

```powershell
git push hf main
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Stuck on “Building” / “Starting” | Logs tab; confirm `PORT=7860`, `HOST=0.0.0.0`, `app_port: 7860` |
| 404 on `/v1/health` | Wait for build; check logs for crash |
| CORS on website | `CORS_ORIGIN` includes `https://acocamtrading.ca` |
| Tracking fails | Logistics API must be public HTTPS; retry after cold start |
| Build out of memory | Free CPU has 16GB RAM — should be enough; check logs |

---

## vs Render

| | Hugging Face | Render |
|---|--------------|--------|
| Credit card | No (free CPU) | No (free tier) |
| Purpose | ML / demos | Web apps |
| Port | 7860 only | Any |
| WordPress production | OK for testing | Better for long-term |

---

## Quick checklist

- [ ] Docker Space created (CPU basic, free)
- [ ] README YAML: `sdk: docker`, `app_port: 7860`
- [ ] `PORT=7860` in Space variables
- [ ] All secrets from `npm run render:env` + live keys
- [ ] `/v1/health` OK
- [ ] `/demo` works
