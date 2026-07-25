"""
Serve the fine-tuned LoRA adapter as a local OpenAI-compatible API.

No cloud LLM — runs on your machine at http://127.0.0.1:8090/v1
"""

from __future__ import annotations

import argparse
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI
from peft import PeftModel
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = "acocam-lora"
    messages: list[ChatMessage]
    temperature: float = 0.2
    max_tokens: int = 700


def build_app(base_model: str, adapter: str, device: str) -> FastAPI:
    tokenizer = AutoTokenizer.from_pretrained(adapter, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        trust_remote_code=True,
        torch_dtype=torch.float32,
        device_map=None,
    )
    model = PeftModel.from_pretrained(model, adapter)
    model.to(device)
    model.eval()

    app = FastAPI(title="ACOCAM local fine-tuned model")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "model": "acocam-lora", "device": device}

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
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--adapter", default="ml/models/acocam-lora")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--cpu", action="store_true")
    args = parser.parse_args()

    device = "cpu" if args.cpu or not torch.cuda.is_available() else "cuda"
    app = build_app(args.base_model, args.adapter, device)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
