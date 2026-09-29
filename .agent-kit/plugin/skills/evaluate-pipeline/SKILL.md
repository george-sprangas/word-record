---
name: evaluate-pipeline
description: Compute the week's delivery and capacity KPIs, trace the movements to causes, and open one evidence-backed PR against the kit. Use for the weekly evaluation and after an incident worth learning from.
user-invocable: true
argument-hint: "[--days 7] [--project <key>] [--dry-run]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, mcp__github__search_issues, mcp__github__list_issues, mcp__github__issue_read, mcp__github__get_file_contents, mcp__github__create_branch, mcp__github__push_files, mcp__github__create_pull_request
---

# Evaluate the pipeline

## 1. The numbers first

```bash
curl -sS -H "Authorization: Bearer ${AGENTKIT_PROJECT_TOKEN:-$AGENTKIT_POOL_TOKEN}" \
  "$AGENTKIT_HUB_URL/api/kpis?days=7&project=<project>" | python3 -m json.tool
```

The project's token, or the pool's where the environment has no project token (P9). A pool token
must name the project, which must be one that uses the pool; a project token may leave it out.

`current`, `previous` and `deltas`. A measure that reads `null` could not be computed honestly —
a window with no deploys has no rollback rate — and `null` is never to be reported as zero or as
an improvement.

The same numbers are on the Hub's evaluation page. If your report and that page disagree, one of
them is a bug; find out which before writing anything.

## 2. Did last week's change do what it said?

Read the previous `EVALUATION-*.md`. Each change named a KPI and made a prediction. Check it and
say so plainly, including when the answer is no. A change that did not deliver is a candidate for
reverting — and the willingness to write that down is what stops this from becoming a weekly
essay about how well things are going.

## 3. From movement to cause

For each KPI that moved more than noise, read the tasks behind it — the timelines, the review
findings, the QA verdicts, the human comments. Dispatch `explore` subagents for the reading, one
question each, rather than reading everything yourself.

The distinction that matters: a Reviewer raising three rounds of findings on a task whose
acceptance criteria were ambiguous is an **Intake** problem. Fixing the Reviewer would make it
quieter and worse.

## 4. Change one or two things

Prefer the smallest reversible change. Candidates, roughly in order of how often they are the
real answer:

| Symptom | Usually |
|---|---|
| many review rounds on few tasks | acceptance criteria, i.e. Intake |
| QA failing on things review passed | the verification gate is too narrow |
| estimates wrong by >2x | `capacity/estimate.py` defaults, or a stage doing more than its name |
| jobs deferred for hours at P1 | reserves in `pools.yml`, or fair share |
| limit hits on one pool | scheduling into the wrong window, not a bigger plan |
| incidents per deploy rising | the smoke test does not touch what broke |

## 5. Prove it

```bash
python -m unittest discover -s tests
cd hub && python manage.py test tests
claude plugin eval ./evals --filter <the cases your change touches>
```

Put the before/after in the PR. A prompt change with no eval delta is a preference; ship it if you
believe in it, but label it as one.

## 6. Write it up, open the PR, stop

`EVALUATION-<date>.md`: the KPI table with deltas, what changed and why, what you rejected and
why, and each change's prediction for next week. Then one PR against `agent-kit`.

`pools.yml` proposals go in their own section, marked as requiring a person. How someone's
subscription is spent is their decision, and the fact that you can compute a better split does
not make it yours.

## Rules

- One PR. A week with five changes cannot attribute next week's delta to any of them.
- Never merge it yourself.
- Never touch the human gates — plan approval, production approval — in any direction.
- Never report a number you did not compute, or a delta against a window where the number did not
  exist.
- The week happened as it is recorded. Do not tidy a ledger to make a graph nicer.
