# ACOCAM Local Model Training — Specifications

Local LoRA fine-tune on the ACOCAM knowledge base. **No cloud LLM API.**

## Model

| Item | Specification |
|------|----------------|
| Base model | `Qwen/Qwen2.5-1.5B-Instruct` (upgraded from 0.5B) |
| Model family | Qwen2.5 Instruct |
| Approx. parameters | ~1.5B class |
| Training method | LoRA (PEFT), not full fine-tune / not from-scratch |
| Trainable parameters | ~2,162,688 (~0.44% of total) |
| Frozen base weights | Yes (LoRA adapters only) |
| Output artifact | `ml/models/acocam-lora/` (adapter + tokenizer) |
| Served model name | `acocam-lora` |

## LoRA configuration

| Item | Specification |
|------|----------------|
| Rank (`r`) | 16 |
| Alpha (`lora_alpha`) | 32 |
| Dropout | 0.05 |
| Bias | none |
| Task type | `CAUSAL_LM` |
| Target modules | `q_proj`, `k_proj`, `v_proj`, `o_proj` |

## Dataset

| Item | Specification |
|------|----------------|
| Source file | `tenants/acocam/knowledge/knowledge-base.md` |
| Extracted Q&A pairs | 206 |
| Training rows (with paraphrases) | 1228 |
| Dataset file | `ml/data/acocam_sft.jsonl` |
| Format | Chat messages: `system` + `user` + `assistant` |
| Prep script | `python ml/prepare_dataset.py` |

## Training hyperparameters

| Item | Default |
|------|---------|
| Trainer | HuggingFace `transformers.Trainer` + PEFT |
| Epochs | 3 (`--epochs 2` recommended on CPU) |
| Per-device batch size | 1 |
| Gradient accumulation steps | 8 |
| Effective batch size | ~8 |
| Learning rate | `2e-4` |
| Max sequence length | 768 |
| Precision | FP32 on CPU; auto dtype on GPU |
| Gradient checkpointing | Off |
| Checkpoint strategy | Save each epoch under `ml/models/acocam-lora/checkpoints/` |
| Train script | `python ml/train_lora.py` |

### Common CLI overrides

```powershell
python ml\train_lora.py --cpu --batch-size 1 --epochs 2
python ml\train_lora.py --base-model Qwen/Qwen2.5-1.5B-Instruct
python ml\train_lora.py --epochs 3 --lr 2e-4 --max-seq-length 768
```

## Serving

| Item | Specification |
|------|----------------|
| Serve script | `python ml/serve.py` |
| Host | `127.0.0.1` |
| Port | `8090` |
| API style | OpenAI-compatible |
| Chat endpoint | `POST http://127.0.0.1:8090/v1/chat/completions` |
| Health | `GET http://127.0.0.1:8090/health` |

## Agent Platform wiring

Set in `.env`:

```env
AI_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:8090/v1
AI_MODEL=acocam-lora
AI_API_KEY=local
```

Then restart the API (`npm run reindex` / `npm run dev`) and test at `http://127.0.0.1:8787/demo`.

## Hardware guidance

| Hardware | Recommendation |
|----------|----------------|
| NVIDIA GPU ~8GB+ VRAM | `python ml\train_lora.py` |
| NVIDIA GPU ~4–6GB VRAM | Keep 0.5B; `--batch-size 1` |
| CPU only | `python ml\train_lora.py --cpu --batch-size 1 --epochs 2` (slow) |

## End-to-end commands

```powershell
cd D:\acocam-ai-chatbot
.\.venv-ml\Scripts\Activate.ps1
pip install -r ml\requirements.txt

python ml\prepare_dataset.py
python ml\train_lora.py
python ml\serve.py
```

## Related docs

- [ml/README.md](../ml/README.md) — full training guide  
- [docs/TRAINING.md](TRAINING.md) — short overview  
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — platform architecture  
