---
name: task
description: Turn a request into an Agent Kit task — interview, write the spec, open the GitHub issue and the ledger branch. Use when someone describes work they want done later rather than asking for it now.
user-invocable: true
argument-hint: "<what you want done>"
allowed-tools: Read, Write, Bash, Grep, Glob, mcp__github__issue_write, mcp__github__issue_read, mcp__github__get_file_contents, mcp__github__create_branch
---

# New task

## Interview

Ask everything you need in **one** message, with your own proposal already filled in so the
answer can be "yes". Never ask a question the repository can answer.

Propose: the goal in one sentence; two to four acceptance criteria; the scope paths; a size; a
priority; whether it changes UI. Then ask only about what you genuinely cannot infer — usually
the deadline and whether anything about the intended approach is already decided.

Good acceptance criteria name something observable:

- `GET /api/payables/reconciliations/{id}/export.xlsx returns 200 for org members and 403 otherwise`
- `The export button appears on ReconciliationDetail and is disabled while the request is in flight`
- `Backend tests cover the permission matrix and the column set`

Bad ones cannot be checked: "the export works", "clean code", "good UX".

## Write the spec

Validate against `schemas/task_spec.json`. Derive what the requester left out:

| Field | Default |
|---|---|
| `size` | `small` one file or endpoint, no schema change · `medium` one app or screen, may include a migration · `large` more than two apps, schema plus UI, or any path in `invariants`/`security_sensitive_paths` |
| `priority` | `run_now` → P0 · deadline within 24h → P1 · none → P2 · explicitly background → P3 |
| `deploy_policy` | `pipeline.yml.deploy.default_policy` |
| `ui_change` | true when `scope.include` names anything under the frontend source root |

Resolve every `scope.include` path against the tree before writing the file. A path that does
not exist is a spec error.

## File it

1. Pick the issue number first (open the issue, then use its number as `<task-id>`), so the id
   in the ledger and the issue agree.
2. Create the branch `agent/<task-id>-<slug>` from the default branch.
3. Write `docs/pipeline/<task-id>/task.md`: the spec as a fenced YAML block, then two or three
   sentences restating the goal in prose for a human reader.
4. Commit the ledger folder to the branch and push it.
5. Label the issue `agent-task`, `pipeline:ready`, `priority:<class>`, `size:<class>`, and
   `ui-change` when it applies.
6. Append `intake_accepted` with the ledger skill.

## Report back

Tell the requester: the issue link, the derived priority and size with a one-line reason each,
when the Dispatcher expects to start it (`/agent-kit:capacity` if a Hub is configured), and how
to force it sooner (`run_now`). Nothing else.
