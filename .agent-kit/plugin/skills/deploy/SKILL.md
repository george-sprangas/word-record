---
name: deploy
description: Ship an approved task — merge, deploy to QA, smoke, hold for the human's production approval, then watch the rollout and roll back if it degrades. Use for the deploy stage and for every watch-window wake.
user-invocable: true
argument-hint: "qa <task-id> | prod <task-id> | watch <task-id> | rollback <task-id>"
allowed-tools: Read, Write, Bash, Grep, Glob, mcp__github__pull_request_read, mcp__github__merge_pull_request, mcp__github__actions_run_trigger, mcp__github__actions_get, mcp__github__actions_list, mcp__github__get_job_logs, mcp__github__issue_write, mcp__github__add_issue_comment, mcp__Claude_Code_Remote__send_later
---

# Deploy a task

Two things make this safe, and both are outside this session: the `production` GitHub Environment
holds a required reviewer and the deploy credentials, and the deploy script refuses to migrate
traffic to a revision that has not answered its own health URL. This skill's job is to use them
correctly and to write down what happened.

## `qa <task-id>`

1. **Preconditions.** `plugin/scripts/pipeline_state.py --task <task-id> --next` must say
   `handoff`. Then check the PR directly: review approved, every required check green on the head,
   mergeable. Print which precondition failed and stop; never merge past one.
2. **Merge** (squash). Record the merge commit sha — it is the image tag for both environments.
3. **Trigger** `deploy.yml` with `env=qa`, `image_tag=<sha>`, `task=<task-id>`, and follow the run:

   ```bash
   # the workflow's own steps run scripts/deploy/deploy_cloud_run.sh and smoke.sh
   ```

   On failure, read the failing job's log rather than inferring from the conclusion. A failure
   before traffic migration means the old revision is still serving — say so explicitly, because
   "the deploy failed" and "the service is down" are very different sentences.
4. **Confirm the revision.** `curl <qa-url><health_path>` and check `revision` equals what the
   deploy reported. Anything else means you smoked a revision you did not deploy.
5. **Write `deploy.md`** and append `deployed` with `env: qa` and the revision.
6. **Hold**: set `pending-final-review-and-deployment`, and post the QA URL, a one-paragraph diff
   summary and the QA screenshots on the issue. This is the message a person acts on, so it says
   what changed and what to click, not that a workflow succeeded.

## `prod <task-id>`

Only after a person approved the production environment run.

1. Trigger `deploy.yml` with `env=prod` and **the same `image_tag`**. Promotion re-tags the image
   QA ran; if you find yourself passing a different sha, stop — that is a rebuild, and it means
   production would run bytes nobody tested.
2. The run waits for the environment approval. Waiting is the normal state; report it and stop
   rather than polling a reviewer.
3. After it completes: verify the health revision, append `deployed` with `env: prod`, then start
   the watch window with `send_later` at `deploy.watch.check_every_min`.

## `watch <task-id>`

One wake of the watch window. Read `deploy.md` for the current and previous revision, then compare
the window since the deploy against the same hour on the previous `deploy.watch.baseline_days`
days:

- 5xx rate against `auto_rollback.error_rate_5xx`
- p95 latency against `auto_rollback.p95_latency_ms`
- container restarts, and error signatures that did not appear on the previous revision

Any threshold tripped → `rollback` immediately. Nothing tripped and the window is over → append the
final line to `deploy.md`, set the task `done`, and stop re-arming. Nothing tripped and time
remains → re-arm with `send_later` and say nothing else. A quiet watch wake produces no comment,
no notification and no ledger noise.

## `rollback <task-id>`

Trigger `rollback.yml` with `env=prod`, `revision=<the previous revision>`, `task`, and `reason`.

It is a separate workflow from `deploy.yml` on purpose. Deploying new code to production needs the
human approval because it puts something untested in front of users; sending traffic back to the
revision users had ten minutes ago does not, and a rollback that waits for someone to wake up is
not a rollback. So `production-rollback` carries the credentials and no reviewer, and the workflow
can only move traffic between revisions that already exist — it cannot build or deploy.

Then, in this order: append `rollback` to the timeline, open an `incident:` issue linking the task,
both revisions and the evidence that tripped the threshold, and notify. Traffic moves first — the
writing can happen while the service is healthy again.

## Rules

- Never run `gcloud` against production from this session, rollback included. Everything that
  touches production traffic runs in CI, where the credentials live; a PreToolUse hook blocks it
  anyway, and working around that block is never the right move.
- Never deploy to production without an approved environment run, and never describe a pending
  approval as an approval.
- Never edit application code from this skill. A revision that fails is a task for the pipeline.
- A deploy that fails before traffic migration is not an outage; say which of the two it was.
