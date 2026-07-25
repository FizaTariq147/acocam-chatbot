"""
Build a supervised fine-tuning dataset from tenant knowledge markdown.

Extracts every Qn/A pair and adds light paraphrases so the local model
learns to answer ACOCAM questions without a cloud LLM API.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

QA_RE = re.compile(r"^Q(\d+)\.\s*(.+)\s*$", re.IGNORECASE)
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
            current_q = m.group(2).strip()
            continue
        if current_q is not None:
            if HEADING_RE.match(line) or QA_RE.match(line):
                flush()
                continue
            answer_lines.append(line)
    flush()
    return pairs


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
        # Also train on lowercased / without trailing ?
        q2 = q.rstrip("?").strip()
        if q2 != q:
            rows.append(to_chat_example(q2 + "?", a))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--kb",
        type=Path,
        default=Path("tenants/acocam/knowledge/knowledge-base.md"),
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("ml/data/acocam_sft.jsonl"),
    )
    args = parser.parse_args()

    md = args.kb.read_text(encoding="utf-8")
    pairs = extract_qa_pairs(md)
    rows = expand(pairs)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    meta = {
        "source": str(args.kb),
        "qa_pairs": len(pairs),
        "training_rows": len(rows),
    }
    meta_path = args.out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta, indent=2))
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
