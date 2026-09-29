#!/usr/bin/env python3
"""Shared helpers for Agent Kit hook scripts.

Standard library only: these run inside every target repo, which may have no
virtualenv active and no third-party packages installed.

The active stage envelope lives at <project>/.agentkit/envelope.json. It is
written by `/agent-kit:pipeline run` when a stage session starts and removed
when the stage ends, so hooks can tell a pipeline session from an ordinary one.
"""
from __future__ import annotations

import fnmatch
import json
import os
import subprocess
import sys
from pathlib import Path

ENVELOPE_REL = Path(".agentkit") / "envelope.json"
# A launcher that has the envelope (the local runner) writes it outside the
# checkout and names the file here. While set, it is the only envelope the
# hooks believe: the copy under .agentkit/ is the session's scratch, and a
# session must not be able to rewrite its own scope by editing a file.
ENVELOPE_ENV = "AGENTKIT_ENVELOPE"

# Envelope stages that write no stage_finished event, by design. `orchestrate`
# is one Orchestrator wake, and a wake is not an event: a quiet one writes
# nothing at all (P8 D8.1, P8.1d). `init` onboards a repository that has no
# task ledger yet. Holding either to the ledger rule would force exactly the
# diary entries P8 removed.
NO_LEDGER_STAGES = frozenset({"orchestrate", "init"})


def read_hook_input() -> dict:
    """Parse the hook payload on stdin. Never raises: a broken payload must not
    break the session, it must fall through to the permissive default."""
    try:
        raw = sys.stdin.read()
    except Exception:
        return {}
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def project_dir(payload: dict | None = None) -> Path:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    if payload and payload.get("cwd"):
        return Path(payload["cwd"])
    return Path.cwd()


def git_root(start: Path) -> Path:
    try:
        out = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip())
    except Exception:
        pass
    return start


def launcher_envelope_path() -> Path | None:
    """Where the launcher put the envelope, when a launcher did."""
    value = os.environ.get(ENVELOPE_ENV, "").strip()
    return Path(value) if value else None


def envelope(payload: dict | None = None) -> dict | None:
    """The active stage envelope, or None when this is not a pipeline session."""
    path = launcher_envelope_path() or (project_dir(payload) / ENVELOPE_REL)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def pipeline_config(payload: dict | None = None) -> dict:
    """A very small YAML reader for the handful of pipeline.yml keys hooks need.

    Only flat `key: value` and one nesting level of `key:` blocks are supported,
    which covers scripts.verify / scripts.qa / project. Anything richer is the
    skills' job, and they run with a real YAML parser available to the model.
    """
    path = project_dir(payload) / "pipeline.yml"
    if not path.is_file():
        return {}
    result: dict = {}
    section: str | None = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return {}
    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        stripped = line.rstrip()
        if not stripped.startswith((" ", "\t")):
            key, _, value = stripped.partition(":")
            key = key.strip()
            value = value.split(" #")[0].strip().strip('"\'')
            if value:
                result[key] = value
                section = None
            else:
                section = key
                result.setdefault(section, {})
        elif section and isinstance(result.get(section), dict):
            key, _, value = stripped.strip().partition(":")
            value = value.split(" #")[0].strip().strip('"\'')
            if value:
                result[section][key] = value
    return result


def path_in_scope(rel_path: str, scope: dict | None) -> bool:
    """True when rel_path is allowed by the envelope's scope.

    include entries are directory prefixes or glob patterns; exclude wins.
    A missing or empty scope allows everything (the guard stays quiet when the
    pipeline did not say otherwise).
    """
    if not scope:
        return True
    rel = rel_path.lstrip("./")
    for pattern in scope.get("exclude") or []:
        if _matches(rel, pattern):
            return False
    include = scope.get("include") or []
    if not include:
        return True
    for pattern in include:
        if _matches(rel, pattern):
            return True
    return False


def _matches(rel: str, pattern: str) -> bool:
    pattern = pattern.rstrip("/")
    if not pattern:
        return False
    if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(rel, pattern + "/*"):
        return True
    return rel == pattern or rel.startswith(pattern + "/")


def deny(event: str, reason: str) -> None:
    """Emit a PreToolUse deny decision and exit cleanly."""
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": event,
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def allow_silently() -> None:
    print("{}")
    sys.exit(0)


def always_allowed_paths() -> tuple[str, ...]:
    """Paths a stage session may always touch, whatever the task scope says:
    its own ledger, its screenshots, and the envelope directory."""
    return ("docs/pipeline/", "screenshots/", ".agentkit/")
