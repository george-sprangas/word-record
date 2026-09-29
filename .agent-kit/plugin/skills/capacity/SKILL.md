---
name: capacity
description: Show what subscription and API capacity the pipeline has left, what is scheduled next, and what is deferred and why — and record a usage snapshot so the estimate stays honest. Use before dispatching heavy work, when something is waiting, or when asked why a task has not started.
user-invocable: true
argument-hint: "[sync | plan | why <task-id>]"
allowed-tools: Read, Write, Bash, Grep
---

# Capacity

Subscription usage is windowed — a rolling five-hour window and a weekly one,
shared with the human's own sessions and split further per model family. The
pipeline treats that as a resource to spend deliberately rather than a limit to
discover by hitting it.

The Hub owns the numbers. Talk to it with the project's token, or the pool's where the
environment carries no project token — since P9 one environment serves every repository on an
account, and the Hub accepts the pool token for the projects that list that pool:

```bash
: "${AGENTKIT_HUB_URL:?set in the repo's environment}"
token="${AGENTKIT_PROJECT_TOKEN:-${AGENTKIT_POOL_TOKEN:-}}"
: "${token:?neither AGENTKIT_PROJECT_TOKEN nor AGENTKIT_POOL_TOKEN is set in this environment}"
auth=(-H "Authorization: Bearer $token")
```

Without a Hub configured (phase P0 repos), answer from
`docs/pipeline/capacity/<pool>.jsonl` instead and say that the numbers are local.

## `/agent-kit:capacity` — where we stand

```bash
curl -sS "${auth[@]}" "$AGENTKIT_HUB_URL/api/capacity"
```

Report one row per pool, and nothing else unless it matters:

| pool | 5h window | weekly | families | resets | running | queued |
|---|---|---|---|---|---|---|
| max-george | 41% used | 63% used | opus 55% · sonnet 22% | 15:45 | 1 | 3 |

Then say, in one line each: what is scheduled in the next 24 hours, what is
deferred and why, and any pool that will run out before its reset. If
`snapshot_is_stale` is true, say so — everything below it is inference from
limit hits alone.

## `/agent-kit:capacity sync` — recalibrate

There is no API for subscription quota, so the honest number comes from a human:

1. Ask them to run `/usage` in an interactive session **on that account** and
   paste the plan bars.
2. Read off the session percentage, the weekly percentage, the per-model rows
   and the reset time.
3. Post it:

```bash
curl -sS -X POST "${auth[@]}" -H "Content-Type: application/json" \
  "$AGENTKIT_HUB_URL/api/capacity/snapshot" \
  -d '{"pool":"max-george","session_pct":41,"weekly_pct":63,
       "families":{"opus":55,"sonnet":22},"reset_at":"2026-09-10T15:45:00Z"}'
```

A snapshot newer than 30 minutes overrides the derived estimate. One older than
a day means the estimate is running on limit hits alone; say that plainly.

## `/agent-kit:capacity plan` — what runs when

```bash
curl -sS "${auth[@]}" "$AGENTKIT_HUB_URL/api/schedule"          # add ?project=<key> to narrow it
```

With the pool token it lists every project that uses the pool; with a project token, that project.

Each job carries its class, its pool, the time it is scheduled for and the
reason it waits. Present it as a short list in time order. The rules behind it,
if someone asks:

- **P0** now, on whatever pool has capacity, reserves ignored; failing over to
  an API pool where the project allows it, which costs real money.
- **P1** the next slot that fits with the reserves intact.
- **P2** prefers the evening quiet window; in work hours only while the session
  window is under 40% used.
- **P3** quiet windows only, and never the last quarter of the weekly window.

The human's interactive reserve stays intact during work hours. The pipeline
exists to give them time back, not to lock them out of their own account.

## `/agent-kit:capacity why <task-id>`

Two lines: the class, what it is waiting for (window reset, quiet window, a
predecessor stage, a human gate), when it becomes feasible, and the one thing
that would change it — usually `run_now`.

## Recording a limit

When a session hits a usage limit, record it immediately. The reset time is the
most valuable number the pipeline can learn, and it is only on screen once.

```bash
curl -sS -X POST "${auth[@]}" -H "Content-Type: application/json" \
  "$AGENTKIT_HUB_URL/api/capacity/limit-hit" \
  -d '{"pool":"max-george","scope":"session","family":"opus",
       "reset_at":"2026-09-10T15:45:00Z","run_id":"run_...","task":"task-231",
       "reason":"executor round 1 interrupted"}'
```

The Hub requeues the interrupted job until the reset, narrows its estimate of
that window, and — for a P0 — considers failing over. Also append a `limit_hit`
event to the task's timeline so the branch's own history shows the interruption.
