# Training the ACOCAM agent on the knowledge base

See the full guide: [ml/README.md](../ml/README.md).

**Specifications (model, LoRA, dataset, hyperparameters):** [MODEL_TRAINING_SPEC.md](MODEL_TRAINING_SPEC.md)

**Short version**

1. Knowledge Q&A pairs are indexed automatically on `npm run reindex` / API boot (answers every catalog question via retrieval).
2. Optional local LoRA fine-tune (no cloud LLM): `python ml/prepare_dataset.py` → `python ml/train_lora.py` → `python ml/serve.py`
3. Set `AI_PROVIDER=local` in `.env` to use the fine-tuned model with KB grounding.
