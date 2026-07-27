"""
Build a supervised fine-tuning dataset from every knowledge-base markdown file.

Scans ALL markdown files in the knowledge directory (baseline + expanded),
extracts every `Qn.` / answer pair, de-duplicates by normalized question
(keeping the most complete answer), and adds light paraphrases.

Also writes a merged Q&A markdown for runtime lexical retrieval.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_config import (  # noqa: E402
    DEFAULT_KB_DIR,
    DEFAULT_MERGED_KNOWLEDGE,
    default_dataset_path,
    resolve_repo_path,
)

QA_RE = re.compile(r"^Q\d+\.\s*(.+)\s*$", re.IGNORECASE)
HEADING_RE = re.compile(r"^#{1,3}\s")

SYSTEM = (
    "You are the ACOCAM Trading Inc. customer assistant. "
    "Answer only from company knowledge. Never invent prices, tracking status, "
    "or bookings. If unsure, say so and offer a human agent."
)

PARAPHRASE_PREFIXES = [
    "",
    "Please tell me: ",
    "I need to know: ",
    "Can you explain: ",
    "Quick question — ",
]


def normalize_question(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", " ", text.lower()).strip()


def extract_qa_pairs(md: str) -> list[dict[str, str]]:
    pairs: list[dict[str, str]] = []
    current_q: str | None = None
    answer_lines: list[str] = []

    def flush() -> None:
        nonlocal current_q, answer_lines
        if not current_q:
            return
        answer = "\n".join(answer_lines).strip()
        answer = re.sub(r"\n{3,}", "\n\n", answer)
        if len(answer) >= 20:
            pairs.append({"question": current_q.strip(), "answer": answer})
        current_q = None
        answer_lines = []

    for line in md.splitlines():
        m = QA_RE.match(line)
        if m:
            flush()
            current_q = m.group(1).strip()
            continue
        if current_q is not None:
            if HEADING_RE.match(line):
                flush()
                continue
            answer_lines.append(line)
    flush()
    return pairs


def collect_pairs(kb_files: list[Path]) -> tuple[dict[str, dict[str, str]], dict[str, int]]:
    """Merge Q&A from every file; keep the longest answer per unique question."""
    merged: dict[str, dict[str, str]] = {}
    per_file: dict[str, int] = {}

    for path in kb_files:
        md = path.read_text(encoding="utf-8")
        pairs = extract_qa_pairs(md)
        per_file[path.name] = len(pairs)
        for pair in pairs:
            key = normalize_question(pair["question"])
            if not key:
                continue
            existing = merged.get(key)
            if existing is None or len(pair["answer"]) > len(existing["answer"]):
                merged[key] = {
                    "question": pair["question"],
                    "answer": pair["answer"],
                    "source": path.name,
                }
    return merged, per_file


def to_chat_example(question: str, answer: str) -> dict:
    return {
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer},
        ]
    }


def expand(pairs: list[dict[str, str]]) -> list[dict]:
    rows: list[dict] = []
    for p in pairs:
        q = p["question"]
        a = p["answer"]
        for prefix in PARAPHRASE_PREFIXES:
            rows.append(to_chat_example(f"{prefix}{q}".strip(), a))
        q2 = q.rstrip("?").strip()
        if q2 != q:
            rows.append(to_chat_example(q2 + "?", a))
    return rows


def resolve_kb_files(kb_dir: Path, extra: list[Path]) -> list[Path]:
    files = sorted(p for p in kb_dir.glob("**/*.md") if p.is_file()) if kb_dir.exists() else []
    for p in extra:
        resolved = resolve_repo_path(p) if not p.is_absolute() else p
        if resolved.is_file() and resolved not in files:
            files.append(resolved)
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare ACOCAM SFT dataset from knowledge markdown")
    parser.add_argument(
        "--kb-dir",
        type=Path,
        default=Path(DEFAULT_KB_DIR),
        help="Directory scanned recursively for knowledge markdown files",
    )
    parser.add_argument(
        "--kb",
        type=Path,
        nargs="*",
        default=[],
        help="Additional individual markdown files to include",
    )
    parser.add_argument("--out", type=Path, default=default_dataset_path())
    parser.add_argument(
        "--emit-knowledge",
        type=Path,
        default=Path(DEFAULT_MERGED_KNOWLEDGE),
        help="Write the merged, de-duplicated Q&A corpus for runtime retrieval",
    )
    parser.add_argument(
        "--no-emit-knowledge",
        action="store_true",
        help="Skip writing the merged knowledge markdown",
    )
    args = parser.parse_args()

    kb_dir = resolve_repo_path(args.kb_dir)
    out_path = resolve_repo_path(args.out)
    emit_path = None if args.no_emit_knowledge else resolve_repo_path(args.emit_knowledge)

    kb_files = resolve_kb_files(kb_dir, list(args.kb))
    if not kb_files:
        raise SystemExit(f"No markdown files found in {kb_dir}")

    merged, per_file = collect_pairs(kb_files)
    pairs = list(merged.values())
    rows = expand(pairs)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    if emit_path:
        emit_path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# ACOCAM Knowledge Q&A (merged from all knowledge base files)", ""]
        for idx, pair in enumerate(pairs, start=1):
            lines.append(f"Q{idx}. {pair['question']}")
            lines.append("")
            lines.append(pair["answer"].strip())
            lines.append("")
        emit_path.write_text("\n".join(lines), encoding="utf-8")

    meta = {
        "sources": [str(p) for p in kb_files],
        "qa_pairs_per_file": per_file,
        "unique_qa_pairs": len(pairs),
        "training_rows": len(rows),
        "merged_knowledge_file": str(emit_path) if emit_path else None,
        "dataset": str(out_path),
    }
    out_path.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))
    print(f"Wrote {out_path}")
    if emit_path:
        print(f"Wrote {emit_path}")


if __name__ == "__main__":
    main()
