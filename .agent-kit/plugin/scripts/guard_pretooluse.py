#!/usr/bin/env python3
"""PreToolUse guard: the actions no pipeline stage may take.

Denies, with a reason the model can act on:
  * force pushes, history rewrites, and any push to a shared branch;
  * production deploys and traffic changes (CI owns those, behind a human gate);
  * destructive database statements without an explicit reviewed marker;
  * writes to .env files and credential material;
  * edits outside the task's scope, when an envelope declares one;
  * edits to the pipeline's own configuration from inside a task stage.

Anything not matched is allowed silently, so the guard never interferes with
ordinary work. Standard library only.
"""
from __future__ import annotations

import re
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agentkit import (  # noqa: E402
    allow_silently, always_allowed_paths, deny, envelope, path_in_scope,
    project_dir, read_hook_input, launcher_envelope_path, ENVELOPE_REL
)

EVENT = "PreToolUse"

BASH_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"git\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)"),
     "Force-pushing rewrites history other sessions and reviewers rely on. Push normally, or merge the base branch in."),
    (re.compile(r"git\s+(?:rebase|reset\s+--hard|filter-branch)\b"),
     "History rewrites are not a stage's job. Work on the task branch and open a PR."),
    (re.compile(r"deploy_cloud_run\.sh\b[^|;&]*\bprod\b"),
     "Anything that touches production traffic runs in CI, never from a session: a deploy behind "
     "the GitHub Environment approval, a rollback through rollback.yml. Neither needs a production "
     "credential in here."),
    (re.compile(r"gcloud\s+run\s+services\s+update-traffic\b"),
     "Traffic migration is the deploy workflow's job. The Deployer triggers it through CI; a stage session must not."),
    (re.compile(r"gcloud\s+(?:run\s+(?:deploy|services\s+delete)|sql\s+.*delete|projects\s+delete)\b"),
     "This changes live infrastructure. Deploys go through .github/workflows/deploy.yml; anything else needs a human."),
    (re.compile(r"(?i)\b(?:drop\s+(?:table|database|schema)|truncate\s+table|delete\s+from\s+\w+\s*;)"),
     "Destructive SQL is blocked. If it is genuinely required, put it in a migration, or append the comment -- reviewed to the command after a human has read it."),
    (re.compile(r"(?i)\bmanage\.py\s+(?:flush|sqlflush|reset_db)\b"),
     "This wipes the database the session is working against. Use a fixture or the repo's seed script instead."),
    (re.compile(r"rm\s+-rf\s+(?:/|~|\$HOME|\.git\b)"),
     "Refusing a recursive delete of a root, home, or the git directory."),
    (re.compile(r"(?:^|[;&|]\s*)claude\s+(?:setup-token|/login)\b"),
     "Credential setup is a human action outside the pipeline."),
]

SQL_REVIEWED = re.compile(r"--\s*reviewed\b")

# Branches the pipeline never pushes to directly. Everything reaches them
# through a reviewed pull request, which is the point of the whole apparatus.
PROTECTED_BRANCHES = {"main", "master", "qa", "develop", "production", "release"}
PUSH_TO_BRANCH = (
    "Agent Kit guard: pushing straight to {branch} skips the review and the checks that gate it. "
    "Push the task branch and open a pull request — that is the only route to a shared branch, "
    "including for a one-line fix."
)

# Merging is the Deployer's decision, made after its preconditions are checked.
GH_MERGE = re.compile(r"\bgh\s+pr\s+merge\b")
GH_BYPASS = re.compile(r"--admin\b|--auto\b.*--admin\b")
GH_API_MERGE = re.compile(r"\bgh\s+api\b[^|;&]*/pulls/\d+/merge\b")

PROTECTED_WRITE = [
    (re.compile(r"(?:^|/)\.env(\.|$)"), "Writing .env files from a session risks committing credentials. Ask the human to set the variable."),
    (re.compile(r"(?:^|/)\.credentials\.json$"), "Credential files are never written by a stage."),
    (re.compile(r"\.pem$|\.p12$|(?:^|/)id_rsa$"), "Key material is never written by a stage."),
]

PIPELINE_OWNED = [
    ("pipeline.yml", "pipeline.yml is the repo contract. Changing it is its own task, reviewed on its own PR."),
    (".claude/", "Files under .claude/ are agent instructions: changing them from inside a task stage is a privilege-escalation path. Raise it as a separate task."),
    (".github/workflows/", "Workflow changes are their own task so a human reviews the CI and deploy path deliberately."),
]

# The one stage whose job is the files above. The Initializer writes
# `pipeline.yml`, `.claude/settings.json`, `.claude/rules/` and the workflows,
# and a guard that refused them made the Hub's "Run the Initializer" button a
# session that could only fail. It stays safe for the reasons the rule exists:
# a person starts it, it works on its own branch (the push rules below still
# apply), and nothing it writes reaches the default branch except through a
# pull request a person reviews. Every task stage, `orchestrate` included,
# keeps the rule.
WRITES_PIPELINE_FILES = {"init"}

WRITE_TOOLS = {"Edit", "Write", "NotebookEdit", "MultiEdit"}


def current_branch(payload: dict) -> str:
    """The branch this session is on, for the `git push` with no arguments case."""
    # symbolic-ref rather than rev-parse: it answers on a branch with no commits
    # yet, which is exactly the state a freshly created task branch is in.
    try:
        result = subprocess.run(
            ["git", "symbolic-ref", "--quiet", "--short", "HEAD"],
            cwd=str(project_dir(payload)), capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def push_targets(command: str) -> list[str]:
    """Branch names a `git push` would write to.

    Parsed rather than pattern-matched: `git push origin main`,
    `push -u origin main`, `HEAD:main`, `main:main` and
    `HEAD:refs/heads/main` are the same act, and a rule that catches only some
    spellings reads as protection while providing none.
    """
    try:
        words = shlex.split(command)
    except ValueError:
        words = command.split()
    if "push" not in words:
        return []

    rest = words[words.index("push") + 1:]
    targets: list[str] = []
    skip_next = False
    for word in rest:
        if skip_next:
            skip_next = False
            continue
        if word in ("-o", "--push-option", "--repo", "--receive-pack", "--exec"):
            skip_next = True
            continue
        if word.startswith("-"):
            continue
        # The first bare word is the remote; everything after it is a refspec.
        if not targets and "/" not in word and ":" not in word:
            targets.append("")  # placeholder for the remote
            continue
        ref = word.split(":")[-1]
        targets.append(ref.replace("refs/heads/", ""))
    return [t for t in targets if t]


def check_push(command: str, payload: dict) -> None:
    if not re.search(r"\bgit\s+push\b", command):
        return
    targets = push_targets(command)
    if not targets or "HEAD" in targets:
        # `git push` with no refspec, and `push origin HEAD`, both push whatever
        # branch the session is standing on — which may well be a protected one.
        branch = current_branch(payload)
        targets = [branch if t == "HEAD" else t for t in targets] if targets else (
            [branch] if branch else [])
    for target in targets:
        if target.split("/")[-1] in PROTECTED_BRANCHES:
            deny(EVENT, PUSH_TO_BRANCH.format(branch=target))


def check_merge(command: str, env: dict | None) -> None:
    """A stage may not merge its own work; only the deploy stage merges at all."""
    if GH_API_MERGE.search(command):
        deny(EVENT, "Agent Kit guard: merging through the API bypasses the Deployer's "
                    "preconditions — review approved, QA passed, every required check green. "
                    "The deploy stage merges, after checking those.")
    if not GH_MERGE.search(command):
        return
    if GH_BYPASS.search(command):
        deny(EVENT, "Agent Kit guard: --admin merges past the required checks, which is the one "
                    "thing the checks exist to prevent. Fix what is red instead.")
    stage = (env or {}).get("stage")
    if stage and stage != "deploy":
        deny(EVENT, f"Agent Kit guard: the {stage} stage does not merge. The deploy stage merges, "
                    f"once review is approved, QA has passed and every required check is green.")


def check_bash(command: str, env: dict | None) -> None:
    for pattern, reason in BASH_RULES:
        if pattern.search(command):
            if "SQL" in reason and SQL_REVIEWED.search(command):
                continue
            deny(EVENT, f"Agent Kit guard: {reason}")


def check_write(rel: str, env: dict | None) -> None:
    for pattern, reason in PROTECTED_WRITE:
        if pattern.search(rel):
            deny(EVENT, f"Agent Kit guard: {reason}")
    if env:
        if env.get("stage") not in WRITES_PIPELINE_FILES:
            for prefix, reason in PIPELINE_OWNED:
                if rel == prefix.rstrip("/") or rel.startswith(prefix):
                    deny(EVENT, f"Agent Kit guard: {reason}")
        if rel.startswith(always_allowed_paths()):
            return
        scope = env.get("scope")
        if scope and not path_in_scope(rel, scope):
            include = ", ".join(scope.get("include") or []) or "(none)"
            deny(
                EVENT,
                f"Agent Kit guard: {rel} is outside this task's scope (include: {include}). "
                "If the change genuinely needs it, stop and record why in execution.md so the "
                "Orchestrator can widen the scope on the task, then continue.",
            )


def main() -> None:
    payload = read_hook_input()
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input") or {}
    env = envelope(payload)

    if tool == "Bash":
        command = str(tool_input.get("command", ""))
        check_bash(command, env)
        check_push(command, payload)
        check_merge(command, env)
    elif tool in WRITE_TOOLS:
        target = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        if target:
            root = project_dir(payload)
            launched = launcher_envelope_path()
            if launched:
                # The launcher wrote the envelope and the hooks read only that
                # copy. Writing it, or the in-checkout twin a hook would never
                # read, is a stage trying to change its own contract.
                try:
                    same = Path(target).resolve() == launched.resolve()
                except OSError:
                    same = False
                if same or Path(target).resolve() == (root / ENVELOPE_REL).resolve():
                    deny(EVENT, "Agent Kit guard: the stage envelope is written by the launcher, not the stage. "
                                "Its scope is changed on the task by the Orchestrator, never from inside a session.")
            try:
                rel = str(Path(target).resolve().relative_to(root.resolve()))
            except Exception:
                rel = str(target)
            check_write(rel.replace("\\", "/"), env)

    allow_silently()


if __name__ == "__main__":
    main()
