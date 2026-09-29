#!/usr/bin/env bash
# Full QA: the gate, plus the app actually served over HTTP.
#
# Writes qa-result.json (one entry per check) for the QA stage to read. It never
# touches the published site: everything runs against a local server on a port
# of its own.
#
# What it cannot do is press buttons — the microphone, dictation and IndexedDB
# need a real browser, and this repository has no browser automation (adding it
# means adding a package manager, which is its owner's decision). Those criteria
# are proved by the visual-verify skill or by hand, and qa.md must say which.
set -uo pipefail

cd "$(dirname "$0")/../.."

PORT="${QA_PORT:-8899}"
BASE="http://127.0.0.1:${PORT}"
RESULT="qa-result.json"
server_pid=""

results=()
record() { # $1 = check, $2 = pass|fail|skip, $3 = note
  results+=("$(python3 -c 'import json,sys; print(json.dumps({"check": sys.argv[1], "result": sys.argv[2], "note": sys.argv[3]}))' "$1" "$2" "$3")")
  printf '%-28s %-5s %s\n' "$1" "$2" "$3"
}

cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
  python3 -c '
import json, sys
entries = [json.loads(line) for line in sys.argv[1:] if line]
print(json.dumps({"checks": entries,
                  "failures": sum(1 for e in entries if e["result"] == "fail")}, indent=2))
' "${results[@]:-}" > "$RESULT"
}
trap cleanup EXIT

echo "== verification gate"
if gate_output="$(bash scripts/agent/verify.sh 2>&1)"; then
  record "verify gate" pass "$(printf '%s' "$gate_output" | tail -1)"
else
  printf '%s\n' "$gate_output" | tail -30
  record "verify gate" fail "see the last 30 lines above"
fi

echo
echo "== serving site/ on ${BASE}"
python3 -m http.server "$PORT" -d site --bind 127.0.0.1 >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 1 20); do
  curl -sf "${BASE}/index.html" >/dev/null 2>&1 && break
  sleep 0.5
done

http_get() { curl -sS -o "$2" -w '%{http_code}' "$1" 2>/dev/null; }

tmp="$(mktemp -d)"
for path in /index.html /assets/app.js /assets/app.css /manifest.webmanifest /icons/icon-192.png; do
  code="$(http_get "${BASE}${path}" "${tmp}/body")"
  if [ "$code" = "200" ]; then
    record "GET ${path}" pass "200, $(wc -c <"${tmp}/body" | tr -d ' ') bytes"
  else
    record "GET ${path}" fail "HTTP ${code}"
  fi
done

if curl -sf "${BASE}/index.html" | grep -q 'id="view"'; then
  record "app shell present" pass 'index.html carries id="view"'
else
  record "app shell present" fail 'index.html no longer carries id="view"'
fi

version="$(curl -sf "${BASE}/assets/app.js" | sed -n "s/^const APP_VERSION = '\([^']*\)';/\1/p" | head -1)"
if [ -n "$version" ]; then
  record "app version" pass "APP_VERSION ${version}"
else
  record "app version" fail "APP_VERSION is not declared in the served app.js"
fi

if curl -sf "${BASE}/manifest.webmanifest" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  record "manifest served" pass "parses as JSON over HTTP"
else
  record "manifest served" fail "the served manifest does not parse"
fi

record "browser walkthrough" skip "no browser automation in this repo; prove UI criteria with visual-verify or by hand"

rm -rf "$tmp"

echo
failures="$(printf '%s\n' "${results[@]}" | grep -c '"result": "fail"')"
echo "qa: ${failures} failure(s); full result in ${RESULT}"
[ "$failures" -eq 0 ]
