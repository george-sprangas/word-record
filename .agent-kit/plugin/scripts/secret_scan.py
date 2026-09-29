#!/usr/bin/env python3
"""Refuse to let a credential reach git.

Two modes:
  * hook mode (no arguments): reads a PreToolUse payload on stdin. When the
    command is a `git commit`, scans the staged diff and denies on a hit.
  * CI mode (--paths a b c ...): scans files on disk and exits non-zero on a hit.

Patterns require realistic length so that documentation naming a prefix
(`sk-ant-`, `whsec_`) does not trip the scan.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agentkit import allow_silently, deny, envelope, project_dir, read_hook_input  # noqa: E402

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Anthropic API key", re.compile(r"sk-ant-(?:api|admin|oat)[0-9]{2}-[A-Za-z0-9_\-]{24,}")),
    ("Anthropic key (generic)", re.compile(r"sk-ant-[A-Za-z0-9_\-]{32,}")),
    ("OpenAI key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9]{40,}")),
    ("GitHub token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("Slack token", re.compile(r"xox[abprs]-[A-Za-z0-9-]{20,}")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Google service-account private key", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("Webhook signing secret", re.compile(r"\bwhsec_[A-Za-z0-9]{24,}")),
    ("Fernet/encryption key assignment", re.compile(r"(?i)\b(?:secret_key|encryption_key|token)\b\s*=\s*['\"][A-Za-z0-9+/=_\-]{32,}['\"]")),
]

SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".ico", ".woff", ".woff2", ".ttf", ".zip", ".gz", ".sqlite3"}
SELF = Path(__file__).name


def scan_text(text: str) -> list[str]:
    hits = []
    for label, pattern in PATTERNS:
        if pattern.search(text):
            hits.append(label)
    return hits


def ci_mode(paths: list[str]) -> int:
    findings: list[str] = []
    for raw in paths:
        path = Path(raw)
        if not path.is_file() or path.suffix.lower() in SKIP_SUFFIXES:
            continue
        if path.name == SELF:  # this file documents the patterns
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for label in scan_text(text):
            findings.append(f"{path}: {label}")
    if findings:
        print("secret_scan: possible credentials found")
        for line in findings:
            print(f"  - {line}")
        return 1
    print(f"secret_scan: ok ({len(paths)} path(s))")
    return 0


def hook_mode() -> None:
    payload = read_hook_input()
    command = (payload.get("tool_input") or {}).get("command", "")
    if "git commit" not in command and "git add" not in command:
        allow_silently()
    root = project_dir(payload)
    try:
        diff = subprocess.run(
            ["git", "-C", str(root), "diff", "--cached", "--no-color", "--unified=0"],
            capture_output=True, text=True, timeout=30, check=False,
        ).stdout
    except Exception:
        allow_silently()
        return
    added = "\n".join(line[1:] for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++"))
    hits = scan_text(added)
    if hits:
        env = envelope(payload) or {}
        where = f" (task {env.get('task')}, stage {env.get('stage')})" if env else ""
        deny(
            "PreToolUse",
            "Agent Kit secret scan blocked this commit"
            + where
            + ": the staged diff contains "
            + ", ".join(sorted(set(hits)))
            + ". Remove the value, reference a secret NAME instead, and commit again. "
            "If this is a false positive, say so in the ledger and ask the human to commit it.",
        )
    allow_silently()


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--paths":
        return ci_mode(sys.argv[2:])
    hook_mode()
    return 0


if __name__ == "__main__":
    sys.exit(main())
