#!/usr/bin/env python3
"""Is this repository actually wired to the pipeline?

Run in a target repo after onboarding, and any time something is not working:

    doctor.py                 # human-readable report, exit 1 if anything is broken
    doctor.py --json          # machine-readable, for the Initializer's PR body

The failures this catches are the quiet ones — a `pipeline.yml` that names a
script nobody wrote, a workflow that is not on the default branch, a scope
setting that would block every edit. Each check says what is wrong and what to
do about it, because a report that only says "FAIL" makes someone else do the
diagnosis twice.

Standard library plus PyYAML, because it runs inside the repo being checked.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - the message is the useful part
    print("doctor: PyYAML is not installed; pip install pyyaml", file=sys.stderr)
    sys.exit(2)

OK, WARN, FAIL = "ok", "warn", "fail"


@dataclass
class Result:
    checks: list[dict] = field(default_factory=list)

    def add(self, name: str, status: str, detail: str = "", fix: str = "") -> None:
        self.checks.append({"check": name, "status": status, "detail": detail, "fix": fix})

    @property
    def failures(self) -> list[dict]:
        return [c for c in self.checks if c["status"] == FAIL]

    @property
    def warnings(self) -> list[dict]:
        return [c for c in self.checks if c["status"] == WARN]


def load_pipeline(root: Path, result: Result) -> dict:
    path = root / "pipeline.yml"
    if not path.is_file():
        result.add("pipeline.yml", FAIL, "not found",
                   "Copy templates/repo/pipeline.yml.tmpl and fill in every {{placeholder}}.")
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        result.add("pipeline.yml", FAIL, f"does not parse: {exc}", "Fix the YAML.")
        return {}

    unfilled = re.findall(r"\{\{[^}]+\}\}", path.read_text(encoding="utf-8"))
    if unfilled:
        result.add("pipeline.yml", FAIL,
                   f"{len(unfilled)} placeholder(s) still unfilled: {', '.join(unfilled[:4])}",
                   "Every {{placeholder}} must be replaced; the pipeline never guesses a value.")
    else:
        result.add("pipeline.yml", OK, f"project {data.get('project', '?')}")
    return data


def check_scripts(root: Path, config: dict, result: Result) -> None:
    scripts = (config.get("scripts") or {})
    if not scripts:
        result.add("scripts", FAIL, "pipeline.yml names no scripts",
                   "Every stage runs these; without them nothing can verify anything.")
        return
    for role, rel in scripts.items():
        path = root / str(rel)
        if not path.is_file():
            result.add(f"scripts.{role}", FAIL, f"{rel} does not exist",
                       f"Copy templates/repo/{rel} and adapt it.")
        elif not os.access(path, os.X_OK):
            result.add(f"scripts.{role}", WARN, f"{rel} is not executable",
                       f"chmod +x {rel} — it is invoked directly in some paths.")
        else:
            result.add(f"scripts.{role}", OK, str(rel))


def check_workflows(root: Path, config: dict, result: Result) -> None:
    expected = {
        "ci.yml": "the required check; without it nothing gates a merge",
        "deploy.yml": "QA and production deploys",
        "agentkit-stage.yml": "how a pool's credential runs a stage on a runner",
        "agentkit-orchestrator.yml": "the wake path where the Hub does not wake this repository itself; "
                                     "it skips while AGENTKIT_WAKES_FROM_HUB is true, so keeping it costs nothing",
    }
    workflows = root / ".github" / "workflows"
    for name, why in expected.items():
        path = workflows / name
        if not path.is_file():
            result.add(f"workflow {name}", FAIL, "missing", why)
            continue
        try:
            yaml.safe_load(path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            result.add(f"workflow {name}", FAIL, f"does not parse: {exc}", "Fix the YAML.")
        else:
            result.add(f"workflow {name}", OK)

    if (workflows / "rollback.yml").is_file():
        result.add("workflow rollback.yml", OK)
    else:
        result.add("workflow rollback.yml", WARN, "missing",
                   "Without it the watch window can detect a bad rollout and not undo it.")


def check_health(root: Path, config: dict, result: Result) -> None:
    path = (config.get("deploy") or {}).get("health_path")
    if not path:
        result.add("health path", FAIL, "deploy.health_path is not set",
                   "The deploy refuses to migrate traffic without one.")
        return
    hits = grep(root, re.escape(str(path).strip("/").split("/")[-1]), ("*.py",))
    if hits:
        result.add("health path", OK, f"{path} routed in {hits[0]}")
    else:
        result.add("health path", WARN, f"{path} is configured but no route matches it",
                   "Add templates/repo/snippets/health.py and route it. It must report the "
                   "revision and touch the database, or a deploy cannot tell the new revision "
                   "from the old one.")


def check_ledger(root: Path, result: Result) -> None:
    if (root / "docs" / "pipeline" / "README.md").is_file():
        result.add("ledger", OK, "docs/pipeline/ exists")
    else:
        result.add("ledger", FAIL, "docs/pipeline/README.md is missing",
                   "Copy templates/repo/docs/pipeline/. It is where every stage writes.")


def check_claude_config(root: Path, result: Result) -> None:
    settings = root / ".claude" / "settings.json"
    if not settings.is_file():
        result.add(".claude/settings.json", WARN, "missing",
                   "Copy templates/repo/.claude/settings.json — it enables the plugin and the hooks.")
        return
    try:
        data = json.loads(settings.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        result.add(".claude/settings.json", FAIL, f"does not parse: {exc}", "Fix the JSON.")
        return
    plugins = data.get("enabledPlugins") or []
    if any("agent-kit" in str(p) for p in plugins):
        result.add(".claude/settings.json", OK)
    else:
        result.add(".claude/settings.json", WARN, "the kit plugin is not enabled",
                   'Add "agent-kit@agent-kit" to enabledPlugins.')

    if (root / "CLAUDE.md").is_file():
        lines = len((root / "CLAUDE.md").read_text(encoding="utf-8").splitlines())
        if lines > 200:
            result.add("CLAUDE.md", WARN, f"{lines} lines",
                       "Keep it under 200: procedure belongs in skills, configuration in "
                       "pipeline.yml. A long guide is one nobody reads to the end.")
        else:
            result.add("CLAUDE.md", OK, f"{lines} lines")
    else:
        result.add("CLAUDE.md", FAIL, "missing", "Copy templates/repo/CLAUDE.md.tmpl.")


def check_gitignore(root: Path, result: Result) -> None:
    path = root / ".gitignore"
    text = path.read_text(encoding="utf-8") if path.is_file() else ""
    missing = [entry for entry in (".agentkit/", ".env") if entry not in text]
    if missing:
        result.add(".gitignore", FAIL, f"does not ignore {', '.join(missing)}",
                   "See templates/repo/gitignore-additions.txt. `.agentkit/` holds the stage "
                   "envelope; committing it puts a run id and a pool in the history of every task.")
    else:
        result.add(".gitignore", OK)


def check_invariants(root: Path, config: dict, result: Result) -> None:
    invariants = config.get("invariants") or []
    if not invariants:
        result.add("invariants", WARN, "none declared",
                   "The Reviewer checks these literally every round. A repo with none is a repo "
                   "where nothing is mechanically protected.")
        return
    unfilled = [i for i in invariants if "{{" in str(i)]
    if unfilled:
        result.add("invariants", FAIL, f"{len(unfilled)} still contain placeholders",
                   "Write them as commands or conditions, not aspirations.")
    else:
        result.add("invariants", OK, f"{len(invariants)} declared")


def grep(root: Path, pattern: str, globs: tuple[str, ...]) -> list[str]:
    hits: list[str] = []
    regex = re.compile(pattern)
    for glob in globs:
        for path in root.rglob(glob):
            if any(part in {".git", "node_modules", ".venv", "venv"} for part in path.parts):
                continue
            try:
                if regex.search(path.read_text(encoding="utf-8", errors="ignore")):
                    hits.append(str(path.relative_to(root)))
            except OSError:
                continue
            if len(hits) >= 5:
                return hits
    return hits


def check_verify_runs(root: Path, config: dict, result: Result) -> None:
    """The gate has to actually run, not merely exist."""
    script = (config.get("scripts") or {}).get("verify")
    if not script or not (root / str(script)).is_file():
        return
    try:
        proc = subprocess.run(["bash", "-n", str(root / str(script))],
                              capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:
        result.add("verify parses", WARN, str(exc))
        return
    if proc.returncode == 0:
        result.add("verify parses", OK)
    else:
        result.add("verify parses", FAIL, proc.stderr.strip()[:200], "Fix the syntax error.")


def run(root: Path) -> Result:
    result = Result()
    config = load_pipeline(root, result)
    check_scripts(root, config, result)
    check_verify_runs(root, config, result)
    check_workflows(root, config, result)
    check_health(root, config, result)
    check_ledger(root, result)
    check_claude_config(root, result)
    check_gitignore(root, result)
    check_invariants(root, config, result)
    return result


def render(result: Result) -> str:
    marks = {OK: "ok  ", WARN: "warn", FAIL: "FAIL"}
    lines = []
    for check in result.checks:
        line = f"  [{marks[check['status']]}] {check['check']}"
        if check["detail"]:
            line += f" — {check['detail']}"
        lines.append(line)
        if check["status"] != OK and check["fix"]:
            lines.append(f"           {check['fix']}")
    lines.append("")
    if result.failures:
        lines.append(f"{len(result.failures)} failure(s), {len(result.warnings)} warning(s). "
                     f"The pipeline will not work here until the failures are fixed.")
    elif result.warnings:
        lines.append(f"No failures, {len(result.warnings)} warning(s). "
                     f"The pipeline will run; the warnings are things that bite later.")
    else:
        lines.append("Everything checks out.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = run(args.root.resolve())
    if args.json:
        print(json.dumps({"checks": result.checks,
                          "failures": len(result.failures),
                          "warnings": len(result.warnings)}, indent=2))
    else:
        print(render(result))
    return 1 if result.failures else 0


if __name__ == "__main__":
    sys.exit(main())
