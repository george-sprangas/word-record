---
name: visual-verify
description: Prove a frontend change with Playwright — boots the app, logs in, captures the affected routes at desktop and mobile, before and after, and records a short walkthrough video per acceptance criterion. Uploads the evidence to the Hub when there is one; otherwise commits the screenshots and prints PR-ready links. Use after any change under the frontend source root, or when asked to screenshot or visually verify a UI change.
user-invocable: true
argument-hint: "<task-id> [routes]"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# Visual verification

A UI change that a reviewer has to check out the branch to see is a UI change that does not get
reviewed. This produces the evidence instead.

**Local dev stack only.** Never point it at QA or production: it logs in, and with a seeded user
it writes data.

## 1. Which routes

Look at the diff restricted to the frontend source root, and map changed components to routes
through `pipeline.yml.frontend.routes_map`:

- a page component → its own route;
- shared chrome (layout, sidebar, top bar, the api client, i18n) → one representative page;
- a sub-app's components → that sub-app's root route;
- the login screen → the login route.

Decide BEFORE/AFTER: a change to an existing page needs both; a brand new page is AFTER only.

## 2. Boot the stack

**Whose port is it?** Before starting anything, request `pipeline.yml.frontend.dev_url` and the
backend's health path. If they already answer *as this repository* (the health path is the one
`pipeline.yml` names, the app is this app), use them and start nothing. If they answer as a
different application — another project's dev server on the same machine — do not capture there,
do not log in there, and do not kill it: report the stage `blocked` with the port and what answered.
A screenshot of someone else's app proves nothing, and a login writes to their database.

```bash
bash scripts/agent/bootstrap.sh                    # deps + migrate, once
# The venv's own interpreter, not a bare `python`, and no environment-variable
# prefix: a headless stage cannot activate a venv, and every command is matched
# against the allow-list as written, so `DEBUG=1 python …` is a different
# command from `python …`. DEBUG comes from the repository's local settings;
# ensure_login_user.py refuses to run if it is off.
.venv/bin/python manage.py runserver 8000 --noreload &
until curl -sf "http://localhost:8000$(grep -m1 health_path pipeline.yml | cut -d: -f2- | tr -d ' \"')" >/dev/null; do sleep 2; done
# frontend: `npm start` for a CRA project, `npm run dev` for Vite
( cd frontend && npm start ) &
until curl -sf http://localhost:3000 >/dev/null; do sleep 3; done
```

Every command above is in the golden `.claude/settings.json` allow-list (`.venv/bin/python`,
`npm start`, `npm run dev`, `node`, `curl`, `sleep`, `kill`). A repository onboarded before
those rules existed denies this whole section, and the stage must say so as `blocked`.

## 3. A user to log in as

In order of preference:

1. the repo's own seed: `bash scripts/agent/seed.sh` (creates the demo org and user);
2. `VISUAL_VERIFY_USER` / `VISUAL_VERIFY_PASS` from the environment;
3. the fallback helper, which refuses to run unless `DEBUG` is on:

```bash
VV_USER=visual_verify VV_PASS=vv-local-dev-pass \
  .venv/bin/python "${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/ensure_login_user.py"
```

The helper makes a superuser and, when the repo provides `scripts/agent/vv_grants.py` with a
`grant(user)` function, calls it so per-app access flags are set by the repo rather than guessed
by the kit. Confirm the login works before capturing — a screenshot of a redirect to the login
page is the most common wasted run.

## 4. Capture

```bash
VV_USER=visual_verify VV_PASS=vv-local-dev-pass VV_LABEL=before \
  VV_PAGES="/payables,/payables/reconciliations" \
  node "${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/capture.js"
```

For BEFORE on an uncommitted diff, stash **only** the frontend source (`git stash push -u -- frontend/src`),
wait for the dev server to recompile, capture, then pop and wait again. The pathspec matters: a
bare stash sweeps up unrelated work. For BEFORE on committed branch work, capture from a
worktree at the merge base instead. If BEFORE is impractical, say so explicitly in `qa.md` —
AFTER-only is an acceptable fallback, silently skipping it is not.

Then AFTER with `VV_LABEL=after` and the same routes. When the envelope has `hub_url`, add
`VV_OUT_DIR=.agentkit/visual/<branch-slug>` to both: the stills go to the Hub (step 7), and a
file under `screenshots/` is one `git add` away from being committed.

Knobs (all environment variables): `VV_BASE_URL` (default `http://localhost:5173`), `VV_PAGES`,
`VV_LABEL`, `VV_OUT_DIR` (default `screenshots/<branch-slug>/`), `VV_VIEWPORTS` (default
`1280x800,375x812`), `VV_FULLPAGE=1`, `VV_LOGIN_PATH`, and the selector overrides
`VV_USER_SELECTOR`, `VV_PASS_SELECTOR`, `VV_SUBMIT_SELECTOR`. Video adds `VV_FLOW`, `VV_VIDEO`
and `VV_VIDEO_VIEWPORT` (step 5).

## 5. Walkthroughs on video

A still proves the page renders; a short clip proves the criterion works. For a UI change with a
Hub, write one flow per acceptance criterion the UI can show, in `.agentkit/walkthroughs.json` —
gitignored, and never committed:

```json
{"flows": [
  {"criterion": 1, "label": "Undo a match",
   "steps": [{"goto": "/payables/reconciliations"},
             {"click": "text=Undo"},
             {"waitFor": "text=Unmatched"}]}
]}
```

`criterion` is the criterion's number in `task.md`, counting from 1; `label` is the caption a
person sees. Steps: `goto` a path under `VV_BASE_URL` (never a URL — the same local-stack rule as
above), `click`, `hover` or `waitFor` a Playwright selector, `fill`, `press` or `select` a
`[selector, value]` pair, `pause` for milliseconds. End each flow on the state that proves the
criterion: the clip holds its last frame, and a still of that frame is what you will check.

```bash
VV_USER=visual_verify VV_PASS=vv-local-dev-pass VV_FLOW=.agentkit/walkthroughs.json \
  node "${CLAUDE_PLUGIN_ROOT}/skills/visual-verify/capture.js"
```

It logs in on a page of its own, so the login form stays out of the clips, then records one clip
per flow at `VV_VIDEO_VIEWPORT` (default `1280x800`; a person watches one size). Each clip goes
under `.agentkit/visual/<branch-slug>/` as `walkthrough__<n>__<label>__<viewport>.webm`, with a
still of its final frame beside it. `VV_VIDEO=1` without a flow file records one clip per route in
`VV_PAGES`. The script refuses to record video under `screenshots/`.

Every file the script writes, clip or still, is also printed as one JSON line —
`{"path": …, "phase": …, "criterion": …, "label": …, "ok": …}` — which is everything step 7
needs. A flow whose step failed keeps its clip, marked `"ok": false`, because it shows where the
flow stopped. That is a QA finding with evidence, not a recording to retry until it passes.

## 6. Look at the images

Open at least one AFTER image with the Read tool. Confirm it shows the change, that the page is
not a spinner, an error or the login form, and that nothing beside the change broke. A capture
you did not look at proves nothing. You cannot watch a clip, so check each one through the still
of its final frame, the `.png` beside it: it must show the state the criterion promises.

## 7. Upload, or commit and link

**With a Hub** (the envelope has `hub_url`), upload every file the capture printed — the clips,
their final stills, and the before/after stills — and commit none of them. One command per file,
with `--phase`, `--criterion` and `--label` taken from that file's JSON line:

```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/hub_events.py" media --run "$run_id" --phase walkthrough \
  --criterion 1 --label "Undo a match" \
  --file .agentkit/visual/<slug>/walkthrough__1__undo-a-match__1280x800.webm
"${CLAUDE_PLUGIN_ROOT}/scripts/hub_events.py" media --run "$run_id" --phase before \
  --label "/payables @ 1280x800" --file .agentkit/visual/<slug>/before__payables__1280x800.png
```

Media lives in the Hub and never in git (P9 D9.7): images committed to a task branch are
squash-merged into `main`, and video would grow every clone for ever. The Hub's task page plays
each clip beside the criterion it proves. It takes at most 40 files a run, 30 MB a clip and 8 MB
a still, and the helper checks each file before sending it. Like the other progress helpers it
never fails the stage: a file it did not upload is named on stderr, and `qa.md` says so.

**Without a Hub**, record no video — there is nowhere for it to go — and commit the stills as
before:

```bash
git add screenshots/<branch-slug>/ && git commit -m "<task-id>: visual verification screenshots"
```

Print raw links built from the origin remote, and say that they resolve once the branch is
pushed:

```markdown
**Before → After (desktop 1280×800)**
![before](https://github.com/<owner>/<repo>/blob/<branch>/screenshots/<slug>/before__payables__1280x800.png?raw=true)
![after](https://github.com/<owner>/<repo>/blob/<branch>/screenshots/<slug>/after__payables__1280x800.png?raw=true)
```

## 8. Clean up

Kill the servers you started with `kill %1 %2` (leave any that were already running), and remove a merge-base
worktree if you made one. Do not delete the seeded user; the helper is idempotent.

## Gotchas

- Auth state lives in the app, so log in through the real form rather than injecting a token.
- A route guard redirects an under-privileged user to their first allowed page: a screenshot of
  the wrong page means the login user lacks access, not that the route is broken.
- Non-English UI text is normal in these projects, not mojibake.
- `screenshots/` is intentionally tracked in git; Playwright's caches and reports are not. Video
  never goes there, and with a Hub nothing does: `.agentkit/` is the place for anything uploaded.
- A clip that opens on the login form means the app keeps its session per tab (sessionStorage):
  the script logs in again on the recorded page, and the clip shows it. That is expected.
