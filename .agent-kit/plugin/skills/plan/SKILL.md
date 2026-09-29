---
name: plan
description: Write the execution plan for an Agent Kit task — explore the affected code, produce ordered steps with per-step agent, model, acceptance and estimates, and open the draft PR. Use at the start of a task, before any code is written.
user-invocable: true
argument-hint: "<task-id>"
allowed-tools: Read, Write, Bash, Grep, Glob, Agent, mcp__github__create_pull_request, mcp__github__add_issue_comment, mcp__github__get_file_contents
---

# Plan a task

A plan is worth writing only if it saves the Executor from discovering things the hard way. So
the plan is mostly the result of exploration, not a restatement of the task.

## 1. Explore, in parallel

Dispatch `explore` subagents — one per area the scope names, each with a single question, all in
one message so they run concurrently. Ask for what you cannot guess:

- How does this repo already do the thing the task needs (the house pattern, the base class, the
  existing helper)?
- What tests cover this area and what do they assert?
- What will break if this changes (callers, serializers, migrations, cached queries)?

Read their reports, not the files.

## 2. Write `plan.md`

```markdown
# Plan — task-231: Supplier statement reconciliation export

## Approach
Two or three sentences: what we are going to do and why this way rather than the obvious
alternative. Name the existing code we are reusing.

## Steps
| # | Step | Agent | Model | Size | Acceptance | Files expected | est_tokens |
|---|------|-------|-------|------|------------|----------------|-----------|
| 1 | Export service on top of services/exports.py | executor | claude-opus-5 | small | unit test covers the column set | apps/payables/services/exports.py, tests | 0.4M |
| 2 | Endpoint + permissions | executor | claude-opus-5 | medium | 200 for members, 403 otherwise, tested | apps/payables/views/…, urls.py, tests | 0.8M |
| 3 | Export button + loading state | executor | claude-sonnet-5 | small | button disabled while loading | frontend/src/pages/payables/… | 0.4M |

## Verification
The exact commands that must pass, beyond the standard gate.

## Risks
What could make this wrong, and the mitigation. Include anything the explore reports flagged.

## Stage jobs
| stage | round | model | effort | max_turns | est_tokens | depends on |
|-------|-------|-------|--------|-----------|-----------|-----------|
| executor | 1 | claude-opus-5 | xhigh | 200 | 1.6M | plan approved |
| review | 1 | claude-opus-5 | high | 80 | 0.6M | executor 1 |
| qa | 1 | claude-sonnet-5 | medium | 120 | 1.0M | review approved |
```

Rules for the steps:

- Order by dependency: schema and migrations before endpoints, endpoints before UI, tests with
  the code they cover.
- A step is one commit's worth of work with its own acceptance. If a step needs more than a page
  to describe, split it.
- Mark a step `small` only when it genuinely is — that routes it to the cheaper model.
- Estimates are the kit defaults below until the Hub has real medians. They are copied from
  `docs/01_SCHEDULING_AND_POOLS.md` §5 in the kit's own repository, which a target repository
  does not have — do not search for it.

  | Stage · size | est_tokens | est_duration_min |
  |---|---|---|
  | plan · small / medium / large | 0.3M / 0.6M / 1.2M | 5 / 10 / 20 |
  | executor · small / medium / large | 0.8M / 2.0M / 5.0M | 15 / 40 / 90 |
  | reviewer · any | 0.6M | 15 |
  | qa · without / with visual | 0.5M / 1.0M | 15 / 30 |
  | deployer · qa / prod+watch | 0.2M / 0.4M | 10 / 120 (mostly idle) |
- Name the model per step from `pipeline.yml.models`, raised (never lowered) where the risk is
  real: anything touching auth, permissions, payments or migrations goes to the security model.

## 3. Open the draft PR

Use `mcp__github__create_pull_request` when a GitHub MCP server is connected, and `gh pr create
--draft` when it is not — a stage on a local runner has the `gh` CLI and no MCP server, and a
stage that reports itself blocked for want of a PR has wasted a whole cycle over a transport.
Either way, push the branch first.

Title `<task-id>: <task title>`. Body: the goal, the acceptance criteria as a checklist, the
plan steps as a checklist, and an empty status block for the ledger skill to fill:

```markdown
<!-- pipeline:status -->
_No stage has reported yet._
<!-- /pipeline:status -->
```

## 4. Size, when the task left it to you

A task filed from the Hub usually arrives without a size — "For the plan to decide" in its issue
(P9, D9.13). You have now read the code, so decide it with the Intake agent's rules:

- `small` — one file or one endpoint, no schema change;
- `medium` — one app or one screen, may include a migration;
- `large` — more than two apps, a schema change plus UI, or anything touching a path in
  `pipeline.yml`'s `invariants` or `security_sensitive_paths`.

**Unsure between medium and large? It is large.** Large brings the plan back to a person before
any code is written — the gate is the point of the question, and a wrong "medium" skips it.
Write the size and one line of why at the top of `plan.md`, pass it as `--size` wherever the
state machine asks, and put it in the plan stage's run result as `"size"` so the Hub records it.
A size the task already had is not yours to change.

## 5. Gate or dispatch

If `limits.plan_approval` is `always`, or the task is `size: large`, or any step touches a path
in `invariants` or `security_sensitive_paths`: post the plan on the issue, set
`pipeline:awaiting-plan-approval`, append `plan_approval_requested`, and stop. Otherwise append
`planned` and create the first stage job.

Never write code in this skill, and never let the plan grow past what the task needs — an
unnecessary refactor in a plan becomes an unnecessary refactor in the diff.
