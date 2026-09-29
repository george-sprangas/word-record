#!/usr/bin/env python3
"""Mirror a repository's `.claude/settings.json` permissions into user settings.

A cloud session has no command line: the environment starts it, so the local
runner's answer — translate the repository's rules into `--allowedTools` and
`--disallowedTools` — is not available. What a cloud session does read is
`~/.claude/settings.json`, which the environment's setup script can write, and
which the snapshot then carries into every session started in that environment.

So the repository's file stays the contract on this surface too, and this copies
it one level down the precedence chain:

    managed > --settings > .claude/settings.local.json > .claude/settings.json > ~/.claude/settings.json

That ordering is what makes the copy safe. If a cloud session does apply the
project file (unmeasured — see docs/phases/P7_measurements.md), the project file
wins and this changes nothing, because it holds the same rules. If it does not,
these apply and the stage can work. Either way nothing is widened: the rules are
copied, never invented, and only `Skill` is added, because every stage begins
with a kit skill.

Deny rules are copied too. Claude Code unions deny lists across layers, so a
copy can only ever narrow what a session may do.

    cloud_permissions.py --repo /path/to/checkout [--home ~] [--print]

Exit 0 when the file was written (or would be), 1 when the repository has no
settings file to copy — which is a real configuration error on this path, not
something to paper over with a permissive default.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Keys this script owns in the user settings file. Anything else already there
# (a model preference, an env block the environment put in) is left alone.
MANAGED_KEYS = ("permissions",)


def read_rules(settings_path: Path) -> tuple[list[str], list[str]]:
    """The repository's allow and deny rules, or an empty pair."""
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [], []
    if not isinstance(data, dict):
        return [], []
    perms = data.get("permissions")
    if not isinstance(perms, dict):
        return [], []
    allow = [r for r in (perms.get("allow") or []) if isinstance(r, str)]
    deny = [r for r in (perms.get("deny") or []) if isinstance(r, str)]
    return allow, deny


def merged(existing: dict, allow: list[str], deny: list[str]) -> dict:
    """User settings with the repository's rules in place, other keys untouched."""
    out = dict(existing)
    if "Skill" not in allow:
        allow = [*allow, "Skill"]
    perms = dict(out.get("permissions") or {}) if isinstance(out.get("permissions"), dict) else {}
    perms["allow"] = allow
    # Union rather than replace: a deny already in user settings was put there
    # for a reason, and removing one is the only edit here that could widen.
    keep = [r for r in (perms.get("deny") or []) if isinstance(r, str) and r not in deny]
    perms["deny"] = [*deny, *keep]
    out["permissions"] = perms
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", required=True, help="the checkout to copy the rules from")
    parser.add_argument("--home", default=str(Path.home()), help="where ~/.claude lives")
    parser.add_argument("--print", dest="show", action="store_true",
                        help="print the result instead of writing it")
    args = parser.parse_args()

    source = Path(args.repo) / ".claude" / "settings.json"
    allow, deny = read_rules(source)
    if not allow and not deny:
        print(f"{source} has no permissions to copy. A stage in this environment would run "
              f"with whatever the session's own defaults are, which is not a contract this "
              f"repository stated. Run /agent-kit:init-project on it first.", file=sys.stderr)
        return 1

    target = Path(args.home) / ".claude" / "settings.json"
    existing: dict = {}
    if target.is_file():
        try:
            loaded = json.loads(target.read_text(encoding="utf-8"))
            existing = loaded if isinstance(loaded, dict) else {}
        except (OSError, json.JSONDecodeError):
            existing = {}

    result = merged(existing, allow, deny)
    text = json.dumps(result, indent=2) + "\n"
    if args.show:
        print(text, end="")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    perms = result["permissions"]
    print(f"wrote {target}: {len(perms['allow'])} allow rule(s), {len(perms['deny'])} deny rule(s), "
          f"copied from {source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
