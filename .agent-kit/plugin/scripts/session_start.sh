#!/usr/bin/env bash
# SessionStart hook: tell the session what it is working on, and make the
# project's own bootstrap one command away.
#
# Bootstrap is NOT run here by default. At SessionStart there is no envelope
# yet, so the session's stage is unknown, and a cold bootstrap can outlive a
# hook timeout. `/agent-kit:pipeline run` runs it as its first step instead.
# Set AGENTKIT_BOOTSTRAP_ON_START=1 (cloud environments, CI) to run it here.
set -uo pipefail

cat >/dev/null 2>&1 || true   # drain the hook payload; nothing in it is needed

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$project_dir" 2>/dev/null || exit 0

emit() { # $1 = context text
  python3 -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": sys.argv[1],
}}))' "$1"
}

[ -f "$project_dir/pipeline.yml" ] || exit 0

read_key() { # $1 = top-level key, $2 = nested key (optional)
  python3 - "$project_dir/pipeline.yml" "$1" "${2:-}" <<'PY' 2>/dev/null
import re, sys
path, top, nested = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""
text = open(path, encoding="utf-8").read()
if nested:
    block = re.search(rf'^{re.escape(top)}:\s*$((?:\n[ \t]+.*|\n\s*)*)', text, re.M)
    if block:
        m = re.search(rf'^\s+{re.escape(nested)}:\s*(\S.*)$', block.group(1), re.M)
        print(m.group(1).strip().strip('"\'').split(" #")[0].strip() if m else "")
    else:
        print("")
else:
    m = re.search(rf'^{re.escape(top)}:\s*(\S.*)$', text, re.M)
    print(m.group(1).strip().strip('"\'').split(" #")[0].strip() if m else "")
PY
}

project="$(read_key project)"
bootstrap="$(read_key scripts bootstrap)"
verify="$(read_key scripts verify)"
qa="$(read_key scripts qa)"
[ -n "$bootstrap" ] || bootstrap="scripts/agent/bootstrap.sh"
[ -n "$verify" ] || verify="scripts/agent/verify.sh"
[ -n "$qa" ] || qa="scripts/agent/qa.sh"

lines="Agent Kit is installed in this repository (project: ${project:-unknown})."
lines="$lines
- Contract: pipeline.yml. Verification gate: bash $verify. Full QA: bash $qa. Bootstrap: bash $bootstrap."
lines="$lines
- Ledger: docs/pipeline/<task-id>/ on the task branch. Every stage ends with a ledger event and a PR status comment."
lines="$lines
- Run a dispatched stage with /agent-kit:pipeline run <envelope>. Check state with /agent-kit:pipeline status <task-id>."

envelope="$project_dir/.agentkit/envelope.json"
if [ -f "$envelope" ]; then
  summary="$(python3 -c '
import json, sys
try:
    e = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
print("- ACTIVE STAGE: {stage} round {round} of {task} on branch {branch} (run {run}).".format(
    stage=e.get("stage", "?"), round=e.get("round", "?"), task=e.get("task", "?"),
    branch=e.get("branch", "?"), run=e.get("run_id", "?")))' "$envelope" 2>/dev/null)"
  [ -n "$summary" ] && lines="$lines
$summary"
fi

if [ "${AGENTKIT_BOOTSTRAP_ON_START:-0}" = "1" ] && [ -f "$project_dir/$bootstrap" ]; then
  if out="$(bash "$bootstrap" 2>&1)"; then
    lines="$lines
- Bootstrap ran at session start and succeeded."
  else
    lines="$lines
- Bootstrap ran at session start and FAILED. Last lines:
$(printf '%s\n' "$out" | tail -15)"
  fi
elif [ -f "$project_dir/$bootstrap" ] && [ ! -d "$project_dir/.venv" ] && [ ! -d "$project_dir/venv" ]; then
  lines="$lines
- No virtualenv found: run bash $bootstrap before the first test run."
fi

emit "$lines"
exit 0
