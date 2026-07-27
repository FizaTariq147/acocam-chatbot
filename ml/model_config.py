"""Shared defaults for ACOCAM local LoRA train + serve."""

from __future__ import annotations

import os
from pathlib import Path

# Repo root = parent of ml/
REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
FALLBACK_BASE_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_ADAPTER_DIR = "ml/models/acocam-lora"
DEFAULT_DATASET = "ml/data/acocam_sft.jsonl"
DEFAULT_KB_DIR = "knowledge base"
DEFAULT_MERGED_KNOWLEDGE = "tenants/acocam/knowledge/knowledge-qa.md"
SERVED_MODEL_NAME = "acocam-lora"


def default_base_model() -> str:
    return os.environ.get("ACOCAM_BASE_MODEL", DEFAULT_BASE_MODEL)


def default_adapter_dir() -> str:
    return os.environ.get("ACOCAM_ADAPTER_DIR", DEFAULT_ADAPTER_DIR)


def default_dataset_path() -> Path:
    return Path(os.environ.get("ACOCAM_DATASET", DEFAULT_DATASET))


def resolve_repo_path(p: str | Path) -> Path:
    path = Path(p)
    if path.is_absolute():
        return path
    return REPO_ROOT / path
