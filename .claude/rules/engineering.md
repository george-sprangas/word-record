# Engineering rules

What good code looks like in this repository. It is one 1.5k-line ES file, no
framework and no build step — which is a choice that works, and which only keeps
working if changes respect it.

## The house style

- **Plain ES that a browser runs as written.** No transpiling, no bundler, no
  import maps, no npm. If something needs a build step, it does not belong here.
- **No dependency.** The one exception is already in the app: `transformers.js`,
  loaded from a CDN on demand for on-device transcription, chosen because the audio
  must not leave the device. A second exception needs its own task and its own
  argument.
- Follow what `site/assets/app.js` already does: small named functions, `const`
  first, early returns, template literals for markup, `esc()` on anything a user
  typed. Match the surrounding code rather than importing a new style.
- Greek for anything a user sees; English for identifiers, comments and commits.

## Feature detection, never user-agent sniffing

Recording and dictation differ per browser and per iOS version, and the app already
carries hard-won knowledge about that. Probe for the capability (`requestAdapter()`
rather than `navigator.gpu`); fall back rather than fail; and when a path genuinely
cannot work on a device, disable it in the UI and say why in Greek, with the
browser's own error code available for a bug report.

## Storage is other people's data

- IndexedDB holds real sessions on a real therapist's phone. Changing a store, a
  key or a record shape breaks data that exists and cannot be restored.
- Add fields; do not rename or repurpose them. Read defensively: a record written by
  an older version must still open.
- Nothing about a child — name, word, recording, transcript — may be logged, sent,
  or included in a report copied to the clipboard beyond what the user asked for.

## The microphone

- Start speech recognition inside the user gesture, before awaiting
  `getUserMedia`. This is not a style preference; awaiting first ends the gesture
  and Safari refuses.
- The red button always records: if the chosen mode needs dictation and the device
  refuses, take the microphone and keep the audio rather than failing to start.
- Always release tracks and recognisers on the failure path too.

## Accessibility and the phone

- The app is used one-handed, in a session, next to a child. Tap targets stay large,
  the layout stays single-column at 390px, and nothing important hides behind hover.
- Keep the existing ARIA roles (`role="status"`, `aria-live`) working when you touch
  the toast or the sheet.
- Light and dark both ship; check both when you change `app.css`.

## Prove it

- Run `bash scripts/agent/verify.sh` after each step, and `scripts/agent/qa.sh`
  before you call a task done.
- There is no unit test suite. So anything touching recording, dictation, playback
  or storage is proved by using the app in a browser — and `execution.md` says which
  browser and which device, because "works on my machine" is the failure mode this
  app is built around.
- A UI change ships with before/after screenshots at 390x844 and 1280x800.
