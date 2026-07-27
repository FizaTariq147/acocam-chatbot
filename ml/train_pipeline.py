"""
End-to-end ACOCAM training pipeline:

  1) prepare_dataset.py  → JSONL + knowledge-qa.md
  2) train_lora.py       → ml/models/acocam-lora/
  3) optional: serve.py  → http://127.0.0.1:8090

Usage (from repo root, with .venv-ml active):

  python ml/train_pipeline.py
  python ml/train_pipeline.py --cpu --small --epochs 2
  python ml/train_pipeline.py --prepare-only
  python ml/train_pipeline.py --serve
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(cmd: list[str]) -> None:
    print("\n==>", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, cwd=str(ROOT))
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def main() -> None:
    parser = argparse.ArgumentParser(description="ACOCAM prepare → train → (optional) serve")
    parser.add_argument("--prepare-only", action="store_true", help="Only build the dataset")
    parser.add_argument("--train-only", action="store_true", help="Skip prepare; train only")
    parser.add_argument("--serve", action="store_true", help="Start local model server after training")
    parser.add_argument("--cpu", action="store_true", help="Force CPU for train/serve")
    parser.add_argument("--small", action="store_true", help="Use 0.5B base model")
    parser.add_argument("--epochs", type=float, default=None)
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--max-seq-length", type=int, default=None, help="Forward to train_lora.py")
    parser.add_argument(
        "--cpu-dtype",
        type=str,
        default="fp16",
        help="Forward to train_lora.py (fp16 = lowest RAM on Windows CPU).",
    )
    parser.add_argument(
        "--ultra-low-mem",
        action="store_true",
        help="Aggressive RAM savings for 8GB machines (recommended on Windows CPU).",
    )
    parser.add_argument(
        "--cpu-offload",
        action="store_true",
        help="Forward to train_lora.py: offload weights to disk on CPU load",
    )
    parser.add_argument(
        "--cpu-max-memory",
        type=str,
        default="1.5GiB",
        help="Forward to train_lora.py when using --cpu-offload (e.g. 2GiB)",
    )
    parser.add_argument(
        "--offload-folder",
        type=str,
        default="ml/models/acocam-lora/offload",
        help="Forward to train_lora.py when using --cpu-offload",
    )
    parser.add_argument(
        "--paraphrase-level",
        type=int,
        default=3,
        help="Forward to prepare_dataset.py (0 original, 1 prefixes, 2 rewrites, 3 more paraphrases).",
    )
    parser.add_argument(
        "--max-variants-per-question",
        type=int,
        default=24,
        help="Forward to prepare_dataset.py.",
    )
    args = parser.parse_args()

    py = sys.executable

    if not args.train_only:
        run(
            [
                py,
                "ml/prepare_dataset.py",
                "--paraphrase-level",
                str(args.paraphrase_level),
                "--max-variants-per-question",
                str(args.max_variants_per_question),
            ],
        )

    if args.prepare_only:
        print("\nPrepare done.")
        print("Paraphrase-friendly FAQ (no GPU training needed):")
        print("  npm run reindex && npm run dev")
        print("Optional LoRA train (8GB+ RAM or GPU):")
        print("  python ml/train_lora.py --cpu --small --cpu-offload --ultra-low-mem")
        return

    train_cmd = [py, "ml/train_lora.py"]
    if args.cpu:
        train_cmd.append("--cpu")
        train_cmd.extend(["--cpu-dtype", args.cpu_dtype])
        if args.cpu_offload or args.ultra_low_mem:
            train_cmd.append("--cpu-offload")
            train_cmd.extend(["--cpu-max-memory", args.cpu_max_memory])
            train_cmd.extend(["--offload-folder", args.offload_folder])
        if args.ultra_low_mem:
            train_cmd.append("--ultra-low-mem")
    if args.small:
        train_cmd.append("--small")
    if args.epochs is not None:
        train_cmd.extend(["--epochs", str(args.epochs)])
    if args.batch_size is not None:
        train_cmd.extend(["--batch-size", str(args.batch_size)])
    if args.max_seq_length is not None:
        train_cmd.extend(["--max-seq-length", str(args.max_seq_length)])
    # Sensible CPU defaults when user did not override
    if args.cpu and args.epochs is None:
        train_cmd.extend(["--epochs", "2"])
    run(train_cmd)

    if args.serve:
        serve_cmd = [py, "ml/serve.py"]
        if args.cpu:
            serve_cmd.append("--cpu")
        if args.small:
            serve_cmd.append("--small")
        run(serve_cmd)
    else:
        print("\nTraining finished.")
        print("Serve:  python ml/serve.py")
        print("Then set AI_PROVIDER=local in .env and restart: npm run reindex && npm run dev")
        print("Demo:   http://127.0.0.1:8787/demo")


if __name__ == "__main__":
    main()
