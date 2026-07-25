"""
LoRA supervised fine-tune on ACOCAM Q&A using transformers Trainer
(avoids TRL 1.9 PEFT patch bug). Local only — no cloud LLM API.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, TaskType
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("ml/data/acocam_sft.jsonl"))
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--out", type=Path, default=Path("ml/models/acocam-lora"))
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--max-seq-length", type=int, default=768)
    parser.add_argument("--cpu", action="store_true", help="Force CPU training")
    args = parser.parse_args()

    if not args.data.exists():
        raise SystemExit(f"Dataset missing: {args.data}. Run: python ml/prepare_dataset.py")

    use_cpu = args.cpu or not torch.cuda.is_available()
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

    raw = load_dataset("json", data_files=str(args.data), split="train")
    ds = raw.map(tokenize_row, remove_columns=raw.column_names)

    args.out.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(args.out / "checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=8,
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
    trainer.model.save_pretrained(str(args.out))
    tokenizer.save_pretrained(str(args.out))

    meta = {
        "base_model": args.base_model,
        "adapter_path": str(args.out),
        "data": str(args.data),
        "epochs": args.epochs,
        "trainer": "transformers.Trainer",
    }
    (args.out / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("Training complete:", args.out)


if __name__ == "__main__":
    main()
