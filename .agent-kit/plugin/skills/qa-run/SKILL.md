---
name: qa-run
description: Run the repository's full QA script against a PR head, check the acceptance criteria against the running app, and write qa.md with an unambiguous verdict. Use for the QA stage of an Agent Kit task.
user-invocable: true
argument-hint: "<task-id>"
allowed-tools: Read, Write, Bash, Grep, Glob, Agent, mcp__github__pull_request_read, mcp__github__add_issue_comment, mcp__github__get_job_logs
---

# QA a pipeline change

## Run the script

```bash
bash scripts/agent/qa.sh          # writes qa-result.json
```

It runs, and records a result for each of: backend tests, `manage.py check --deploy`,
`makemigrations --check --dry-run`, type check, lint, production frontend build, container build,
Playwright smoke. Every check's result goes in `qa.md`, including the ones that passed — a report
that only lists failures cannot be distinguished from a report where nothing ran.

Where the sandbox cannot build a container, run that check in CI instead and read the job log
(`mcp__github__get_job_logs`), and say in `qa.md` which checks ran where.

## Check the acceptance criteria yourself

A green suite does not prove the task was done. Take each criterion from `task.md` and prove it:

- an endpoint criterion → call it, for both the allowed and the denied case, and paste the status
  codes;
- a UI criterion → see it work: a walkthrough clip with a Hub (checked through its final still),
  the screenshots without one (`visual-verify`);
- a test criterion → name the test that now exists and show it running.

Record met / not met with the evidence. An unmet criterion is a failed QA even when every check
is green. The same list goes into `docs/pipeline/<task>/summary.json` as `criteria`
(`{"text": …, "met": true, "evidence": "walkthrough 1; test_…"}`), keeping what the Executor
wrote there — it is what a person reads before shipping (the pipeline skill, step 8).

## Flakiness

**A failure counts only when it reproduces.** Run the failing check a second time.

- Fails twice → a real failure. Report it with the actual error and your read on the cause.
- Passes on the retry → flaky. Report it as a finding, open an issue, and let the verdict stand
  on the rest. Never make a test pass by skipping or quarantining it.

## `qa.md`

```markdown
# QA — task-231, round 1
Verdict: **passed** · checks 8/8 · acceptance 3/3 · visual: before/after captured

| check | result | note |
|-------|--------|------|
| backend tests | pass | 412 tests, 0 failures |
| manage.py check --deploy | pass | |
| makemigrations --check | pass | No changes detected |
| tsc --noEmit | pass | |
| eslint (changed files) | pass | |
| frontend build | pass | 2.1 MB, WorkflowBuilder chunk split |
| docker build | pass | ran in CI, job 1234 |
| e2e smoke | pass | login + /payables + /payables/reconciliations |

## Acceptance
1. 200 for org members / 403 otherwise — met (curl: 200 as member, 403 as outsider)
2. Button disabled while loading — met (see after/desktop screenshot)
3. Backend tests for permissions and columns — met (test_export.py::test_permission_matrix)

## Visual evidence
With a Hub: the walkthroughs by label ("walkthrough 1: Undo a match"), uploaded to the run, and
any file that did not upload. Without one: before/after links.

## Findings
Anything worth the Executor's attention that did not fail the verdict.
```

Then append the `stage_finished` event.

You may write only `qa.md`, `qa-result.json`, `summary.json`, `screenshots/` and scratch under `.agentkit/`. Changing application code,
tests or configuration to make a check pass is a contradiction of the role.
