# Local model training (Path C) — no cloud LLM API

Train a small open-source model on the ACOCAM knowledge-base Q&A pairs, then serve it locally. The Agent Platform talks to it like an OpenAI-compatible endpoint on your machine.

## What this does

1. Extracts every `Qn. …` / answer pair from [`tenants/acocam/knowledge/knowledge-base.md`](../tenants/acocam/knowledge/knowledge-base.md)
2. LoRA fine-tunes `Qwen/Qwen2.5-1.5B-Instruct` (default; GPU preferred, CPU possible but slow). Use `--base-model Qwen/Qwen2.5-0.5B-Instruct` if memory is tight.
3. Serves `http://127.0.0.1:8090/v1/chat/completions`
4. Platform uses `AI_PROVIDER=local` + KB retrieval so answers stay grounded

## Setup (Python 3.10+)

```powershell
cd D:\acocam-ai-chatbot
python -m venv .venv-ml
.\.venv-ml\Scripts\Activate.ps1
pip install -r ml\requirements.txt
```

## 1) Build dataset

```powershell
python ml\prepare_dataset.py
```

Writes `ml/data/acocam_sft.jsonl` (Q&A + paraphrases).

## 2) Train LoRA

GPU (recommended):

```powershell
python ml\train_lora.py
```

CPU only (slow):

```powershell
python ml\train_lora.py --cpu --batch-size 1 --epochs 2
```

Uses HuggingFace `Trainer` + PEFT LoRA (avoids TRL 1.9 bugs).

Output adapter: `ml/models/acocam-lora/`

## 3) Serve locally

```powershell
python ml\serve.py
# or: python ml\serve.py --cpu
```

Check: `http://127.0.0.1:8090/health`

## 4) Point the Agent Platform at it

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

Open `http://127.0.0.1:8787/demo` and ask knowledge questions.

## Important limits

- The model only knows what was in the training Q&A + retrieved KB snippets at runtime.
- It will **not** invent live tracking/prices; tools + workflows still handle those.
- After you edit the knowledge base: re-run `prepare_dataset.py` → `train_lora.py` → restart `serve.py`, and `npm run reindex`.
- True “from scratch” training is not used; LoRA on a small base model is the practical Path C.

## Hardware notes

| Hardware | Expectation |
|----------|-------------|
| NVIDIA 8GB+ | Comfortable LoRA on 0.5B–1.5B |
| NVIDIA 4–6GB | Use 0.5B, batch size 1 |
| CPU only | Dataset + KB Q&A indexing still work; training/serve will be slow |
