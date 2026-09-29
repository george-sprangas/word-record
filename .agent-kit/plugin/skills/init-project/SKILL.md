---
name: init-project
description: Onboard a repository to Agent Kit — detect the stack, audit it against the golden templates, apply them on a branch, run the doctor, and open a PR. Use once per repository, and again when the templates move on.
user-invocable: true
argument-hint: "[--audit-only] [--repo <owner/name>]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, mcp__github__get_file_contents, mcp__github__create_branch, mcp__github__push_files, mcp__github__create_pull_request, mcp__github__update_pull_request, mcp__github__add_issue_comment
---

# Onboard a repository

The repository works today and somebody depends on it. You are adding a contract, not taking over:
propose, patch, and put every deviation in the PR where its owner can argue with it.

## 1. Detect

Answer these before writing anything. Each one changes files you are about to generate, and a
wrong guess propagates.

| Question | Where to look | What it changes |
|---|---|---|
| Vite or CRA? | `frontend/vite.config.*` vs `react-scripts` in `package.json` | `dist/` vs `build/` in the Dockerfile, `tsc` vs nothing in verify |
| Where do apps live? | `manage.py`, `INSTALLED_APPS` | `apps_root` in `pipeline.yml`, the `COPY` lines |
| WSGI module? | `wsgi.py` | the gunicorn command |
| Health path already routed? | `grep -rn "health\|healthz" **/urls.py` | `deploy.health_path`, whether the snippet is an add or a patch |
| Test settings for a sandbox? | a sqlite shim, `SKIP_*` env flags | whether `verify.sh` can run without Postgres |
| How does a contributor get a database? | a compose file, a Makefile target, a README line | whether `docker-compose.yml` is an add or already handled |
| What deploys today? | `deploy*.sh`, `cloudbuild.yaml`, existing workflows | whether `deploy.yml` is new or a replacement |
| Is the API base baked in at build time? | `update_api_url.sh`, `VITE_API_URL` in the Dockerfile | whether build-once-promote needs a code change first |

Write the answers into the audit. That last one matters more than it looks: if the frontend
compiles its API URL at build time, QA and production cannot share an image, and the deploy
templates' central promise does not hold until it is fixed.

## 2. Audit

For every template, one of three verdicts:

- **missing** → add it;
- **present and equivalent** → leave it, and say so;
- **present and different** → patch it, or leave it and record why.

A repo that already has a good `ci.yml` does not need yours. Replacing working things is how an
onboarding PR becomes unreviewable and gets closed.

## 3. Propose, then apply

Onboarding is `size: large`, so a person approves the plan before it takes effect. Where that
approval happens depends on how you were started:

- **By hand** (`/agent-kit:init-project` in a session): post the audit on the issue and wait for
  approval, then apply.
- **As a pipeline `init` stage** (you were handed an envelope whose `stage` is `init` — the Hub's
  **Run the Initializer** button): do not post the audit on an issue and wait. Nobody is watching
  the issue for it, and the session ends with your turn, so a wait is a stage that never
  finishes. Apply on the envelope's `branch`, put the audit at the top of the PR body, and let
  the PR review be the approval: nothing you write takes effect until a person merges it. Then
  leave one comment on the onboarding issue — its number is the task's (`task-12` is issue 12) —
  that points at the PR, and nothing else there. If a PR from that branch is already open, a
  previous press got this far: update the branch and the PR body rather than opening a second.

Then, on a branch:

```bash
# every file that does not exist yet
cp templates/repo/pipeline.yml.tmpl pipeline.yml     # then fill every {{placeholder}}
cp -r templates/repo/scripts/agent scripts/
cp -r templates/repo/docs/pipeline docs/
cp templates/repo/.github/workflows/*.yml .github/workflows/
cp templates/repo/.claude/rules/*.md .claude/rules/          # process + engineering rules
cp templates/repo/docker-compose.yml .                        # local Postgres, if none exists
cat templates/repo/gitignore-additions.txt >> .gitignore
```

Files that already exist are **patched**: `.gitignore` gains lines, `.claude/settings.json` is
merged key by key, an existing `CLAUDE.md` gains a section rather than being rewritten.

Fill in the placeholders from the detection table. `pipeline.yml` is the contract — a value left
as `{{...}}` is a value the pipeline will not guess, and the doctor fails on it.

## 4. Prove it

```bash
bash scripts/agent/bootstrap.sh
bash scripts/agent/verify.sh
python3 "$CLAUDE_PLUGIN_ROOT/scripts/doctor.py" --json
```

Red doctor, not ready — whatever the diff looks like. Fix what it names.

## 5. Open the PR

The body carries: the audit (as a pipeline stage), the doctor report, the deviation list with
reasons, and **what a person still has to do by hand** before a task can run here. Say plainly
that the pipeline cannot run until those exist, so nobody merges this and wonders why nothing
happens.

With the Hub's GitHub App installed, most of the wiring is done from the Hub's `/setup/` page:
the labels, the kit PR, the Actions variables, the Routine trigger. What stays by hand is the
two gates, which the App can check and deliberately cannot change: branch protection on the
default branch (require the CI check and a review), and the `production` environment with a
required reviewer. A repository that deploys through the kit also needs the deploy wiring in
`docs/06_WIRING.md` §5 — the App has no permission to write secrets or environments. Without a
Hub App, list everything in `docs/06_WIRING.md` §4–5.

## Rules

- Never push to `main`; never merge your own PR.
- Never run a deploy script or anything that changes infrastructure.
- Never write a secret, including into a workflow "for now".
- No reformatting, no dependency bumps, no drive-by fixes. Every extra line is a reason not to
  read the diff.
- If the repo needs a code change before the templates can work — a build-time API URL is the
  usual one — say so in the audit and propose it as its own task. Do not smuggle it in here.
