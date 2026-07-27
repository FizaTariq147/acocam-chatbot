"""
Serve the fine-tuned LoRA adapter as a local OpenAI-compatible API.

No cloud LLM — runs on your machine at http://127.0.0.1:8090/v1
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI
from peft import PeftModel
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_config import (  # noqa: E402
    SERVED_MODEL_NAME,
    default_adapter_dir,
    default_base_model,
    resolve_repo_path,
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = SERVED_MODEL_NAME
    messages: list[ChatMessage]
    temperature: float = 0.2
    max_tokens: int = 700


def adapter_is_ready(adapter: Path) -> bool:
    if not adapter.is_dir():
        return False
    markers = (
        "adapter_config.json",
        "adapter_model.safetensors",
        "adapter_model.bin",
    )
    return any((adapter / name).exists() for name in markers)


def load_tokenizer(base_model: str, adapter: str):
    """Load tokenizer from base model; adapter dirs often lack a full tokenizer."""
    last_err: Exception | None = None
    for source in (base_model, adapter):
        try:
            tokenizer = AutoTokenizer.from_pretrained(source, trust_remote_code=True)
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token
            return tokenizer
        except Exception as exc:
            last_err = exc
    raise RuntimeError(
        f"Could not load tokenizer from base model ({base_model}) or adapter ({adapter}). "
        "Install ml/requirements.txt (sentencepiece, tiktoken) and verify the base model name."
    ) from last_err


def build_app(base_model: str, adapter: str, device: str) -> FastAPI:
    tokenizer = load_tokenizer(base_model, adapter)
    load_kwargs: dict[str, Any] = {
        "trust_remote_code": True,
        "device_map": None,
    }
    # Prefer dtype= (new transformers); fall back to torch_dtype for older installs
    try:
        model = AutoModelForCausalLM.from_pretrained(
            base_model, dtype=torch.float32, **load_kwargs
        )
    except TypeError:
        model = AutoModelForCausalLM.from_pretrained(
            base_model, torch_dtype=torch.float32, **load_kwargs
        )
    model = PeftModel.from_pretrained(model, adapter)
    model.to(device)
    model.eval()

    app = FastAPI(title="ACOCAM local fine-tuned model")

    def status() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "acocam-local-model",
            "model": SERVED_MODEL_NAME,
            "base_model": base_model,
            "adapter": adapter,
            "device": device,
            "endpoints": {
                "health": "GET /health",
                "chat": "POST /v1/chat/completions",
            },
            "hint": "This is an API server, not a chat UI. Open http://127.0.0.1:8787/demo for the widget.",
        }

    @app.get("/")
    def root() -> dict[str, Any]:
        return status()

    @app.get("/favicon.ico")
    def favicon() -> Any:
        from fastapi.responses import Response

        return Response(status_code=204)

    @app.get("/health")
    def health() -> dict[str, Any]:
        return status()

    @app.post("/v1/chat/completions")
    def chat(req: ChatCompletionRequest) -> dict[str, Any]:
        prompt = tokenizer.apply_chat_template(
            [m.model_dump() for m in req.messages],
            tokenize=False,
            add_generation_prompt=True,
        )
        inputs = tokenizer(prompt, return_tensors="pt").to(device)
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=req.max_tokens,
                do_sample=req.temperature > 0,
                temperature=max(req.temperature, 0.01),
                pad_token_id=tokenizer.eos_token_id,
            )
        gen = out[0][inputs["input_ids"].shape[-1] :]
        text = tokenizer.decode(gen, skip_special_tokens=True).strip()
        return {
            "id": "local-finetuned",
            "object": "chat.completion",
            "model": req.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }
            ],
        }

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve ACOCAM LoRA as OpenAI-compatible API")
    parser.add_argument("--base-model", default=default_base_model())
    parser.add_argument("--adapter", default=default_adapter_dir())
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--cpu", action="store_true")
    parser.add_argument(
        "--small",
        action="store_true",
        help="Use Qwen2.5-0.5B-Instruct (match a --small training run)",
    )
    args = parser.parse_args()

    if args.small:
        args.base_model = "Qwen/Qwen2.5-0.5B-Instruct"

    adapter = resolve_repo_path(args.adapter)
    if not adapter.exists():
        raise SystemExit(
            f"Adapter missing: {adapter}\n"
            "Train first:\n"
            "  python ml/prepare_dataset.py\n"
            "  python ml/train_lora.py\n"
        )
    if not adapter_is_ready(adapter):
        raise SystemExit(
            f"Adapter directory exists but no trained weights found: {adapter}\n"
            "Expected adapter_config.json + adapter_model.safetensors (training must finish).\n"
            "Train first:\n"
            "  python ml/prepare_dataset.py\n"
            "  python ml/train_lora.py --cpu --small\n"
            "If training was interrupted, delete ml/models/acocam-lora and re-run training."
        )

    # Prefer base model recorded during training when available
    meta_path = adapter / "train_meta.json"
    base_model = args.base_model
    if meta_path.exists():
        try:
            meta = json_loads_safe(meta_path)
            if meta.get("base_model"):
                base_model = meta["base_model"]
                print(f"Using base model from train_meta.json: {base_model}")
        except Exception:
            pass

    device = "cpu" if args.cpu or not torch.cuda.is_available() else "cuda"
    print(f"Loading adapter {adapter} on {device}")
    app = build_app(base_model, str(adapter), device)
    uvicorn.run(app, host=args.host, port=args.port)


def json_loads_safe(path: Path) -> dict:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
