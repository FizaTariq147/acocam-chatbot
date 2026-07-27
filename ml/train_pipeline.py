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
    args = parser.parse_args()

    py = sys.executable

    if not args.train_only:
        run([py, "ml/prepare_dataset.py"])

    if args.prepare_only:
        print("\nPrepare done. Next: python ml/train_lora.py")
        return

    train_cmd = [py, "ml/train_lora.py"]
    if args.cpu:
        train_cmd.append("--cpu")
    if args.small:
        train_cmd.append("--small")
    if args.epochs is not None:
        train_cmd.extend(["--epochs", str(args.epochs)])
    if args.batch_size is not None:
        train_cmd.extend(["--batch-size", str(args.batch_size)])
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
