# word-record (Λογοτετράδιο)

A mobile-first web app for speech therapists. A therapist builds a session plan of
words for a child, records each word, Greek dictation writes down what was said,
she corrects it to match exactly what she heard, and marks it done.

**Everything about this repository follows from three facts.** Read them before
changing anything.

1. **There is no backend.** No server, no database, no accounts, no API. Children,
   sessions and audio live in the browser's IndexedDB on the therapist's own
   device. Recordings are of children's voices, so "it stays on the device" is a
   promise to a client, not an implementation detail.
2. **There is no build step and no dependency.** `site/` is served verbatim by
   GitHub Pages: the files committed are the files that run. No bundler, no
   package.json, no framework. A change that needs npm install is a change to what
   this project is — propose it as its own task, do not slip it into another one.
3. **The UI is Greek and dictation is `el-GR`.** Strings in the app are Greek;
   comments and commit messages are English.

## The shape of it

```
site/
  index.html              page shell — one page, views swapped in JS
  assets/app.js           all app logic: storage, recording, dictation, UI (~1.5k lines)
  assets/app.css          styles, light and dark
  manifest.webmanifest    home-screen install
  icons/                  app icons (binary; a person replaces these)
.github/workflows/        pages.yml publishes site/; ci.yml is the gate; the rest is the pipeline
scripts/agent/            what every pipeline stage runs
docs/pipeline/            the ledger — one directory per task
pipeline.yml              the contract: scripts, scope, limits, invariants
.agent-kit/               vendored copy of the kit. Never edit it here.
```

## Running it

```bash
bash scripts/agent/bootstrap.sh          # checks node and python3; installs nothing
python3 -m http.server 8000 -d site      # then open http://localhost:8000
```

`localhost` counts as a secure origin, so the microphone works there. A phone needs
HTTPS: use the Pages URL or a tunnel.

## The gate

```bash
bash scripts/agent/verify.sh    # JS parses, assets exist, manifest and YAML parse
bash scripts/agent/qa.sh        # the above, plus every asset served over HTTP
```

`verify.sh` is the contract with the pipeline: a stage may not end while it is red,
and CI runs the same script. It is fast — run it after every step, not at the end.

There is no unit test suite, because there is no test runner and adding one means
adding a dependency. That is a real gap, not a decision to be proud of: it means
**anything to do with recording, dictation or storage has to be proved by using the
app**, on the device that matters. Say in `execution.md` which device you used.

## What breaks if you are careless

- **The microphone.** Safari only grants speech recognition inside the user gesture
  that asked for it, so `startRec` calls `startSR()` *before* awaiting
  `getUserMedia`. Awaiting first ends the gesture and dictation fails with
  `service-not-allowed`. Do not reorder those.
- **iOS.** iOS gives the audio session to one consumer, so dictation and
  `MediaRecorder` can never both hold the microphone there, and Web Speech does not
  work at all from a Home Screen icon or an in-app browser. The iOS defaults and the
  messages that explain them are load-bearing; read the README section before
  touching `recMode`.
- **Stored data.** A change to the IndexedDB schema strands sessions that already
  exist on a therapist's phone. There is no migration story and no backup. Treat the
  storage layer as append-only unless the task is explicitly about migrating it.
- **Greek output.** Dictation asks for several alternatives and takes the first
  Greek one; anything still in latin letters is transliterated so the word can be
  compared letter by letter. Removing that makes the comparison useless.

## Working here

- The task, the plan and the review live on the issue and in `docs/pipeline/<task>/`.
  `pipeline.yml` is the contract; `.claude/rules/` is how we work.
- Scope: `site/`, `docs/`, `scripts/`, `README.md`. `.agent-kit/` is vendored and
  `site/icons/` is binary — neither is yours to change.
- Never push to `main`, never merge your own PR, never publish the site from a
  session. Publishing happens in CI, behind a person.
- Every file in `site/` ships to a therapist's phone. Leave no debug logging of what
  a child said, and no request that carries user data anywhere.

## Pipeline

```bash
python3 .agent-kit/plugin/scripts/doctor.py              # is this repo still wired up
python3 .agent-kit/plugin/scripts/pipeline_state.py --task task-12 --status
```
