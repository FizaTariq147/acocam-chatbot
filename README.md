# AI Agent Platform

Reusable multi-tenant AI agent platform. ACOCAM is Tenant #1.

## Quick start

```bash
npm install
cp .env.example .env
npm run reindex
npm run dev
```

Open [examples/embed-demo.html](examples/embed-demo.html) or visit `http://localhost:8787/demo` (root `/` redirects there).

Docs: [docs/PLATFORM_PLAN.md](docs/PLATFORM_PLAN.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/TENANT_GUIDE.md](docs/TENANT_GUIDE.md) · [docs/EMBED.md](docs/EMBED.md) · [docs/TRAINING.md](docs/TRAINING.md)

Local fine-tune (no cloud LLM):

```powershell
.\.venv-ml\Scripts\Activate.ps1
pip install -r ml\requirements.txt
python ml\train_pipeline.py
python ml\serve.py
```

Then set `AI_PROVIDER=local` in `.env`. Full guide: [ml/README.md](ml/README.md).
