#!/usr/bin/env bash
# Stop hook: an Executor stage may not end its turn while the repo's own
# verification gate fails.
#
# Runs only when an Agent Kit envelope declares stage=executor, so ordinary
# sessions and other stages are never delayed. Exit 2 blocks the stop and feeds
# stderr back to Claude as the reason; exit 0 lets the turn end.
set -uo pipefail

payload="$(cat)"
project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
envelope="$project_dir/.agentkit/envelope.json"

json_field() { # $1 = json text, $2 = key
  printf '%s' "$1" | python3 -c "
import json,sys
try:
    print((json.load(sys.stdin) or {}).get(sys.argv[1], '') or '')
except Exception:
    print('')
" "$2" 2>/dev/null
}

# Never loop: if this hook is already what caused the last turn, let it stop.
if [ "$(json_field "$payload" stop_hook_active)" = "True" ]; then exit 0; fi

[ -f "$envelope" ] || exit 0
stage="$(json_field "$(cat "$envelope")" stage)"
[ "$stage" = "executor" ] || exit 0

# Resolve the repo's verify script from pipeline.yml, defaulting to the
# conventional path the Initializer writes.
#
# The heredoc lives in a function rather than directly inside the command
# substitution below: bash 3.2, which is what macOS ships as /bin/bash, cannot
# parse a heredoc inside $( ) and fails the whole script with a syntax error.
verify_path_from_config() { # $1 = path to pipeline.yml
  python3 - "$1" <<'PYEOF'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'^\s+verify:\s*(\S+)', text, re.M)
print(m.group(1).strip('"\'') if m else "")
PYEOF
}

verify="scripts/agent/verify.sh"
if [ -f "$project_dir/pipeline.yml" ]; then
  from_cfg="$(verify_path_from_config "$project_dir/pipeline.yml" 2>/dev/null)"
  [ -n "$from_cfg" ] && verify="$from_cfg"
fi

if [ ! -x "$project_dir/$verify" ] && [ ! -f "$project_dir/$verify" ]; then
  # No gate configured in this repo: nothing to enforce.
  exit 0
fi

marker="$project_dir/.agentkit/verify-ok"
# Skip the re-run when the working tree has not changed since the last pass.
tree_hash="$(git -C "$project_dir" status --porcelain=v1 2>/dev/null | sha1sum | cut -d' ' -f1)"
if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$tree_hash" ]; then exit 0; fi

output="$(cd "$project_dir" && bash "$verify" 2>&1)"
status=$?

if [ $status -ne 0 ]; then
  {
    echo "Agent Kit verify gate FAILED (exit $status) — the stage cannot end with the gate red."
    echo "Fix what the gate reports, then finish. Command: bash $verify"
    echo "--- last 60 lines ---"
    printf '%s\n' "$output" | tail -60
  } >&2
  exit 2
fi

mkdir -p "$project_dir/.agentkit"
printf '%s' "$tree_hash" > "$marker"
exit 0
