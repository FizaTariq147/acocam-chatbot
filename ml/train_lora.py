"""
LoRA supervised fine-tune on ACOCAM Q&A using transformers Trainer
(avoids TRL 1.9 PEFT patch bug). Local only — no cloud LLM API.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model
from transformers import (
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
    parser.add_argument("--cpu", action="store_true", help="Force CPU training")
    parser.add_argument(
        "--small",
        action="store_true",
        help="Use Qwen2.5-0.5B-Instruct (lower VRAM / faster CPU)",
    )
    args = parser.parse_args()

    if args.small:
        args.base_model = "Qwen/Qwen2.5-0.5B-Instruct"

    data_path = resolve_repo_path(args.data)
    out_path = resolve_repo_path(args.out)

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
        print("Device: CPU (expect slow training; use --epochs 2 --small if needed)")
    else:
        print(f"Device: CUDA ({torch.cuda.get_device_name(0)})")

    device_map = "cpu" if use_cpu else "auto"

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        torch_dtype=torch.float32 if use_cpu else "auto",
        device_map=device_map,
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False

    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
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

    training_args = TrainingArguments(
        output_dir=str(out_path / "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        logging_steps=10,
        save_strategy="epoch",
        bf16=False,
        fp16=False,
        report_to=[],
        remove_unused_columns=False,
        use_cpu=use_cpu,
        dataloader_pin_memory=not use_cpu,
    )

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
        "device": "cpu" if use_cpu else "cuda",
        "trainer": "transformers.Trainer",
    }
    (out_path / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("Training complete:", out_path)
    print("Next: python ml/serve.py")


if __name__ == "__main__":
    main()
