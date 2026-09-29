#!/usr/bin/env bash
# The verification gate: one command, one exit code.
#
# This repository has no test runner, because it has no build step and no
# dependencies — adding either is a decision for its owner, not for the gate.
# What the gate can prove without them, it proves: every file that ships parses,
# every asset the page asks for exists, and the pipeline's own YAML is valid.
# A stage may not end with this red.
set -uo pipefail

cd "$(dirname "$0")/../.."

fail=0
step() { printf '\n== %s\n' "$1"; }
bad() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }

step "1. JavaScript parses (node --check)"
while IFS= read -r js; do
  if node --check "$js" >/dev/null 2>&1; then
    echo "  ok   $js"
  else
    node --check "$js" 2>&1 | sed 's/^/       /'
    bad "$js does not parse"
  fi
done < <(find site -name '*.js' -type f | sort)

step "2. Shell scripts parse (bash -n)"
while IFS= read -r sh; do
  if bash -n "$sh" 2>/dev/null; then
    echo "  ok   $sh"
  else
    bash -n "$sh" 2>&1 | sed 's/^/       /'
    bad "$sh does not parse"
  fi
done < <(find scripts -name '*.sh' -type f | sort)

step "3. JSON and the web manifest parse"
while IFS= read -r json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$json" 2>/dev/null; then
    echo "  ok   $json"
  else
    python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$json" 2>&1 | tail -1 | sed 's/^/       /'
    bad "$json does not parse"
  fi
done < <(find site .claude \( -name '*.json' -o -name '*.webmanifest' \) 2>/dev/null | sort)

step "4. Every asset the app asks for exists"
if python3 - <<'PY'
import json, pathlib, re, sys

site = pathlib.Path("site")
missing = []

html = (site / "index.html").read_text(encoding="utf-8")
for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
    if ref.startswith(("http://", "https://", "data:", "#", "mailto:")):
        continue
    target = (site / ref.lstrip("./")).resolve()
    if not target.is_file():
        missing.append(f"site/index.html references {ref}")

manifest = json.loads((site / "manifest.webmanifest").read_text(encoding="utf-8"))
for icon in manifest.get("icons", []):
    src = icon.get("src", "")
    if not (site / src.lstrip("./")).is_file():
        missing.append(f"manifest.webmanifest references {src}")

if not (site / ".nojekyll").is_file():
    missing.append("site/.nojekyll is missing (Pages would hide files starting with _)")

if not re.search(r"^const APP_VERSION = '[^']+';", (site / "assets/app.js").read_text(encoding="utf-8"), re.M):
    missing.append("site/assets/app.js no longer declares APP_VERSION")

for line in missing:
    print(f"       {line}")
sys.exit(1 if missing else 0)
PY
then
  echo "  ok   index.html, manifest icons, .nojekyll, APP_VERSION"
else
  bad "the app references something that is not in the checkout"
fi

step "5. Pipeline YAML parses"
if python3 -c "import yaml" >/dev/null 2>&1; then
  while IFS= read -r yml; do
    if python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$yml" 2>/dev/null; then
      echo "  ok   $yml"
    else
      python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" "$yml" 2>&1 | tail -3 | sed 's/^/       /'
      bad "$yml does not parse"
    fi
  done < <(find pipeline.yml .github -name '*.yml' 2>/dev/null | sort)
else
  echo "  skip pyyaml is not installed (pip install pyyaml)"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "verify: FAILED"
  exit 1
fi
echo "verify: ok"
