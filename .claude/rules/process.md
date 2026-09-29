# Process rules

How work moves through this repository. These bind every stage, and the Reviewer
checks them.

## One task, one branch, one PR

- A task is an issue. Its branch is `agent/task-<n>`, its ledger is
  `docs/pipeline/task-<n>/`, and its PR is opened as a draft by the Planner.
- Nothing reaches `main` except through that PR, reviewed by a person. No stage
  pushes to `main`, merges its own PR, or publishes the site.
- One stage per session. A stage that finds its own work already in the ledger
  stops and says so — a duplicate dispatch must be a no-op, not a second round.

## Write it down where the next stage will look

- Every stage ends with its markdown file (`plan.md`, `execution.md`, `review.md`,
  `qa.md`, `deploy.md`) and an event appended to `timeline.jsonl`.
- A page, not a transcript: what changed, what was decided, what is still open. The
  gate's output is trimmed to the command, the outcome, and the 30 lines that matter.
- The PR's status block is written by `pr_status.py` and by nothing else. Stages do
  not post summary comments; the reviewer's review is the only comment a stage makes.
- Scratch goes in `.agentkit/`, which is gitignored. Never under `docs/`.

## The gate is not optional

- `bash scripts/agent/verify.sh` must be green before a stage ends. Run it after
  each step, not once at the end.
- Never skip, loosen or delete a check to get it green. If a check is genuinely
  wrong, say so in `execution.md` with the reasoning and change it visibly in the diff.
- A failure that pre-exists on the base branch is proved on the merge base, recorded
  as a finding, and left alone — do not absorb someone else's breakage into this diff.

## Scope

- `pipeline.yml.scope` is the boundary; an envelope's scope narrows it and nothing
  widens it. `.agent-kit/` and `site/icons/` are out of bounds.
- `pipeline.yml`, `.claude/**` and `.github/workflows/**` are not edited from inside
  a task stage. Changing them is its own task on its own PR, so a person reviews the
  pipeline and the CI path deliberately.
- No reformatting, no dependency bumps, no drive-by fixes. Every extra line in the
  diff is a reason for someone not to read it. Spotted something else wrong? File it.

## Approval and gates

- `size: large` tasks, and anything touching storage, recording, dictation or the
  privacy copy, wait for a person to approve the plan.
- Publishing to production waits for the `production` environment's required
  reviewer. A pending approval is never described as an approval.
- Rollback does not wait: republishing a commit users already had needs no meeting.

## Secrets

Never write a secret anywhere — not in a workflow, not "for now", not in an example.
Workflows name secrets; a person sets them.
