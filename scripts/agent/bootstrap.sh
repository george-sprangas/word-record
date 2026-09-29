#!/usr/bin/env bash
# Make this checkout ready to work in.
#
# There is nothing to install. The app under site/ has no dependencies, no
# bundler and no package manager: the files committed are the files served. So
# this script only proves that the two interpreters the other scripts use are
# present, and says what is missing when they are not — which is the useful
# half of a bootstrap anyway.
set -euo pipefail

cd "$(dirname "$0")/../.."

missing=0

need() { # $1 = command, $2 = what it is for
  if command -v "$1" >/dev/null 2>&1; then
    printf '  ok   %-8s %s\n' "$1" "$("$1" --version 2>&1 | head -1)"
  else
    printf '  MISS %-8s needed for: %s\n' "$1" "$2"
    missing=1
  fi
}

echo "bootstrap: word-record (static web app, no dependencies to install)"
need node "the syntax gate in scripts/agent/verify.sh"
need python3 "the local server and the asset checks"

if ! python3 -c "import yaml" >/dev/null 2>&1; then
  echo "  note pyyaml is not installed: the YAML checks in verify.sh will be skipped."
  echo "       pip install pyyaml  (the pipeline's doctor.py needs it too)"
fi

if [ "$missing" -ne 0 ]; then
  echo "bootstrap: FAILED — install what is marked MISS above." >&2
  exit 1
fi

echo "bootstrap: ready. Run the app with: python3 -m http.server 8000 -d site"
