#!/usr/bin/env python3
"""Where a task stands, and what should happen next — computed, not judged.

The Orchestrator is woken repeatedly, by several paths, with no memory between
wakes. Two wakes arriving at once must not produce two rounds of work, and a
wake with nothing new must produce nothing at all. That is a mechanical question
about an append-only event log, so it is answered here rather than left to a
model's reading of the ledger.

    pipeline_state.py --task task-231 --status
    pipeline_state.py --task task-231 --next --size medium
    pipeline_state.py --task task-231 --validate ready-for-deploy

Standard library only: this runs inside every target repository.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from agentkit import project_dir
except ImportError:  # standalone use outside a session
    def project_dir(payload=None) -> Path:  # type: ignore[misc]
        return Path.cwd()

INTAKE = "intake"
QUEUED = "queued"
PLANNED = "planned"
AWAITING_PLAN = "awaiting-plan-approval"
EXECUTING = "executing"
IN_REVIEW = "in-review"
CHANGES_REQUESTED = "changes-requested"
QA = "qa"
QA_FAILED = "qa-failed"
READY_FOR_DEPLOY = "ready-for-deploy"
QA_DEPLOYED = "qa-deployed"
PENDING_FINAL = "pending-final-review-and-deployment"
PROD_DEPLOYED = "prod-deployed"
WATCHING = "watching"
DONE = "done"
BLOCKED = "blocked"
FAILED = "failed"

# `deferred` is deliberately not a state: it is a scheduling fact that leaves
# the pipeline state untouched and clears when the job is dispatched. It travels
# as a flag on the status, and as a label for a human to read.

ORDER = [
    INTAKE, QUEUED, PLANNED, AWAITING_PLAN, EXECUTING, IN_REVIEW, CHANGES_REQUESTED,
    QA, QA_FAILED, READY_FOR_DEPLOY, QA_DEPLOYED, PENDING_FINAL, PROD_DEPLOYED,
    WATCHING, DONE,
]

ALLOWED: dict[str, set[str]] = {
    INTAKE: {QUEUED, BLOCKED, FAILED},
    QUEUED: {PLANNED, AWAITING_PLAN, BLOCKED, FAILED},
    PLANNED: {AWAITING_PLAN, EXECUTING, BLOCKED, FAILED},
    AWAITING_PLAN: {PLANNED, EXECUTING, BLOCKED, FAILED},
    EXECUTING: {IN_REVIEW, BLOCKED, FAILED},
    IN_REVIEW: {CHANGES_REQUESTED, QA, BLOCKED, FAILED},
    CHANGES_REQUESTED: {EXECUTING, BLOCKED, FAILED},
    QA: {READY_FOR_DEPLOY, QA_FAILED, BLOCKED, FAILED},
    QA_FAILED: {EXECUTING, BLOCKED, FAILED},
    READY_FOR_DEPLOY: {QA_DEPLOYED, BLOCKED, FAILED},
    QA_DEPLOYED: {PENDING_FINAL, BLOCKED, FAILED},
    PENDING_FINAL: {PROD_DEPLOYED, BLOCKED, FAILED},
    PROD_DEPLOYED: {WATCHING, BLOCKED, FAILED},
    WATCHING: {DONE, BLOCKED, FAILED},
    DONE: set(),
    BLOCKED: set(ORDER) | {FAILED},
    FAILED: {QUEUED},
}


def load_events(root: Path, task: str) -> list[dict]:
    path = root / "docs" / "pipeline" / task / "timeline.jsonl"
    if not path.is_file():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # a malformed line is skipped, never guessed at
    return events


def derive(events: list[dict]) -> dict:
    """Fold the event log into the state it implies.

    Only stage outcomes move the state. `state_changed` events record what the
    Orchestrator believed at the time; they are compared against this, not
    trusted over it, which is what makes a stale label recoverable.
    """
    state = INTAKE
    review_rounds = 0
    qa_rounds = 0
    executor_rounds = 0
    watch_rounds = 0
    deferred = False
    recorded = INTAKE
    open_jobs: dict[tuple[str, int], str] = {}
    finished: set[tuple[str, int]] = set()
    last_session = ""

    for event in events:
        kind = event.get("event")
        stage = event.get("stage") or ""
        status = event.get("status") or ""
        round_ = int(event.get("round") or 1)
        if event.get("session"):
            last_session = event["session"]

        if kind == "intake_accepted":
            state = QUEUED
        elif kind == "planned":
            state = PLANNED
        elif kind == "plan_approval_requested":
            state = AWAITING_PLAN
        elif kind == "plan_approved":
            state = PLANNED
        elif kind == "stage_job_created":
            open_jobs[(stage, round_)] = "created"
            deferred = False
        elif kind in ("scheduled", "dispatched"):
            open_jobs[(stage, round_)] = kind
            deferred = False
        elif kind == "deferred":
            deferred = True
        elif kind == "interrupted":
            open_jobs.pop((stage, round_), None)
        elif kind == "stage_started":
            open_jobs[(stage, round_)] = "running"
            if stage == "executor":
                state = EXECUTING
            elif stage == "review":
                state = IN_REVIEW
            elif stage == "qa":
                state = QA
        elif kind == "stage_finished":
            open_jobs.pop((stage, round_), None)
            finished.add((stage, round_))
            if status == "blocked":
                # The stage could not do its work for a reason outside the
                # branch: a command the allow-list withholds, a seed the
                # repository lacks, a dev port another project holds. Another
                # round of the previous stage cannot change any of that, so this
                # goes to a person rather than back to the Executor.
                state = BLOCKED
            elif stage == "plan":
                state = PLANNED
            elif stage == "executor":
                executor_rounds = max(executor_rounds, round_)
                state = IN_REVIEW if status in ("ok", "passed") else FAILED
            elif stage == "review":
                review_rounds = max(review_rounds, round_)
                state = CHANGES_REQUESTED if status == "changes_requested" else (
                    QA if status in ("ok", "passed") else FAILED)
            elif stage == "qa":
                qa_rounds = max(qa_rounds, round_)
                state = READY_FOR_DEPLOY if status == "passed" else (
                    QA_FAILED if status == "failed" else state)
            elif stage == "deploy":
                state = QA_DEPLOYED if status in ("ok", "passed") else FAILED
            elif stage == "watch":
                watch_rounds = max(watch_rounds, round_)
        elif kind == "deployed":
            env = event.get("env") or ("prod" if (event.get("reason") or "").startswith("prod") else "qa")
            state = PROD_DEPLOYED if env == "prod" else QA_DEPLOYED
        elif kind == "deploy_requested":
            state = PENDING_FINAL if state == QA_DEPLOYED else state
        elif kind == "deploy_approved":
            state = PROD_DEPLOYED
        elif kind == "rollback":
            state = BLOCKED
        elif kind == "blocked":
            state = BLOCKED
        elif kind == "done":
            state = DONE
        elif kind == "state_changed":
            recorded = event.get("state_to") or recorded
            if event.get("state_to") in (PENDING_FINAL, WATCHING, DONE, BLOCKED, FAILED):
                # These have no stage event of their own; the Orchestrator's
                # record is the only evidence they happened.
                state = event["state_to"]

    return {
        "state": state,
        "recorded_state": recorded,
        "review_rounds": review_rounds,
        "qa_rounds": qa_rounds,
        "executor_rounds": executor_rounds,
        "watch_rounds": watch_rounds,
        "open_jobs": {f"{s}#{r}": v for (s, r), v in open_jobs.items()},
        "finished": sorted(f"{s}#{r}" for s, r in finished),
        "deferred": deferred,
        "last_session": last_session,
        "events": len(events),
    }


def next_action(events: list[dict], *, size: str = "medium", review_cap: int = 3,
                qa_cap: int = 2, plan_approval: str = "large",
                approval_paths_touched: bool = False, watch_cap: int = 12) -> dict:
    """What the Orchestrator should do on this wake — including nothing.

    Returning `wait` is the normal answer, not a failure: most wakes arrive
    while a stage is still running, and the correct response to those is to
    leave it alone.
    """
    facts = derive(events)
    state = facts["state"]
    open_jobs = facts["open_jobs"]

    def result(action, **extra):
        return {"action": action, "from": state, **facts_summary(facts), **extra}

    # Something is already in flight. A second wake must not start it again.
    if open_jobs:
        job, marker = next(iter(open_jobs.items()))
        return result("wait", reason=f"{job} is already {marker}", open_jobs=open_jobs)

    if state in (DONE, FAILED):
        return result("wait", reason=f"the task is {state}")

    if state == BLOCKED:
        return result("escalate", reason="the task is blocked and needs a person")

    if state == INTAKE:
        return result("wait", reason="intake has not accepted this task yet")

    if state == QUEUED:
        return result("transition", to=PLANNED, create_job={"stage": "plan", "round": 1},
                      reason="the task is queued and has no plan yet")

    if state == PLANNED:
        needs_approval = plan_approval == "always" or size == "large" or approval_paths_touched
        approved = any(e.get("event") == "plan_approved" for e in events)
        if needs_approval and not approved:
            return result("gate", to=AWAITING_PLAN,
                          reason=("this task needs a person to approve the plan: "
                                  + ("policy is plan_approval: always" if plan_approval == "always"
                                     else "it is size: large" if size == "large"
                                     else "the plan touches a protected path")))
        return result("transition", to=EXECUTING,
                      create_job={"stage": "executor", "round": facts["executor_rounds"] + 1},
                      reason="the plan is ready" + (" and approved" if approved else ""))

    if state == AWAITING_PLAN:
        return result("wait", reason="waiting for a person to approve the plan")

    if state == EXECUTING:
        return result("wait", reason="the executor stage has not reported yet")

    if state == IN_REVIEW:
        round_ = facts["review_rounds"] + 1
        return result("transition", to=IN_REVIEW, create_job={"stage": "review", "round": round_},
                      reason="the branch is ready for review")

    if state == CHANGES_REQUESTED:
        if facts["review_rounds"] >= review_cap:
            return result("escalate", to=BLOCKED,
                          reason=(f"review round {facts['review_rounds']} of a cap of {review_cap}: "
                                  f"stop and put the open findings to a person"))
        return result("transition", to=EXECUTING,
                      create_job={"stage": "executor", "round": facts["executor_rounds"] + 1,
                                  "findings_ref": f"review.md#round-{facts['review_rounds']}"},
                      reason=f"review round {facts['review_rounds']} requested changes")

    if state == QA:
        round_ = facts["qa_rounds"] + 1
        return result("transition", to=QA, create_job={"stage": "qa", "round": round_},
                      reason="the review approved; QA next")

    if state == QA_FAILED:
        if facts["qa_rounds"] >= qa_cap:
            return result("escalate", to=BLOCKED,
                          reason=(f"QA round {facts['qa_rounds']} of a cap of {qa_cap}: "
                                  f"stop and put the failure to a person"))
        return result("transition", to=EXECUTING,
                      create_job={"stage": "executor", "round": facts["executor_rounds"] + 1,
                                  "findings_ref": f"qa.md#round-{facts['qa_rounds']}"},
                      reason=f"QA round {facts['qa_rounds']} failed")

    if state == READY_FOR_DEPLOY:
        return result("handoff", reason="review and QA are green; the deploy stage takes it from here")

    if state == QA_DEPLOYED:
        return result("gate", to=PENDING_FINAL,
                      reason="QA is deployed; production waits for a person to approve it")

    if state == PENDING_FINAL:
        return result("wait", reason="waiting for a person to approve the production deploy")

    if state == PROD_DEPLOYED:
        return result("transition", to=WATCHING, reason="production is live; watch it")

    if state == WATCHING:
        # The watch window is normally driven by the Deployer re-arming itself
        # with send_later. That tool only exists in a CCR session, so a stage
        # that ran in a workflow would leave production unwatched — which is the
        # one thing the window exists to prevent. Any wake can therefore run the
        # next check, and the open-job guard above stops two from overlapping.
        if facts["watch_rounds"] >= watch_cap:
            return result("escalate", to=BLOCKED,
                          reason=(f"{facts['watch_rounds']} watch rounds and the window has still "
                                  f"not been closed; a person should look at the rollout"))
        return result("transition", to=WATCHING,
                      create_job={"stage": "watch", "round": facts["watch_rounds"] + 1},
                      reason="production is live and the watch window is still open")

    return result("wait", reason=f"no rule covers {state}")


def facts_summary(facts: dict) -> dict:
    return {
        "review_rounds": facts["review_rounds"],
        "qa_rounds": facts["qa_rounds"],
        "executor_rounds": facts["executor_rounds"],
        "watch_rounds": facts["watch_rounds"],
        "deferred": facts["deferred"],
    }


def validate(events: list[dict], to_state: str) -> dict:
    facts = derive(events)
    current = facts["state"]
    if to_state == current:
        return {"ok": True, "reason": "already there; nothing to do", "from": current, "noop": True}
    allowed = ALLOWED.get(current, set())
    if to_state not in allowed:
        return {
            "ok": False,
            "from": current,
            "reason": (f"{current} → {to_state} is not a transition the contract allows "
                       f"(from {current} you may go to: {', '.join(sorted(allowed)) or 'nowhere'})"),
        }
    return {"ok": True, "from": current, "to": to_state, "reason": "allowed"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--task", required=True)
    parser.add_argument("--project-dir", type=Path)
    parser.add_argument("--status", action="store_true", help="print the derived state")
    parser.add_argument("--next", dest="next_", action="store_true", help="print the next action")
    parser.add_argument("--validate", metavar="STATE", help="check a proposed transition")
    parser.add_argument("--size", default="medium", choices=["small", "medium", "large"])
    parser.add_argument("--review-rounds", type=int, default=3)
    parser.add_argument("--qa-rounds", type=int, default=2)
    parser.add_argument("--watch-rounds", type=int, default=12,
                        help="most checks a watch window may run before a person is asked to look")
    parser.add_argument("--plan-approval", default="large", choices=["large", "always"])
    parser.add_argument("--protected-paths-touched", action="store_true")
    args = parser.parse_args()

    root = args.project_dir or project_dir()
    events = load_events(root, args.task)
    if not events:
        print(json.dumps({"task": args.task, "state": INTAKE, "events": 0,
                          "reason": "no timeline yet"}, indent=2))
        return 0

    if args.validate:
        print(json.dumps({"task": args.task, **validate(events, args.validate)}, indent=2))
        return 0
    if args.next_:
        print(json.dumps({"task": args.task, **next_action(
            events, size=args.size, review_cap=args.review_rounds, qa_cap=args.qa_rounds,
            plan_approval=args.plan_approval, approval_paths_touched=args.protected_paths_touched,
            watch_cap=args.watch_rounds,
        )}, indent=2))
        return 0

    print(json.dumps({"task": args.task, **derive(events)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
