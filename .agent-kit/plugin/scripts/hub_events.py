#!/usr/bin/env python3
"""What a stage tells the Hub while it is still running.

Four things. Three are best-effort; `stage-job` is not.

**`session-url`** prints the URL of the session this is running in, when the
surface has one. A cloud session knows its own identity —
`CLAUDE_CODE_REMOTE_SESSION_ID` is `cse_<id>`, and the app's URL for the same
session is `https://claude.ai/code/session_<id>` — so a stage can report where
it is being watched, and the Hub's task page can link straight to it. Before
this, `Run.url` was only ever set by an adapter that happened to get a URL back,
which left every `routine_oneoff` and `ccr_session` run linking nowhere.

**`event`** posts one line to `/api/runs/<run_id>/events`. A cloud session cannot
stream its transcript to the Hub the way the local runner does — nothing is
watching its stdout — so the stage posts a handful of coarse events at its own
boundaries instead: started, delegating, the verification gate's verdict,
finished. That is a progress line, not a feed, and the console says so and links
to the app for the rest. Building a streaming bridge to produce something the
Claude app already shows would be a lot of moving parts for a worse copy.

**`stage-job`** registers the next stage with the Hub, at
`/api/stage-jobs`. This is the hand-off the whole pipeline turns on: the
Orchestrator decides what comes next and writes it to the ledger, but until the
Hub has the job the Dispatcher has nothing to place, and the task stops with a
ledger that says a stage was "registered for dispatch" and a Hub that has never
heard of it. That is exactly what happened to task-17's review#1 on
2026-09-13: the skill said "register the stage job in `create_job`" and left
each Orchestrator to invent the call, so one wake wrote only the ledger and
another guessed `/api/tasks/<task>` and got a 404. Unlike the two above, this
one **reports failure**: a stage job that did not reach the Hub is a stalled
task, not a missing progress line.

**`media`** uploads one video or still to `/api/runs/<run_id>/media` — QA's
walkthrough of an acceptance criterion, or a before/after capture (P9). Media
lives in the Hub and never in git (D9.7): screenshots committed to a task branch
are squash-merged into `main`, and video would grow every clone for ever. The
file is checked here first — type, size, that it is not empty — because a clip
the Hub would refuse is better named by the stage that can still re-record it.

None of the three best-effort commands may ever fail a stage. The Hub being
unreachable, or refusing a file, is worth one line on stderr and nothing more:
the stage's work is in git, and its result and usage reach the Hub by other
routes.

Every command that talks to the Hub presents the variable `--token-env` names
(the project token by default) and falls back to `AGENTKIT_POOL_TOKEN` when that
is unset. Since P9 one cloud environment serves every repository on an account,
so it carries the pool's token and usually no project token; the Hub accepts the
pool token for runs on that pool, and for the tasks and stage jobs of projects
that list it.

    hub_events.py session-url
    hub_events.py event --run run_abc --kind system --text "plan: started"
    hub_events.py stage-job --task task-17 --stage review --round 1 \
        --model claude-opus-5 --effort high
    hub_events.py media --run run_abc --phase walkthrough --criterion 1 \
        --label "Undo a match" --file .agentkit/visual/walkthrough__1__undo-a-match__1280x800.webm
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

APP_SESSION_URL = "https://claude.ai/code/session_{suffix}"
TIMEOUT = 5
DEFAULT_TOKEN_ENV = "AGENTKIT_PROJECT_TOKEN"
POOL_TOKEN_ENV = "AGENTKIT_POOL_TOKEN"

# The P9 media contract. Video is capped at 30 MB because Cloud Run refuses an
# HTTP/1 request body over 32 MiB: a larger clip could never reach the Hub, and
# would fail after a long upload instead of here.
MEDIA_TYPES = {
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
MEDIA_LIMITS = {"video": 30 * 1024 * 1024, "image": 8 * 1024 * 1024}
MEDIA_PHASES = ("walkthrough", "before", "after")
LABEL_LIMIT = 200
# Per socket operation, not in total. Five seconds suits a one-line event; a
# 30 MB clip on a slow link needs longer between writes.
MEDIA_TIMEOUT = 60


def resolve_token(name: str, env: dict[str, str] | None = None) -> str:
    """The token to present: the named variable's value, else the pool's.

    Reads variables, never arguments — see the note on allow_abbrev in main().
    """
    env = os.environ if env is None else env
    return (env.get(name) or "").strip() or (env.get(POOL_TOKEN_ENV) or "").strip()


def session_url(env: dict[str, str] | None = None) -> str:
    """This session's URL in the Claude app, or "" where there is not one."""
    env = os.environ if env is None else env
    remote = (env.get("CLAUDE_CODE_REMOTE_SESSION_ID") or "").strip()
    if not remote:
        # A local or headless session is not watchable in the app, and saying so
        # by printing nothing is better than inventing a link that 404s.
        return ""
    suffix = remote[4:] if remote.startswith("cse_") else remote
    if not suffix:
        return ""
    return APP_SESSION_URL.format(suffix=suffix)


def post_event(hub: str, run_id: str, token: str, kind: str, text: str,
               *, timeout: int = TIMEOUT) -> tuple[bool, str]:
    """Post one run event. Returns (ok, detail); never raises."""
    if not (hub and run_id and token):
        return False, "hub url, run id and token are all required"
    payload = json.dumps({
        "events": [{
            "at": datetime.now(timezone.utc).isoformat(),
            "kind": kind,
            "text": text,
        }]
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{hub.rstrip('/')}/api/runs/{run_id}/events",
        data=payload,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
        return True, "cancel" if body.get("cancel") else "ok"
    except urllib.error.HTTPError as exc:
        return False, f"the Hub answered {exc.code}"
    except urllib.error.URLError as exc:
        # The shape this takes when a cloud environment's network allowlist does
        # not include the Hub. Worth naming, because it looks like nothing else.
        return False, f"the Hub could not be reached: {exc.reason}"
    except (TimeoutError, OSError, ValueError) as exc:
        return False, f"the Hub could not be reached: {exc}"


def post_stage_job(hub: str, token: str, job: dict, *, timeout: int = TIMEOUT) -> tuple[bool, str]:
    """Register the next stage with the Hub. Returns (ok, detail); never raises.

    Idempotent by (task, stage, round): the Hub answers `created: false` for a
    job it already has, so a wake that runs twice does not make two jobs.
    """
    if not (hub and token):
        return False, "hub url and token are both required"
    request = urllib.request.Request(
        f"{hub.rstrip('/')}/api/stage-jobs",
        data=json.dumps(job).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300] if hasattr(exc, "read") else ""
        return False, f"the Hub answered {exc.code}: {detail}"
    except urllib.error.URLError as exc:
        return False, f"the Hub could not be reached: {exc.reason}"
    except (TimeoutError, OSError, ValueError) as exc:
        return False, f"the Hub could not be reached: {exc}"
    if not body.get("ok"):
        return False, f"the Hub refused it: {body.get('error', body)}"
    return True, f"{body.get('job', '?')} ({'created' if body.get('created') else 'already known'})"


def sniff(head: bytes) -> str:
    """The media type the file's first bytes say it is, or ""."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm"
    if head[4:8] == b"ftyp":
        return "video/mp4"
    return ""


def check_media(path: str, phase: str, criterion: int | None) -> tuple[str, str]:
    """(content type, problem) for a file about to be uploaded; problem is "" when it may go.

    Everything the Hub would refuse on sight is refused here, where the stage can
    still do something about it and before a 30 MB upload is spent on it.
    """
    if phase not in MEDIA_PHASES:
        return "", f"--phase must be one of {', '.join(MEDIA_PHASES)}, not {phase!r}"
    if criterion is not None and criterion < 1:
        return "", f"--criterion is the 1-based number of an acceptance criterion, not {criterion}"
    file = Path(path)
    if not file.is_file():
        return "", f"{path}: no such file"
    ctype = MEDIA_TYPES.get(file.suffix.lower(), "")
    if not ctype:
        return "", (f"{path}: {file.suffix or 'no extension'} is not a type the Hub takes — "
                    "webm or mp4 for a video, png, jpeg or webp for a still")
    size = file.stat().st_size
    if size == 0:
        # What Playwright leaves behind when the browser context was never
        # closed: the video is only written out on close.
        return "", f"{path} is empty — a recording is only written when its browser context closes"
    kind = ctype.split("/")[0]
    limit = MEDIA_LIMITS[kind]
    if size > limit:
        return "", (f"{path} is {size / 1024 / 1024:.1f} MB and the Hub takes at most "
                    f"{limit // 1024 // 1024} MB for a {kind} — record a shorter flow")
    with file.open("rb") as fh:
        said = sniff(fh.read(16))
    if said != ctype:
        # An error page saved under a .png name is the usual culprit.
        return "", f"{path} is named {file.suffix} but its contents are {said or 'not an image or a video'}"
    return ctype, ""


def multipart_body(fields: dict[str, str], filename: str, ctype: str,
                   data: bytes) -> tuple[bytes, str]:
    """A multipart/form-data body with one file part, and its Content-Type header."""
    boundary = f"agentkit-{uuid.uuid4().hex}"
    safe_name = filename.replace('"', "").replace("\r", "").replace("\n", "")
    out = bytearray()
    for name, value in fields.items():
        out += (f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n').encode("utf-8")
        out += value.encode("utf-8") + b"\r\n"
    out += (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n").encode("utf-8")
    out += data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def post_media(hub: str, run_id: str, token: str, path: str, ctype: str, phase: str,
               label: str = "", criterion: int | None = None,
               *, timeout: int = MEDIA_TIMEOUT) -> tuple[bool, str]:
    """Upload one checked file. Returns (ok, detail); never raises."""
    if not (hub and run_id and token):
        return False, "hub url, run id and token are all required"
    fields = {"phase": phase}
    if label:
        fields["label"] = label
    if criterion is not None:
        fields["criterion"] = str(criterion)
    try:
        data = Path(path).read_bytes()
    except OSError as exc:
        return False, f"{path} could not be read: {exc}"
    body, content_type = multipart_body(fields, Path(path).name, ctype, data)
    request = urllib.request.Request(
        f"{hub.rstrip('/')}/api/runs/{run_id}/media",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        # Print what the Hub said: "a run may carry at most 40 files" is an
        # answer a stage can act on, and a bare status code is not.
        detail = exc.read().decode("utf-8", "replace")[:300] if hasattr(exc, "read") else ""
        return False, f"the Hub answered {exc.code}: {detail}"
    except urllib.error.URLError as exc:
        return False, f"the Hub could not be reached: {exc.reason}"
    except (TimeoutError, OSError, ValueError) as exc:
        return False, f"the Hub could not be reached: {exc}"
    try:
        answer = json.loads(raw or "{}")
    except ValueError:
        # Something answered, and it was not the Hub's API: a sign-in page
        # redirected to, or the wrong --hub. Saying "unreachable" would send
        # someone to check a network that works.
        return False, f"the answer was not the Hub's JSON: {' '.join(raw.split())[:120]!r}"
    if not answer.get("ok"):
        return False, f"the Hub refused it: {answer.get('error', answer)}"
    return True, f"uploaded {Path(path).name} ({phase}) as {answer.get('id', '?')}"


def hub_arguments(parser: argparse.ArgumentParser) -> None:
    """Where the Hub is, and which variable holds the token — the same for every command."""
    parser.add_argument("--hub", default=os.environ.get("AGENTKIT_HUB_URL", ""))
    parser.add_argument("--token-env", default=DEFAULT_TOKEN_ENV,
                        help=f"the variable holding the token ({POOL_TOKEN_ENV} when it is unset); "
                             "the value is never an argument")


def main(argv: list[str] | None = None) -> int:
    # allow_abbrev=False on purpose. With it on, argparse accepts `--token` as an
    # abbreviation of `--token-env`, so a stage writing `--token "$AGENTKIT_PROJECT_TOKEN"`
    # passes the secret where a variable NAME is expected: the post fails, and
    # the token is now in the session's transcript. Refusing the flag is the
    # difference between a typo and a leak.
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("session-url", help="print this session's URL in the Claude app")

    event = sub.add_parser("event", help="post one progress line to the Hub", allow_abbrev=False)
    event.add_argument("--run", required=True)
    event.add_argument("--kind", default="system", choices=["text", "tool", "error", "result", "system"])
    event.add_argument("--text", required=True)
    hub_arguments(event)

    job = sub.add_parser("stage-job", help="register the next stage with the Hub",
                         allow_abbrev=False)
    job.add_argument("--task", required=True)
    # Not `orchestrate` or `init`, although both are envelope stages. The Hub
    # queues a wake only after its own `next_action` says one is due (P9 D9.6),
    # and `init` is a person's button. An Orchestrator that could register its
    # own next wake would rebuild the hourly no-op loop P8 took out.
    job.add_argument("--stage", required=True,
                     choices=["plan", "executor", "review", "qa", "deploy", "watch", "noop"])
    job.add_argument("--round", type=int, default=1)
    job.add_argument("--model", default="")
    job.add_argument("--effort", default="", choices=["", "low", "medium", "high"])
    job.add_argument("--cls", default="", help="priority class; the task's own is used when absent")
    job.add_argument("--depends-on", default="", help="<stage>#<round> this waits for")
    hub_arguments(job)

    media = sub.add_parser("media", help="upload one walkthrough video or before/after still",
                           allow_abbrev=False)
    media.add_argument("--run", required=True)
    media.add_argument("--file", required=True,
                       help="webm or mp4 up to 30 MB; png, jpeg or webp up to 8 MB")
    # Checked in check_media rather than by argparse `choices`, so a wrong
    # phase is a line on stderr like every other refusal, not an exit 2.
    media.add_argument("--phase", required=True, metavar="|".join(MEDIA_PHASES))
    media.add_argument("--label", default="", help=f"a caption, at most {LABEL_LIMIT} characters")
    media.add_argument("--criterion", type=int, default=None,
                       help="the 1-based acceptance criterion this proves")
    hub_arguments(media)

    args = parser.parse_args(argv)

    if args.command == "media":
        ctype, problem = check_media(args.file, args.phase, args.criterion)
        if problem:
            print(f"media: not uploaded — {problem} (the stage carries on)", file=sys.stderr)
            return 0
        label = args.label.strip()
        if len(label) > LABEL_LIMIT:
            label = label[:LABEL_LIMIT - 1] + "…"
        ok, detail = post_media(args.hub, args.run, resolve_token(args.token_env), args.file,
                                ctype, args.phase, label, args.criterion)
        if not ok:
            # Exit 0, like `event`: evidence that did not reach the console is a
            # gap in a page, and failing the stage for it would lose the verdict.
            print(f"media: not uploaded — {detail} (the stage carries on)", file=sys.stderr)
            return 0
        print(f"media: {detail}")
        return 0

    if args.command == "stage-job":
        payload = {"task": args.task, "stage": args.stage, "round": args.round}
        for name, value in (("model", args.model), ("effort", args.effort),
                            ("cls", args.cls), ("depends_on", args.depends_on)):
            if value:
                payload[name] = value
        ok, detail = post_stage_job(args.hub, resolve_token(args.token_env), payload)
        print(f"stage-job: {detail}", file=sys.stdout if ok else sys.stderr)
        # Exit non-zero on purpose, unlike the other two: an unregistered stage
        # job is a task that stops, and the Orchestrator must see that it did.
        return 0 if ok else 1

    if args.command == "session-url":
        url = session_url()
        if url:
            print(url)
        return 0

    ok, detail = post_event(args.hub, args.run, resolve_token(args.token_env),
                            args.kind, args.text)
    if not ok:
        # Deliberately exit 0: a stage that fails because the console could not
        # be updated has turned a progress line into an outage.
        print(f"hub_events: {detail} (the stage carries on)", file=sys.stderr)
        return 0
    if detail == "cancel":
        print("cancel")
    return 0


if __name__ == "__main__":
    sys.exit(main())
