#!/usr/bin/env python3
"""Create or refresh a local-only login user for visual verification.

Refuses to run unless Django is in DEBUG, so it can never touch a real
environment. It creates a superuser and then hands over to the repository for
anything app-specific: if scripts/agent/vv_grants.py exists and defines
grant(user), it is called so per-app access flags live in the repo that owns
them rather than being guessed by the kit.

Usage, from the project root with the virtualenv active:

    VV_USER=visual_verify VV_PASS=vv-local-dev-pass python .../ensure_login_user.py

Environment:
    VV_USER, VV_PASS            credentials to create (required)
    VV_EMAIL                    default <user>@example.invalid
    DJANGO_SETTINGS_MODULE      auto-detected from manage.py when unset
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def detect_settings_module(root: Path) -> str | None:
    manage = root / "manage.py"
    if not manage.is_file():
        return None
    match = re.search(
        r"DJANGO_SETTINGS_MODULE[\"'],\s*[\"']([^\"']+)[\"']",
        manage.read_text(encoding="utf-8"),
    )
    return match.group(1) if match else None


def main() -> int:
    root = Path.cwd()
    username = os.environ.get("VV_USER")
    password = os.environ.get("VV_PASS")
    if not username or not password:
        print("ensure_login_user: set VV_USER and VV_PASS", file=sys.stderr)
        return 2

    if not os.environ.get("DJANGO_SETTINGS_MODULE"):
        detected = detect_settings_module(root)
        if not detected:
            print("ensure_login_user: run me from the project root, or set DJANGO_SETTINGS_MODULE", file=sys.stderr)
            return 2
        os.environ["DJANGO_SETTINGS_MODULE"] = detected

    sys.path.insert(0, str(root))
    try:
        import django
        from django.conf import settings
    except ImportError:
        print("ensure_login_user: Django is not importable; activate the project's virtualenv", file=sys.stderr)
        return 2

    django.setup()

    if not settings.DEBUG:
        print(
            "ensure_login_user: refusing to run with DEBUG off. This helper is for local "
            "verification only and must never touch a deployed environment.",
            file=sys.stderr,
        )
        return 1

    from django.contrib.auth import get_user_model

    User = get_user_model()
    email = os.environ.get("VV_EMAIL", f"{username}@example.invalid")
    defaults = {"is_staff": True, "is_superuser": True}
    if "email" in {f.name for f in User._meta.get_fields()}:
        defaults["email"] = email

    user, created = User.objects.get_or_create(**{User.USERNAME_FIELD: username}, defaults=defaults)
    for field, value in defaults.items():
        setattr(user, field, value)
    user.set_password(password)
    user.is_active = True
    user.save()

    print(f"ensure_login_user: {'created' if created else 'refreshed'} {username} (superuser)")

    grants = root / "scripts" / "agent" / "vv_grants.py"
    if grants.is_file():
        import importlib.util

        spec = importlib.util.spec_from_file_location("vv_grants", grants)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        if hasattr(module, "grant"):
            module.grant(user)
            print("ensure_login_user: applied scripts/agent/vv_grants.py")
        else:
            print("ensure_login_user: scripts/agent/vv_grants.py has no grant(user); skipped")
    else:
        print(
            "ensure_login_user: no scripts/agent/vv_grants.py. If this project gates routes on "
            "per-user access flags, add one so screenshots do not land on a redirect."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
