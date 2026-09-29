# The pipeline ledger

Every Agent Kit stage that runs against this repository writes here, on the task's
own branch. The ledger is the pipeline's only memory: labels, PR text and anything
an agent remembers are derived from it.

```
docs/pipeline/
  README.md                 this file
  <task-id>/
    timeline.jsonl          append-only event log — the source of truth
    plan.md                 what the Planner decided, and why this way
    execution.md            what the Executor did, step by step, with gate results
    review.md               the Reviewer's findings, by severity, per round
    qa.md                   every check, every acceptance criterion, with evidence
    deploy.md               what was published, from which commit, and what happened after
    summary.json            what a person reads before shipping: headline, what changed
    screenshots/            before/after evidence for a UI change
```

Rules that keep it readable:

- **Append, never rewrite.** A wrong event is corrected by a later event, not by an
  edit. `timeline.jsonl` is written with the kit's `ledger_append.py`, which refuses
  invalid events.
- **One page per file, not a transcript.** The files are for the next stage: what
  changed, what was decided, what is still open.
- Scratch belongs in `.agentkit/` (gitignored), never here.
- The ledger is committed with the work it describes.

## Where the state actually lives

```bash
python3 .agent-kit/plugin/scripts/pipeline_state.py --task task-12 --status
python3 .agent-kit/plugin/scripts/pipeline_state.py --task task-12 --next \
  --size medium --review-rounds 2 --qa-rounds 2 --plan-approval large
```

The numbers come from `pipeline.yml` (`limits`). When the derived state and the
`pipeline:*` label on the issue disagree, the timeline is right and the label is
what needs fixing.

## Is this repository wired up?

```bash
python3 .agent-kit/plugin/scripts/doctor.py
```
