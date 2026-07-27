# Local model training (Path C) — no cloud LLM API

Train a small open-source model on ACOCAM knowledge-base Q&A pairs, then serve it locally. The Agent Platform talks to it like an OpenAI-compatible endpoint on your machine.

## What this does

1. Extracts every `Qn. …` / answer pair from `knowledge base/*.md` (de-duplicated)
2. Writes `ml/data/acocam_sft.jsonl` + `tenants/acocam/knowledge/knowledge-qa.md`
3. LoRA fine-tunes `Qwen/Qwen2.5-1.5B-Instruct` (default). Use `--small` for `0.5B` if memory is tight.
4. Serves `http://127.0.0.1:8090/v1/chat/completions`
5. Platform uses `AI_PROVIDER=local` + KB retrieval so answers stay grounded

## Setup (Python 3.10+)

```powershell
cd D:\acocam-chatbot
python -m venv .venv-ml
.\.venv-ml\Scripts\Activate.ps1
pip install -r ml\requirements.txt
```

## One-command pipeline

GPU (recommended):

```powershell
.\.venv-ml\Scripts\Activate.ps1
python ml\train_pipeline.py
# or: .\ml\train.ps1
```

CPU only (slower; smaller model + fewer epochs):

```powershell
python ml\train_pipeline.py --cpu --small --epochs 2
# or: .\ml\train.ps1 -Cpu -Small -Epochs 2
```

Prepare dataset only:

```powershell
python ml\train_pipeline.py --prepare-only
```

Train then start the local model server:

```powershell
python ml\train_pipeline.py --serve
```

## Step-by-step

### 1) Build dataset

```powershell
python ml\prepare_dataset.py
```

Writes:

- `ml/data/acocam_sft.jsonl` — training rows (~1228 from 206 unique Q&A)
- `ml/data/acocam_sft.meta.json` — source stats
- `tenants/acocam/knowledge/knowledge-qa.md` — merged corpus for runtime retrieval

### 2) Train LoRA

```powershell
python ml\train_lora.py
```

CPU:

```powershell
python ml\train_lora.py --cpu --small --epochs 2 --batch-size 1
```

Output adapter: `ml/models/acocam-lora/`

### 3) Serve locally

```powershell
python ml\serve.py
# or: python ml\serve.py --cpu
```

Check: [http://127.0.0.1:8090/health](http://127.0.0.1:8090/health)

### 4) Point the Agent Platform at it

In `.env`:

```env
AI_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:8090/v1
AI_MODEL=acocam-lora
AI_API_KEY=local
```

Restart:

```powershell
npm run reindex
npm run dev
```

Open [http://127.0.0.1:8787/demo](http://127.0.0.1:8787/demo) (root `/` redirects here) and ask knowledge questions.

## Important limits

- The model only knows what was in the training Q&A + retrieved KB snippets at runtime.
- It will **not** invent live tracking/prices; tools + workflows still handle those.
- After you edit the knowledge base: re-run prepare → train → restart serve, and `npm run reindex`.
- True “from scratch” training is not used; LoRA on a small base model is the practical path.

## Hardware notes

| Hardware | Expectation |
|----------|-------------|
| NVIDIA 8GB+ | Comfortable LoRA on 0.5B–1.5B |
| NVIDIA 4–6GB | Use `--small` (0.5B), batch size 1 |
| CPU only | Use `--cpu --small --epochs 2`; training/serve will be slow |
