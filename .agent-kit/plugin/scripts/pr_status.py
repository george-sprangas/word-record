#!/usr/bin/env python3
"""Keep the pull request's pipeline block truthful — and keep the change reviewable.

A stage calls this once, when it closes. It rewrites the block between
`<!-- pipeline:status -->` markers in the PR body from the task's own ledger:
one line per finished stage, the latest event as JSON for the Orchestrator's
wake to parse, and the list of code commits — the ones that touch something
other than `docs/pipeline/` — so a reviewer can read the change commit by
commit without wading through ledger bookkeeping.

Nothing else on the PR comes from a stage. No prose comments, no second copy
of the body, no status pasted as a comment: the body is the one place, edited
in place, and the reviewer's review is the one exception.

    pr_status.py --task task-231 --pr 12            # from the task's worktree
    pr_status.py --task task-231 --pr 12 --dry-run  # print the block, change nothing

Stdlib only; needs `gh` authenticated, and `git` inside the task's checkout.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

OPEN, CLOSE = "<!-- pipeline:status -->", "<!-- /pipeline:status -->"
LEDGER_DIR = "docs/pipeline"
EMPTY = "_No stage has reported yet._"


def run(*argv: str, input: str | None = None) -> str:
    done = subprocess.run(argv, capture_output=True, text=True, input=input)
    if done.returncode != 0:
        raise RuntimeError(f"{' '.join(argv[:3])}: {done.stderr.strip()[-400:]}")
    return done.stdout


def timeline(root: Path, task: str) -> list[dict]:
    path = root / LEDGER_DIR / task / "timeline.jsonl"
    if not path.exists():
        return []
    events = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return events


def code_commits(root: Path, base: str) -> list[tuple[str, str]]:
    """(sha, subject) for every commit on the branch that touches code, oldest first."""
    out = run("git", "-C", str(root), "log", "--reverse", "--format=%H%x09%s",
              f"{base}..HEAD", "--", ".", f":!{LEDGER_DIR}")
    pairs = []
    for line in out.splitlines():
        sha, _, subject = line.partition("\t")
        if sha:
            pairs.append((sha, subject))
    return pairs


def render(events: list[dict], commits: list[tuple[str, str]], repo: str, head: str) -> str:
    finished = [e for e in events if e.get("event") == "stage_finished"]
    lines = [OPEN]
    if not finished:
        lines.append(EMPTY)
    else:
        lines.append("| stage | round | status | summary |")
        lines.append("|---|---|---|---|")
        for e in finished:
            summary = _brief(str(e.get("summary", "")).replace("|", "\\|").replace("\n", " "))
            lines.append(f"| {e.get('stage', '')} | {e.get('round', '')} | `{e.get('status', '')}` | {summary} |")
    if commits:
        lines.append("")
        lines.append(f"**Review the change** ({len(commits)} code commit{'s' if len(commits) != 1 else ''}; "
                     f"ledger commits under `{LEDGER_DIR}/` are left out):")
        for sha, subject in commits:
            lines.append(f"- [`{sha[:7]}`](https://github.com/{repo}/commit/{sha}) {subject}")
        lines.append(f"- [all code files changed](https://github.com/{repo}/compare/"
                     f"{head}?expand=1) · filter *Files changed* by path to skip `{LEDGER_DIR}/`")
    if finished:
        latest = finished[-1]
        lines.append("")
        lines.append("<details><summary>latest event (machine-readable)</summary>")
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps(latest, ensure_ascii=False))
        lines.append("```")
        lines.append("</details>")
    lines.append(CLOSE)
    return "\n".join(lines)


def _brief(text: str, limit: int = 240) -> str:
    """The ledger asks for a one-line summary under 200 characters; the table
    holds a stage to that whether or not the stage did. The full text is in
    the JSON below and in the timeline."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def splice(body: str, block: str) -> str:
    start, end = body.find(OPEN), body.find(CLOSE)
    if start == -1 or end == -1 or end < start:
        return body.rstrip() + "\n\n" + block + "\n"
    return body[:start] + block + body[end + len(CLOSE):]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task", required=True)
    parser.add_argument("--pr", required=True, help="pull request number")
    parser.add_argument("--base", default="origin/main", help="what the branch was cut from")
    parser.add_argument("--root", default=".", help="the task's checkout")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    try:
        repo = run("gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner").strip()
        head = run("git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD").strip()
        block = render(timeline(root, args.task), code_commits(root, args.base), repo, head)
        if args.dry_run:
            print(block)
            return 0
        body = run("gh", "pr", "view", args.pr, "--json", "body", "-q", ".body")
        run("gh", "pr", "edit", args.pr, "--body-file", "-", input=splice(body, block))
    except RuntimeError as exc:
        print(f"pr_status: {exc}", file=sys.stderr)
        return 1
    print(f"pr_status: PR #{args.pr} block updated for {args.task}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
