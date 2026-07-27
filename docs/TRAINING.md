# Training the ACOCAM agent on the knowledge base

See the full guide: [ml/README.md](../ml/README.md).

**Specifications (model, LoRA, dataset, hyperparameters):** [MODEL_TRAINING_SPEC.md](MODEL_TRAINING_SPEC.md)

**Short version**

1. Knowledge Q&A pairs are indexed automatically on `npm run reindex` / API boot (answers every catalog question via retrieval). Prefer `knowledge-qa.md` when present.
2. Optional local LoRA fine-tune (no cloud LLM):

```powershell
.\.venv-ml\Scripts\Activate.ps1
python ml\train_pipeline.py          # GPU
python ml\train_pipeline.py --cpu --small --epochs 2   # CPU
python ml\serve.py
```

3. Set `AI_PROVIDER=local` in `.env`, then `npm run reindex` && `npm run dev`.
4. Open `http://127.0.0.1:8787/demo` (root `/` redirects here).
