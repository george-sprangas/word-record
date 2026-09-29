---
name: review
description: Review a pipeline PR against the plan, the repo's conventions, its invariants and security, then post the GitHub review and write review.md. Use for the review stage of an Agent Kit task.
user-invocable: true
argument-hint: "<task-id>"
allowed-tools: Read, Bash, Grep, Glob, Write, Agent, mcp__github__pull_request_read, mcp__github__pull_request_review_write, mcp__github__add_comment_to_pending_review, mcp__github__list_commits
---

# Review a pipeline change

## Order of work

1. **Re-run the gate.** `bash scripts/agent/verify.sh` on the branch. `execution.md` claiming it
   passed is not evidence. A stage that skipped the gate is a high finding by itself.
2. **Check every invariant** in `pipeline.yml.invariants` literally. They are written as commands
   or conditions for exactly this reason. Example from the reference repo:
   `git status --porcelain apps/crm/` must be empty. A breach is always blocking.
3. **Read the diff for correctness.** Ask what input makes it wrong: off-by-one, unhandled null,
   N+1 query, missing transaction or `select_for_update`, tenant/org scoping missing on a query,
   a check-then-write race, an irreversible migration, an except that swallows, a default that
   changes existing behaviour.
4. **Security.** Run `/security-review` on the diff. Then check by hand: authorization on every
   new endpoint, org scoping on every new queryset, no secret in code, no user input reaching a
   shell or a raw query, no new public route by accident, no permission widened without the task
   asking for it.
5. **Conventions.** Does it match how this repo already does it? Use `explore` subagents to find
   the house pattern rather than assuming. A correct change in a foreign style is a medium
   finding, because the next person pays for it.
6. **Plan and scope.** Every step done or explicitly deferred; every acceptance criterion met;
   nothing outside `scope.include`; no unrelated refactor riding along.

## Findings

| Severity | Meaning | Blocking |
|---|---|---|
| critical | data loss, security hole, breaks production | yes |
| high | wrong behaviour on a realistic input, invariant breach, missing authorization | yes |
| medium | works but wrong here: foreign pattern, missing test, performance trap | no |
| low | naming, dead code, a comment that is now false | no |

Each finding: `file:line`, what is wrong, why it matters, and what to do instead. Write the fix
concretely enough that the Executor does not have to guess.

## `review.md`

```markdown
# Review — task-231, round 1
Verdict: **changes requested** · gate: re-run, passed · invariants: 2/2 checked, ok

| id | sev | file:line | finding | status |
|----|-----|-----------|---------|--------|
| R1 | high | apps/payables/views/export.py:41 | queryset is not org-scoped, any member of any org can export by id | open |
| R2 | high | apps/payables/serializers.py:88 | N+1: items fetched per row, use prefetch_related("items") | open |
| R3 | medium | frontend/src/pages/payables/Detail.tsx:120 | fetch call bypasses the api client used everywhere else | open |

## Notes
Anything that is context rather than a finding — a decision you agree with, a risk to watch.
```

Carry every previous round's findings forward with their status (`fixed`, `open`, `deferred —
reason`), so round 3 can see what round 1 said.

## Posting

Inline comments on the lines that matter, one summary comment with the verdict and the table,
`REQUEST_CHANGES` when anything blocking is open, `APPROVE` when nothing is. Then append the
`stage_finished` event with the ledger skill.

Do not edit the code, do not approve with a blocking finding open, and do not pad the review with
opinions the repo has no rule about.
