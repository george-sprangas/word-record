# Plan — task-3: Sub-pages and correct navigation (refresh must not drop you on the homepage)

**Size: large.** It rewrites the navigation of every view in `site/assets/app.js` — a
`security_sensitive_paths` entry — and one step deliberately reaches the recording stop path
(`ensureStopped` → `stopRec`) from a new entry point, the browser's Back button. Between medium
and large, it is large, so the plan comes back to a person first.

Issue #3 gave no acceptance criteria, no scope and no size. All three are established below.

## What the task means here

The issue asks for "sub-pages and correct navigation" and flags a UI change. The app has no
tabs in the markup: `index.html` is one shell (`#top`, `#view`, `#sheetRoot`, `#toast`) and
`ui.view` (`'home' | 'child' | 'session'`) picks which of `viewHome()`, `viewChild()`,
`viewSession()` fills `#view`. "Tabs and pages" is the therapist's word for those three levels,
and the complaint is exact: `ui` is in-memory only, so `boot()` ends at `render()` with
`ui.view === 'home'` and a refresh mid-session lands back on the child list. The URL never
changes, so the Android/Safari Back button leaves the app instead of going up a level, and a
session cannot be reopened by link or by reload.

So this task is about making the three views addressable and the Back button correct. It is not
a visual redesign; see **Out of scope**.

## Approach

Add a small hash router to `app.js` and make it the only writer of `ui.view`, `ui.childId` and
`ui.sessionId`. Routes: `#/`, `#/child/<id>`, `#/session/<id>`. Every navigation becomes a route
change (`go()`), a `hashchange` listener resolves the route and renders, and `boot()` ends by
resolving `location.hash` instead of calling `render()` directly. The existing `render()`,
`renderKeep()`, `openSession()` and `ensureStopped()` are reused as they are — the router calls
them; it does not replace them.

**Hash, not the History API,** and this is the load-bearing decision: the site is published by
`pages.yml` as a project site at `https://george-sprangas.github.io/word-record/`, served
verbatim with no rewrite rule. `history.pushState('/word-record/session/ab12')` would look
right until the therapist refreshed, and then GitHub Pages would answer its own 404 — the same
bug we were asked to fix, one level worse. A `404.html` copy-of-index trick would make the URL
survive at the cost of a second copy of the shell and a flash of 404; not worth it. `hashchange`
needs no feature detection (it predates everything the app supports); `history.replaceState`
and `history.pushState` are feature-detected where they are used for entry hygiene, with the
plain `location.hash = …` assignment as the fallback.

**No storage change.** The URL is the persistence for "where am I"; IndexedDB keeps holding
`kv`/`audio` at version 1 with the same record shapes. Nothing about navigation is written to
the store, so no session on a therapist's phone is touched.

**The URL and the title stay anonymous.** Routes carry the opaque `uid()` id only — never a
child's name, never a word. `document.title` per route stays generic
(«Καρτέλα παιδιού · Λογοτετράδιο»), because a title goes into browser history and the app
switcher on a phone that is handed around in a session. An id is meaningless off the device that
made it, which is also why an unknown id must land on home rather than throw.

`ui.editMode` and `ui.activeItemId` stay out of the URL: the first is a transient mode (a reload
landing in read mode is the safer default), the second names the word the therapist is on, which
is exactly what should not be in a URL.

## Acceptance criteria (established here; QA checks against these)

1. Reload on a child card returns to that child card; reload inside a session returns to that
   session with its plan, progress and recordings intact.
2. The URL identifies the page — `#/`, `#/child/<id>`, `#/session/<id>` — and contains no child's
   name and no word. `document.title` changes per route and is likewise free of any name.
3. Back walks up the levels (session → child → home) instead of leaving the app; Forward
   re-enters. The in-app back button in the topbar goes up one level deterministically, so a
   deep-linked session still goes to the child card rather than off the site.
4. Back with a sheet open closes the sheet and stays on the page. Escape and a tap on the overlay
   still close it, `body.noscroll` is always removed, and closing by button leaves no stray
   history entry (open a sheet, close it with its button, press Back once → the previous page).
5. A hash naming a child or session that does not exist on this device lands on home with a Greek
   message and no console error; `ui.childId`/`ui.sessionId` are cleared rather than left stale.
6. Navigating away (route change, Back, or in-app) while a recording runs stops it and releases
   the microphone track and recogniser first. The `startSR()`-before-`await getUserMedia` order
   in `startRec` is untouched, and no red button is left active.
7. Both the browser tab and the Home Screen (standalone, `start_url: "./"`) open on home and then
   navigate; the manifest is not changed.
8. `bash scripts/agent/verify.sh` and `bash scripts/agent/qa.sh` are green; UI evidence at
   390x844 and 1280x800, light and dark, before/after; `execution.md` names the browser and the
   device each walkthrough was done on.

## Steps

| # | Step | Agent | Model | Size | Acceptance | Files expected | est_tokens |
|---|------|-------|-------|------|------------|----------------|-----------|
| 1 | Router core: `parseHash`/`routeOf`/`go()`, a single `applyRoute()` that awaits `ensureStopped()` then renders, a `hashchange` listener with a re-entrancy token, and `boot()` ending at the route instead of `render()`. Unknown or stale id → clear ids, `replaceState` to `#/`, Greek toast. Empty hash → `replaceState('#/')` where available, else leave it. | executor | claude-opus-5 | medium | Criteria 1, 2 (URL part), 5; reload on each of the three routes works; `verify.sh` green | site/assets/app.js | 1.2M |
| 2 | Migrate every call site that sets `ui.view` today to a route change: `actions.back` (up one level, not `history.back()`), `open-child`, `open-session`, `openSession()`, `createSession()`, `childForm` submit, `del-child`, `del-session`, `reset-demo`, `wipe`. No `ui.view = …` left outside the router. | executor | claude-opus-5 | medium | Criteria 3, 6; `grep` shows the router as the only writer of `ui.view`; recording stops on every path | site/assets/app.js | 1.4M |
| 3 | Sheets in history: `openSheet()` pushes one entry (feature-detected `pushState`, same URL), `popstate` with a sheet open closes it, `closeSheet()` from a button consumes its own entry without double-closing or re-opening. Escape and overlay-tap paths keep working. | executor | claude-opus-5 | medium | Criterion 4, on Chrome Android and iOS Safari; no entry accumulation | site/assets/app.js | 1.2M |
| 4 | Navigation UI: per-route `document.title`, focus moved to the view's heading on a route change so the level is announced (existing `role="status"`/`aria-live` untouched), topbar back button labelled for the level it returns to. Tap targets and the 390px single column unchanged. | executor | claude-opus-5 | small | Criteria 2 (title), 7; screenshots at both viewports in both themes | site/assets/app.js, site/assets/app.css (only if the label needs it) | 0.6M |
| 5 | README: a short "Navigation" section — the three routes, why hash routing on Pages, and that a link only resolves on the device that made it. | executor | claude-opus-5 | small | Criterion 2's privacy note is written down; `verify.sh` green | README.md | 0.3M |

Steps 1 and 2 land in that order (the router must exist before the call sites move), 3 after 2
(it depends on `popstate` not fighting the route handler), 4 and 5 last.

## Verification

Beyond the gate (`bash scripts/agent/verify.sh` after every step, `bash scripts/agent/qa.sh`
before the task is called done):

```bash
python3 -m http.server 8000 -d site    # then http://localhost:8000
```

Walkthroughs, each named in `execution.md` with the browser and device:

1. home → child → session; reload on each; the view comes back identical.
2. Back three times from a session: session → child → home, never off the site. Forward returns.
3. Paste `#/session/<id>` from walkthrough 1 into a new tab: the session opens; the topbar back
   button goes to the child card.
4. Edit a made-up id into the hash: lands on home, Greek message, no console error.
5. Open a sheet, press Back: the sheet closes, the page stays. Repeat closing by its own button,
   then Back once: the previous page.
6. Start a recording, then press Back: recording stops, the microphone indicator clears, the clip
   is either kept or discarded exactly as the current stop path does it.
7. iOS Safari and Home Screen: same as 1–3. If no iOS device is available, say so in
   `execution.md` — it is the platform this app is built around and an untested claim is worse
   than an admitted gap.
8. The URL bar and the tab title during 1–3 contain no child's name.

## Risks

- **Pages has no rewrite.** Path-based routing 404s on refresh under `/word-record/`. Mitigated by
  choosing hash routing; a reviewer should reject any `pushState` that changes the path.
- **`hashchange` is synchronous, `ensureStopped()` is not.** Two fast Back presses could render
  twice or render a half-stopped recording. Mitigated by the re-entrancy token in step 1; the
  reviewer checks the recording path explicitly.
- **Sheet history is the flaky part.** iOS Safari's `popstate` timing and the `noscroll` body
  class are where this usually breaks. If step 3 cannot be made reliable on a real iPhone, drop
  it and record why in `execution.md` — criteria 1–3 are the task's substance, and a Back button
  that sometimes leaves the page mid-session is worse than one that does not close sheets.
- **Stale and foreign links.** Ids are per-device `uid()` values; a link from another phone, or
  after «Διαγραφή όλων», names nothing. Step 1 must clear `ui.childId`/`ui.sessionId`, not just
  fall through `render()`'s existing home fallback.
- **Privacy creep.** The obvious next idea is a friendlier URL or title with the child's name in
  it. Both leak into browser history and the app switcher. Criterion 2 is a hard no.
- **Diff creep.** Touching navigation invites a wider UI rewrite. The steps name their files;
  anything else is a follow-up issue.

## Out of scope (file separately if wanted)

A bottom tab bar or any visual redesign; scroll-position restoration on Back; a `404.html`
fallback enabling path-based URLs; deep links to an exercise or a word; putting `editMode` in the
URL; any IndexedDB change.

## Stage jobs

| stage | round | model | effort | max_turns | est_tokens | depends on |
|-------|-------|-------|--------|-----------|-----------|-----------|
| executor | 1 | claude-opus-5 | xhigh | 200 | 5.0M | plan approved |
| review | 1 | claude-opus-5 | high | 80 | 0.6M | executor 1 |
| qa | 1 | claude-sonnet-5 | medium | 120 | 1.0M | review approved |

`models.security` is `claude-opus-5`, and every code step touches
`site/assets/app.js`, so no step runs below it.

## Gate

`limits.plan_approval` is `large`, the size is `large`, and the steps touch
`site/assets/app.js`, a `security_sensitive_paths` entry. The plan is posted on issue #3 and
waits for a maintainer. `approve` dispatches executor round 1; `changes: …` returns here.

Two questions worth a word at the gate, since both would widen the task:

1. Is "improve the UI" satisfied by correct navigation plus titles and focus, or is a visual
   navigation element (a bottom tab bar) wanted? The latter is a separate task.
2. Should the sheet-in-history behaviour (step 3) ship in this task or follow separately?
