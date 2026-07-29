"""
LoRA supervised fine-tune on ACOCAM Q&A using transformers Trainer
(avoids TRL 1.9 PEFT patch bug). Local only — no cloud LLM API.
"""

from __future__ import annotations

import argparse
import gc
import json
import sys
from pathlib import Path

import torch
from accelerate import init_empty_weights, load_checkpoint_and_dispatch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model
from transformers import (
    AutoConfig,
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_config import (  # noqa: E402
    default_adapter_dir,
    default_base_model,
    default_dataset_path,
    resolve_repo_path,
)

PAGE_FILE_HELP = """
Windows memory error (1455): your page file (virtual memory) is too small to load the model.

Fix (required on 8GB RAM machines):
  1. Close Chrome/browsers and other heavy apps
  2. Win+R → sysdm.cpl → Advanced → Performance Settings → Advanced
  3. Virtual memory → Change → uncheck automatic
  4. Custom size: Initial 16384 MB, Maximum 40960 MB → Set → OK → Reboot

Then retry with:
  python ml\\train_pipeline.py --train-only --cpu --small --epochs 2 --ultra-low-mem
"""


def resolve_checkpoint_dir(model_id: str) -> str:
    """Hub repo id → local cache path for accelerate dispatch."""
    local = Path(model_id)
    if local.exists():
        return str(local)
    from huggingface_hub import snapshot_download

    print(f"Resolving weights cache for {model_id}…")
    return snapshot_download(model_id)


def load_model_cpu_minimal(
    model_id: str,
    offload_folder: Path,
    dtype: torch.dtype,
    max_cpu: str = "2GiB",
) -> AutoModelForCausalLM:
    """
    Load without allocating the full weight tensor in RAM at once.
    Uses empty weights + checkpoint dispatch (critical on Windows 8GB).
    """
    offload_folder.mkdir(parents=True, exist_ok=True)
    print(f"Low-memory load: max_cpu={max_cpu}, offload={offload_folder}")

    config = AutoConfig.from_pretrained(model_id, trust_remote_code=True)
    with init_empty_weights():
        model = AutoModelForCausalLM.from_config(config, trust_remote_code=True)
    if hasattr(model, "tie_weights"):
        model.tie_weights()

    checkpoint = resolve_checkpoint_dir(model_id)
    max_memory = {"cpu": max_cpu}

    try:
        model = load_checkpoint_and_dispatch(
            model,
            checkpoint,
            device_map="auto",
            max_memory=max_memory,
            offload_folder=str(offload_folder),
            dtype=dtype,
            no_split_module_classes=getattr(model, "_no_split_modules", None),
        )
    except OSError as err:
        if getattr(err, "winerror", None) == 1455 or "paging file" in str(err).lower():
            raise SystemExit(PAGE_FILE_HELP) from err
        raise

    return model


def load_model_cpu_standard(model_id: str, dtype: torch.dtype) -> AutoModelForCausalLM:
    """Fallback: direct load on CPU (works for 0.5B + fp16 on most 8GB machines)."""
    print("Standard CPU load (no checkpoint dispatch)")
    try:
        return AutoModelForCausalLM.from_pretrained(
            model_id,
            trust_remote_code=True,
            dtype=dtype,
            device_map="cpu",
            low_cpu_mem_usage=True,
        )
    except TypeError:
        return AutoModelForCausalLM.from_pretrained(
            model_id,
            trust_remote_code=True,
            torch_dtype=dtype,
            device_map="cpu",
            low_cpu_mem_usage=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune ACOCAM LoRA adapter on Q&A dataset")
    parser.add_argument("--data", type=Path, default=default_dataset_path())
    parser.add_argument("--base-model", default=default_base_model())
    parser.add_argument("--out", type=Path, default=Path(default_adapter_dir()))
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--max-seq-length", type=int, default=768)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--cpu", action="store_true", help="Force CPU training")
    parser.add_argument(
        "--cpu-dtype",
        type=str,
        default="fp16",
        help="CPU precision: fp16 (lowest RAM) or bf16 or fp32.",
    )
    parser.add_argument(
        "--cpu-offload",
        action="store_true",
        help="Low-memory load via accelerate checkpoint dispatch (recommended on CPU).",
    )
    parser.add_argument(
        "--ultra-low-mem",
        action="store_true",
        help="Aggressive RAM savings: fp16, 2GiB cap, LoRA r=8, enables cpu-offload.",
    )
    parser.add_argument(
        "--cpu-max-memory",
        type=str,
        default="2GiB",
        help="Max RAM for model weights during load/train (rest on disk).",
    )
    parser.add_argument(
        "--offload-folder",
        type=Path,
        default=Path("ml/models/acocam-lora/offload"),
        help="Folder for disk-offloaded weights.",
    )
    parser.add_argument(
        "--small",
        action="store_true",
        help="Use Qwen2.5-0.5B-Instruct (lower VRAM / faster CPU)",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=-1,
        help="Stop after N optimizer steps (-1 = use epochs only). Useful for smoke tests.",
    )
    args = parser.parse_args()

    if args.small:
        args.base_model = "Qwen/Qwen2.5-0.5B-Instruct"

    if args.ultra_low_mem:
        args.cpu_offload = True
        args.cpu_dtype = "fp16"
        args.cpu_max_memory = "1.5GiB"
        args.lora_r = min(args.lora_r, 8)
        if args.max_seq_length > 256:
            args.max_seq_length = 256
        args.grad_accum = min(args.grad_accum, 4)

    data_path = resolve_repo_path(args.data)
    out_path = resolve_repo_path(args.out)
    offload_path = resolve_repo_path(args.offload_folder)

    print(f"Training base model: {args.base_model}")
    print(f"Dataset: {data_path}")
    print(f"Adapter output: {out_path}")

    if not data_path.exists():
        raise SystemExit(f"Dataset missing: {data_path}. Run: python ml/prepare_dataset.py")

    line_count = sum(1 for _ in data_path.open(encoding="utf-8") if _.strip())
    if line_count < 10:
        raise SystemExit(f"Dataset looks empty ({line_count} rows): {data_path}")
    print(f"Training rows: {line_count}")

    use_cpu = args.cpu or not torch.cuda.is_available()
    if use_cpu:
        print("Device: CPU (slow; close browsers to free RAM)")
        gc.collect()
    else:
        print(f"Device: CUDA ({torch.cuda.get_device_name(0)})")

    gc.collect()
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    cpu_dtype = args.cpu_dtype.lower().strip()
    if use_cpu and cpu_dtype not in {"bf16", "fp16", "fp32"}:
        raise SystemExit("--cpu-dtype must be one of: bf16, fp16, fp32")

    torch_dtype = (
        torch.float32
        if not use_cpu or cpu_dtype == "fp32"
        else (torch.bfloat16 if cpu_dtype == "bf16" else torch.float16)
    )

    try:
        if use_cpu:
            # 0.5B + fp16 fits in ~1–2 GB RAM; standard load is more reliable on Windows
            # than accelerate dispatch (which spreads layers across cpu/disk and breaks Trainer).
            if args.small:
                print("Using standard CPU load for 0.5B model (recommended on 8GB Windows).")
                model = load_model_cpu_standard(args.base_model, torch_dtype)
            elif args.cpu_offload:
                try:
                    model = load_model_cpu_minimal(
                        args.base_model,
                        offload_path,
                        torch_dtype,
                        max_cpu=args.cpu_max_memory,
                    )
                except (RuntimeError, OSError, ValueError) as err:
                    if getattr(err, "winerror", None) == 1455 or "paging file" in str(err).lower():
                        raise SystemExit(PAGE_FILE_HELP) from err
                    print(f"Warning: low-memory dispatch failed ({err}). Trying standard CPU load…")
                    model = load_model_cpu_standard(args.base_model, torch_dtype)
            else:
                model = load_model_cpu_standard(args.base_model, torch_dtype)
        else:
            model = AutoModelForCausalLM.from_pretrained(
                args.base_model,
                trust_remote_code=True,
                torch_dtype=torch_dtype if use_cpu else "auto",
                device_map="auto",
                low_cpu_mem_usage=True,
            )
    except OSError as err:
        if getattr(err, "winerror", None) == 1455 or "paging file" in str(err).lower():
            raise SystemExit(PAGE_FILE_HELP) from err
        raise

    model.config.use_cache = False

    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r,
        lora_alpha=args.lora_r * 2,
        lora_dropout=0.05,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    def tokenize_row(example: dict) -> dict:
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        encoded = tokenizer(
            text,
            truncation=True,
            max_length=args.max_seq_length,
            padding=False,
        )
        encoded["labels"] = encoded["input_ids"].copy()
        return encoded

    raw = load_dataset("json", data_files=str(data_path), split="train")
    ds = raw.map(tokenize_row, remove_columns=raw.column_names)

    out_path.mkdir(parents=True, exist_ok=True)

    train_kwargs: dict = {
        "output_dir": str(out_path / "checkpoints"),
        "num_train_epochs": args.epochs,
        "per_device_train_batch_size": args.batch_size,
        "gradient_accumulation_steps": args.grad_accum,
        "learning_rate": args.lr,
        "logging_steps": 10,
        "save_strategy": "epoch",
        "bf16": use_cpu and cpu_dtype == "bf16",
        "fp16": use_cpu and cpu_dtype == "fp16",
        "report_to": [],
        "remove_unused_columns": False,
        "use_cpu": use_cpu,
        "dataloader_pin_memory": not use_cpu,
        # 0.5B + fp16 fits in ~2GB; checkpointing saves RAM but is very slow on CPU.
        "gradient_checkpointing": use_cpu and not args.small,
    }
    if args.max_steps > 0:
        train_kwargs["max_steps"] = args.max_steps
    training_args = TrainingArguments(**train_kwargs)

    if use_cpu and not args.small and hasattr(model, "gradient_checkpointing_enable"):
        model.gradient_checkpointing_enable()

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=ds,
        data_collator=collator,
        processing_class=tokenizer,
    )

    trainer.train()
    trainer.model.save_pretrained(str(out_path))
    tokenizer.save_pretrained(str(out_path))

    meta = {
        "base_model": args.base_model,
        "adapter_path": str(out_path),
        "data": str(data_path),
        "rows": line_count,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "grad_accum": args.grad_accum,
        "lr": args.lr,
        "max_seq_length": args.max_seq_length,
        "lora_r": args.lora_r,
        "cpu_offload": args.cpu_offload and not args.small,
        "cpu_max_memory": args.cpu_max_memory,
        "max_steps": args.max_steps if args.max_steps > 0 else None,
        "device": "cpu" if use_cpu else "cuda",
        "trainer": "transformers.Trainer",
    }
    (out_path / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("Training complete:", out_path)
    print("Next: python ml/serve.py --cpu --small")


if __name__ == "__main__":
    main()
