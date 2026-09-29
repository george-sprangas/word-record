#!/usr/bin/env python3
"""Append an event to a task's timeline, and enforce that stages write one.

Modes
-----
  --from-json -            read one complete event object from stdin (skills use this)
  --task ... --event ...   build the event from flags (quick notes, hooks)
  --hook stop              Stop-hook mode: refuses to let a stage session end
                           before it has written its stage_finished event

The timeline lives at <project>/docs/pipeline/<task>/timeline.jsonl and is
committed with the code, so the ledger travels with the branch. Standard
library only.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from agentkit import NO_LEDGER_STAGES, envelope, project_dir, read_hook_input  # noqa: E402

EVENTS = {
    "intake_accepted", "planned", "plan_approval_requested", "plan_approved",
    "stage_job_created", "scheduled", "dispatched", "stage_started", "stage_finished",
    "limit_hit", "interrupted", "deferred", "failed_over", "state_changed",
    "deploy_requested", "deploy_approved", "deployed", "rollback",
    "incident_linked", "blocked", "human_note", "done",
}
# What a stage may say about how it ended. The same list as schemas/timeline_event.json:
# the state machine reads "ok"/"passed" as success and "changes_requested" as the
# review's other verdict, and anything else it does not know falls through to
# `failed`. A reviewer once wrote "approved" — a natural word, and a ledger that
# derived a failed task from an approving review. Refuse it here, where the
# author is still in the session to correct it.
STATUSES = {"ok", "changes_requested", "failed", "passed", "blocked", "deferred", "interrupted", "skipped"}

ACTORS = {
    "intake", "orchestrator", "explore", "executor", "reviewer", "qa",
    "deployer", "monitor", "evaluator", "initializer", "dispatcher", "human",
}


def timeline_path(root: Path, task: str) -> Path:
    return root / "docs" / "pipeline" / task / "timeline.jsonl"


def read_events(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def validate(event: dict) -> list[str]:
    problems = []
    for key in ("ts", "task", "event", "actor"):
        if not event.get(key):
            problems.append(f"missing '{key}'")
    if event.get("event") and event["event"] not in EVENTS:
        problems.append(f"unknown event '{event['event']}'")
    if event.get("actor") and event["actor"] not in ACTORS:
        problems.append(f"unknown actor '{event['actor']}'")
    if event.get("event") == "stage_finished":
        for key in ("stage", "status"):
            if not event.get(key):
                problems.append(f"stage_finished requires '{key}'")
        if event.get("status") and event["status"] not in STATUSES:
            problems.append(f"unknown status '{event['status']}' — one of: {', '.join(sorted(STATUSES))}")
        if "usage" not in event:
            problems.append("stage_finished requires a 'usage' key (null fields are allowed)")
    if event.get("event") == "state_changed" and not (event.get("state_from") and event.get("state_to")):
        problems.append("state_changed requires 'state_from' and 'state_to'")
    return problems


def append(event: dict, root: Path) -> int:
    problems = validate(event)
    if problems:
        print("ledger: refusing to append an invalid event: " + "; ".join(problems), file=sys.stderr)
        return 1
    path = timeline_path(root, event["task"])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(event, separators=(",", ":"), sort_keys=False) + "\n")
    print(f"ledger: appended {event['event']} to {path.relative_to(root)}")
    return 0


def hook_stop() -> int:
    """Block the stop when the stage has not recorded its outcome."""
    payload = read_hook_input()
    if str(payload.get("stop_hook_active", "")).lower() == "true":
        return 0
    env = envelope(payload)
    if not env:
        return 0
    task, run_id, stage = env.get("task"), env.get("run_id"), env.get("stage")
    # `noop` proves a dispatch path and may end at once. The other two are not
    # stages of a task at all: an Orchestrator wake that blocked here until it
    # wrote something would write "nothing happened" to every watcher's inbox.
    if not task or stage in (None, "noop") or stage in NO_LEDGER_STAGES:
        return 0
    root = project_dir(payload)
    events = read_events(timeline_path(root, task))
    for ev in events:
        if ev.get("event") == "stage_finished" and (
            ev.get("run_id") == run_id or (run_id is None and ev.get("stage") == stage)
        ):
            return 0
    print(
        f"Agent Kit ledger: stage '{stage}' of {task} has not written its stage_finished event yet.\n"
        "Before finishing: write the stage's markdown file, append the event with "
        "`/agent-kit:ledger`, and post the PR status comment. The event needs stage, status, "
        "summary, session URL and a usage object (null fields are fine when the surface did "
        "not report them).",
        file=sys.stderr,
    )
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hook", choices=["stop"])
    parser.add_argument("--from-json", dest="from_json", help="read the event object from this file, or - for stdin")
    parser.add_argument("--task")
    parser.add_argument("--event")
    parser.add_argument("--actor")
    parser.add_argument("--stage")
    parser.add_argument("--status")
    parser.add_argument("--round", type=int)
    parser.add_argument("--summary")
    parser.add_argument("--session")
    parser.add_argument("--run-id", dest="run_id")
    parser.add_argument("--pool")
    parser.add_argument("--model")
    parser.add_argument("--state-from", dest="state_from")
    parser.add_argument("--state-to", dest="state_to")
    parser.add_argument("--reason")
    parser.add_argument("--note")
    parser.add_argument("--artifact", action="append", default=[])
    parser.add_argument("--usage-json", dest="usage_json",
                        help="a JSON usage object, or @path to a file holding one")
    parser.add_argument("--project-dir")
    args = parser.parse_args()

    if args.hook == "stop":
        return hook_stop()

    root = Path(args.project_dir) if args.project_dir else project_dir()

    if args.from_json:
        raw = sys.stdin.read() if args.from_json == "-" else Path(args.from_json).read_text(encoding="utf-8")
        try:
            event = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"ledger: input is not valid JSON: {exc}", file=sys.stderr)
            return 1
        event.setdefault("ts", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        return append(event, root)

    if not (args.task and args.event and args.actor):
        parser.error("--task, --event and --actor are required unless --from-json or --hook is used")

    env = envelope() or {}
    event: dict = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "task": args.task,
        "event": args.event,
        "actor": args.actor,
    }
    optional = {
        "stage": args.stage or env.get("stage"),
        "round": args.round if args.round is not None else env.get("round"),
        "run_id": args.run_id or env.get("run_id"),
        "pool": args.pool or env.get("pool"),
        "model": args.model or env.get("model"),
        "status": args.status,
        "summary": args.summary,
        "session": args.session,
        "state_from": args.state_from,
        "state_to": args.state_to,
        "reason": args.reason,
        "note": args.note,
    }
    for key, value in optional.items():
        if value not in (None, ""):
            event[key] = value
    if args.artifact:
        event["artifacts"] = args.artifact
    if args.usage_json:
        raw = args.usage_json
        if raw.startswith("@"):
            # A file the session wrote (e.g. .agentkit/usage.json), not JSON on
            # the command line — where a shell has too many chances to mangle it.
            try:
                raw = Path(raw[1:]).read_text()
            except OSError as exc:
                print(f"ledger: --usage-json {raw}: {exc}", file=sys.stderr)
                return 1
        try:
            event["usage"] = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"ledger: --usage-json is not valid JSON: {exc} — pass a JSON object, or @path to a file holding one",
                  file=sys.stderr)
            return 1
    elif args.event == "stage_finished":
        event["usage"] = {"input": None, "output": None, "cache_read": None,
                          "cache_write": None, "cost_est_usd": None}

    return append(event, root)


if __name__ == "__main__":
    sys.exit(main())
