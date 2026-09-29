---
name: verify
description: Run the repository's verification gate and report the result in the ledger's format. Use after every implementation step, and whenever you need to prove the branch is green before claiming a stage is done.
user-invocable: true
allowed-tools: Read, Bash, Grep
---

# Verification gate

One command, one exit code: `bash $(pipeline.yml → scripts.verify)`. It is the contract between
the repo and the pipeline, so the pipeline never needs to know the stack.

For the reference projects it runs, in order and stopping at the first failure:

1. `python manage.py check`
2. `python manage.py makemigrations --check --dry-run` — must report "No changes detected"
3. `python manage.py test <apps touched by the branch>`
4. `npx tsc --noEmit` when the frontend changed
5. `eslint` on the changed frontend files

## Running it

```bash
bash scripts/agent/verify.sh
```

Run it from the project root, with the environment bootstrapped. It is fast enough to run after
every step; do that rather than saving it for the end, because a gate failure at step 6 that was
introduced in step 2 is expensive to unpick.

## Reporting it

Put a trimmed result in `execution.md` — the command, the outcome, and for a failure the last
30 lines that matter. Never paste hundreds of lines of test output into the ledger or the PR.

```markdown
### Step 3 — export endpoint
`bash scripts/agent/verify.sh` → ok (check, migrations clean, 47 tests, tsc, eslint)
```

## When it fails

The Stop hook will not let an executor stage end while the gate is red, and that is deliberate:
a red gate is the cheapest possible signal that something is wrong.

- Read the actual error before changing anything.
- Fix the cause, not the symptom. A failing assertion usually means the code is wrong, not the
  test.
- `makemigrations --check` failing means a model changed without a migration: generate it.
- If the failure is unrelated to your change and pre-existing on the base branch, prove that
  (run the gate on the merge base), record it as a finding, and continue — do not silently
  absorb someone else's breakage into your diff.

Never skip, disable or loosen a test to get the gate green. If a test is genuinely wrong, say so
in `execution.md` with the reasoning, and change it as a visible part of the diff.
