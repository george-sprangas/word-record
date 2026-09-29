---
name: ledger
description: Append an event to a task's timeline and mirror it as the PR status comment. Use at the end of every pipeline stage, and whenever the pipeline's state changes. The ledger is the pipeline's only memory.
user-invocable: true
argument-hint: "<task-id> <event> [--stage ... --status ... --summary ...]"
allowed-tools: Read, Write, Bash, mcp__github__add_issue_comment, mcp__github__pull_request_read, mcp__github__issue_read
---

# Ledger

`docs/pipeline/<task-id>/timeline.jsonl` is the state of a task. Labels, PR text and anything an
agent remembers are derived; this file is the source. It is committed with the branch, so the
history travels with the code and survives every session ending.

## Append an event

Build the object (see `schemas/timeline_event.json`), then:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/ledger_append.py" --from-json - <<'JSON'
{"task":"task-231","event":"stage_finished","actor":"reviewer","stage":"review","round":1,
 "run_id":"run_01J...","pool":"max-george","model":"claude-opus-5","status":"changes_requested",
 "summary":"2 high: org scoping missing on the export view; N+1 in the serializer",
 "session":"https://claude.ai/code/session_...",
 "usage":{"input":812000,"output":41000,"cache_read":3900000,"cache_write":120000,"cost_est_usd":9.40},
 "artifacts":["docs/pipeline/task-231/review.md"]}
JSON
```

For quick notes the flag form is shorter:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/ledger_append.py" \
  --task task-231 --event human_note --actor human --note "Deadline moved to Friday"
```

The script refuses invalid events. `stage_finished` requires `stage`, `status` and a `usage` key
— null fields are fine when the surface did not report numbers, an absent key is not, because
the Evaluator needs to see where measurement is missing.

## Mirror it to the PR

The PR body carries one block between `<!-- pipeline:status -->` markers. It is rewritten in
place from the ledger, never appended to, by one script:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/pr_status.py" --task task-231 --pr 12
```

It renders every finished stage on a line, lists the code commits a reviewer should read (the
ledger's own commits under `docs/pipeline/` are left out), and puts the latest event as JSON in a
collapsed details block for the Orchestrator's wake to parse. Run it once when a stage closes.
Do not post the status as a comment, and do not post a comment describing the stage's work: the
PR is for the reviewer, and the block plus the diff is what they need.

## Writing a good summary

One line, under 200 characters, that tells the next agent what changed: what happened, and what
it means for the next stage. "Review finished" is useless; "2 high: org scoping missing on the
export view; N+1 in the serializer" lets the Executor start without reading anything else.

## Rules

- Append only. Never rewrite or delete a line: a wrong event is corrected by a later one.
- One `stage_finished` per run id. A second means two stages ran in one session, which is a bug.
- Every event carries `run_id` when the stage was dispatched, so usage can be attributed to the
  pool that paid for it.
- Commit the ledger with the work, in the same commit as the stage's markdown file.
