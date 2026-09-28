# Λογοτετράδιο (word-record)

A mobile-first web app for speech therapists (λογοθεραπεύτριες). For each child you build a session plan of exercises (words and phrases). During the session you record each word, Greek dictation writes down what the child said, you correct it to match exactly what was heard, and you mark it done. Easy words can be marked **Σωστό** with one tap and no recording.

The UI is in Greek and dictation uses `el-GR`. Dictation output is always written in Greek script: the recogniser is asked for several
alternatives and the first Greek one wins, and anything still in latin letters is transliterated (`spiti` → `σπιτι`) so the word can be
compared letter by letter against the target.

## Features

- Children, sessions and exercise plans. Paste words one per line, or pick a ready-made list (/σ/, /ρ/, /λ/, /κ/–/γ/, phrases). A new session can copy the previous plan.
- Per word: record, live dictation, replay, reset, done. The next word opens automatically.
- Playback has a seek bar and a 0.5× / 0.75× / 1× speed control (pitch preserved), so you can scrub back to the moment a sound went
  wrong and hear it slowed down. The speed is remembered across words and sessions.
- Target vs. production comparison: the target word is shown next to a letter-level diff (omitted letters struck through, substitutions
  and additions underlined). A **Μετατροπή σε ελληνικά** button converts greeklish typed into the field by hand.
- Session progress, % correct per session, and a copyable text summary.
- Recording modes (menu → **Ρυθμίσεις εγγραφής**): audio + dictation (default), dictation only, audio only. Use these on phones where the microphone can't do both at once.
- Installable to the home screen (web app manifest and icons).
- All data, including recordings, stays on the device (IndexedDB). There is no backend.

## Run it on GitHub Pages

1. In the repo go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Go to **Actions → Deploy to GitHub Pages → Run workflow** (or push to `main`).
3. Open `https://george-sprangas.github.io/word-record/`.

The repo is private. GitHub Pages for private repos needs a paid plan (Pro, Team or Enterprise). On the free plan, either make the repo public, or point Netlify, Vercel or Cloudflare Pages at the `site/` folder. No build step is needed.

## Run it locally

```bash
python3 -m http.server 8000 -d site
# open http://localhost:8000
```

`localhost` counts as a secure origin, so the microphone works. To test on a phone you need HTTPS: use the Pages URL, or a tunnel such as `npx localtunnel --port 8000`.

## Browser support

| Browser | Recording | Automatic dictation |
|---|---|---|
| Chrome (Android, desktop) | Yes | Yes. Uses Google's speech service and needs internet. |
| Safari (iOS 14.5+, macOS) | Yes | Yes. Uses Apple's speech service. Dictation must be enabled on the device. |
| Edge | Yes | Usually |
| Firefox | Yes | No. Type the text or use the keyboard's mic. |

On some Android phones, speech recognition and recording can't use the microphone at the same time. The app detects a silent recording or a dictation error and suggests switching recording mode.

Safari grants speech recognition only from inside the user gesture that asked for it, so `startRec` calls `startSR()` before it awaits
`getUserMedia` — awaiting first ends the gesture and `start()` then fails with `service-not-allowed` even when Dictation is enabled.

**On iPhone and iPad, dictation and recording cannot share the microphone at all.** iOS gives the audio session to one consumer, so
**Ήχος και υπαγόρευση** can only ever deliver one of the two there: use **Μόνο υπαγόρευση** for automatic text, or **Μόνο ήχος** to keep
the clip and type. The app detects iOS, says so on the failing word, and offers a one-tap switch.

Dictation errors carry the browser's own error code. **Ρυθμίσεις εγγραφής → Δοκιμή υπαγόρευσης** runs recognition on its own, with no
recorder, to tell the causes apart: if it fails for `el-GR` but works with the device language, Greek is missing from Settings → General →
Keyboard → Dictation Languages. **Αντιγραφή στοιχείων για αναφορά** copies the user agent, mode and every error code for a bug report.

Inside a sandboxed frame (for example a claude.ai artifact), the microphone is blocked. The app then falls back to the phone's camera or recorder app plus keyboard dictation.

## Privacy

- Session data and recordings are stored only in the browser on the device (IndexedDB). Clearing site data deletes them.
- Automatic dictation uses the browser's speech service. In Chrome the dictation audio is processed by Google, in Safari by Apple. Mention this to clients because the recordings are of children's voices. **Μόνο ήχος** mode avoids it.

## Structure

```
site/
  index.html              page shell
  assets/app.css          styles (light and dark)
  assets/app.js           app logic: storage, recording, dictation, UI
  manifest.webmanifest    home-screen install
  icons/                  app icons
.github/workflows/pages.yml   deploys site/ to GitHub Pages
```

To rename the app, change `APP_NAME` in `site/assets/app.js`, the `<title>` and `apple-mobile-web-app-title` in `site/index.html`, and `name` / `short_name` in `site/manifest.webmanifest`.
