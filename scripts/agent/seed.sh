#!/usr/bin/env bash
# There is nothing to seed.
#
# The kit's stages call this to get a demo user and demo data before a QA run or
# a screenshot. This app has neither: no server, no database, no accounts. Every
# child, session and recording lives in the browser's IndexedDB on the device
# that made it, so demo data can only be created by driving the UI — which is
# what the visual-verify walkthroughs do.
#
# Exits 0 so a stage that calls it unconditionally is not blocked by a repo that
# genuinely has no seed step.
set -euo pipefail

cat <<'TXT'
seed: nothing to do.

  word-record has no backend. Data (children, sessions, recordings) is created
  in the browser and stored in IndexedDB under the origin serving site/.

  To get a populated app for a screenshot or a walkthrough:
    python3 -m http.server 8000 -d site
    open http://localhost:8000 and add a child and a session in the UI.

  Clearing the browser's site data is how you reset it.
TXT
