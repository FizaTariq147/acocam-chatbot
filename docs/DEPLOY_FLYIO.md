# Deploy chatbot API on Fly.io (from Windows)

Step 1 go-live: get a public HTTPS URL for the chatbot API. WordPress integration is Step 2.

**Billing note (2026):** Fly.io has **no permanent free tier** for new accounts. You get a short trial (~2 VM hours or 7 days). After that you need a credit card; a small always-on app is typically **~$3–5/month**. For **free** hosting, use [DEPLOY_STEP1_FREE.md](./DEPLOY_STEP1_FREE.md) (Render).

---

## What you need

- Windows PC with this repo at `D:\acocam-ai-chatbot`
- Production `.env` ready (`npm run check:prod` passes)
- [Fly.io account](https://fly.io/app/sign-up)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Fly builds from `Dockerfile`)

---

## 1. Install Fly CLI

**PowerShell (recommended):**

```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Close and reopen PowerShell, then:

```powershell
fly version
```

---

## 2. Log in

```powershell
fly auth login
```

Browser opens → sign in to Fly.io.

---

## 3. Create the app (first time only)

From repo root:

```powershell
cd D:\acocam-ai-chatbot
```

**Option A — use existing `fly.toml` (recommended)**

The repo includes `fly.toml` with app name `acocam-chatbot-api`. If that name is taken globally, edit `app = '...'` in `fly.toml` to something unique (e.g. `acocam-chat-acocamtrading`).

```powershell
fly apps create acocam-chatbot-api
```

Skip if `fly launch` creates it for you.

**Option B — interactive launch**

```powershell
fly launch --no-deploy
```

- Use existing `fly.toml` when asked
- Region: **Toronto (yyz)** — close to Canada
- Do **not** add Postgres/Redis
- Confirm Dockerfile deploy

---

## 4. Set secrets (from your `.env`)

Never commit secrets. Paste your real values:

```powershell
fly secrets set `
  ACOCAM_PUBLISHABLE_KEY="pk_live_YOUR_KEY" `
  ACOCAM_SECRET_KEY="sk_live_YOUR_SECRET" `
  ACOCAM_API_BASE_URL="https://mediumblue-jackal-717379.hostingersite.com" `
  CORS_ORIGIN="https://acocamtrading.ca,https://www.acocamtrading.ca" `
  ACOCAM_PORTAL_LOGIN_URL="https://acocamtrading.ca/login" `
  ACOCAM_PORTAL_SIGNUP_URL="https://acocamtrading.ca/login" `
  ACOCAM_PORTAL_QUOTE_URL="https://acocamtrading.ca/get-quote/"
```

To set many at once from `.env` (manual — Fly has no `--env-file` for all vars):

```powershell
# Example: read .env and set secrets (run from repo root)
Get-Content .env | Where-Object { $_ -match '^[A-Z]' -and $_ -notmatch '^#' } | ForEach-Object {
  $p = $_ -split '=', 2
  if ($p[0] -in @('ACOCAM_PUBLISHABLE_KEY','ACOCAM_SECRET_KEY','ACOCAM_API_BASE_URL','CORS_ORIGIN',
      'ACOCAM_PORTAL_LOGIN_URL','ACOCAM_PORTAL_SIGNUP_URL','ACOCAM_PORTAL_QUOTE_URL')) {
    fly secrets set "$($p[0])=$($p[1].Trim('"'))"
  }
}
```

---

## 5. Deploy

```powershell
cd D:\acocam-ai-chatbot
fly deploy
```

First deploy builds the Docker image on Fly’s servers (several minutes). Later deploys are faster.

---

## 6. Verify

Your URL is `https://<app-name>.fly.dev` (from `fly.toml` → `app`).

```powershell
$Base = "https://acocam-chatbot-api.fly.dev"   # change if you renamed the app
Invoke-RestMethod "$Base/v1/health"
```

Browser checks:

| URL | Expected |
|-----|----------|
| `BASE/v1/health` | `ok: true`, `knowledgeReady: true` |
| `BASE/demo` | Chat widget demo |
| `BASE/embed/agent-embed.js` | JavaScript loads |

Logs:

```powershell
fly logs
```

Status:

```powershell
fly status
```

---

## 7. Keep it running (cost)

Default `fly.toml` uses:

- `auto_stop_machines = 'stop'` — saves money when idle (cold start on next visit)
- `min_machines_running = 0`

For **always-on** (no cold start, ~$3–5/mo):

Edit `fly.toml`:

```toml
min_machines_running = 1
auto_stop_machines = 'off'
```

Then:

```powershell
fly deploy
```

---

## 8. Custom domain (optional)

Example: `chat-api.acocamtrading.ca`

1. Fly dashboard → your app → **Certificates** → add hostname
2. DNS at Hostinger: CNAME `chat-api` → `<app-name>.fly.dev`
3. Wait for certificate (few minutes)

Update WordPress plugin later with `https://chat-api.acocamtrading.ca`.

---

## Step 2 — WordPress (after Fly URL works)

In wp-admin → **Settings → Agent Embed**:

| Field | Value |
|-------|--------|
| API base | `https://YOUR-APP.fly.dev/v1` |
| Embed script | `https://YOUR-APP.fly.dev/embed/agent-embed.js` |
| Publishable key | same as `ACOCAM_PUBLISHABLE_KEY` |
| Tenant | `acocam` |
| Agent ID | `customer-support` |

See [GO_LIVE.md](./GO_LIVE.md) Phase 3.

---

## Useful commands

```powershell
fly deploy              # redeploy after code changes
fly secrets list        # show secret names (not values)
fly ssh console         # shell inside running machine
fly scale memory 512    # adjust RAM
fly apps destroy acocam-chatbot-api   # remove app (careful)
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App name taken | Change `app` in `fly.toml`, run `fly apps create NEW_NAME` |
| Health check failing | `fly logs` — wait for build; check `/v1/health` path |
| 502 after idle | Normal with `auto_stop_machines`; retry or set `min_machines_running = 1` |
| CORS errors on website | `fly secrets set CORS_ORIGIN="https://acocamtrading.ca,https://www.acocamtrading.ca"` |
| Tracking timeout | Increase `TOOL_TIMEOUT_MS=20000` in `fly.toml` `[env]` and redeploy |

---

## No GitHub required

Deploy runs from your **local folder**. Fly builds from `Dockerfile`. You do not need to push to GitHub.

Do **not** commit `.env` or live secrets.
