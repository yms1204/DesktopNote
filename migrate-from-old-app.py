#!/usr/bin/env python3
"""
Imports notes from the old `markdown-sticky-notes` app (bundle id
com.mdstickynotes), which kept them in UserDefaults, into this app's JSON
store.

Existing notes are kept: anything already present with the same id is skipped,
so running this twice is harmless.
"""

import json
import os
import plistlib
import shutil
import sys
from datetime import datetime, timezone

OLD_PLIST = os.path.expanduser("~/Library/Preferences/com.mdstickynotes.plist")
NEW_STORE = os.path.expanduser("~/Library/Application Support/MDStickyNote/notes.json")


def read_old_notes(path):
    if not os.path.exists(path):
        return []
    with open(path, "rb") as handle:
        prefs = plistlib.load(handle)
    raw = prefs.get("sticky_notes")
    if not raw:
        return []
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def read_new_notes(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        text = handle.read().strip()
    return json.loads(text) if text else []


def convert(old):
    """Maps an old note onto this app's schema, dropping fields it no longer has."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    position = old.get("position") or {}
    size = old.get("size") or {}
    return {
        "id": old["id"],
        "content": old.get("content", ""),
        "position": {
            "x": float(position.get("x", 140)),
            "y": float(position.get("y", 140)),
        },
        "size": {
            "width": float(size.get("width", 340)),
            "height": float(size.get("height", 400)),
        },
        # The old app defaulted to 0.95; anything near-opaque reads better at 1.
        "opacity": 1.0 if float(old.get("opacity", 1.0)) > 0.9 else float(old["opacity"]),
        "colorTheme": old.get("colorTheme", "yellow"),
        "cursorPosition": int(old.get("cursorPosition", 0)),
        "scrollTop": float(old.get("scrollTop", 0)),
        "alwaysOnTop": bool(old.get("alwaysOnTop", False)),
        "createdAt": old.get("createdAt", now),
        "modifiedAt": old.get("modifiedAt", now),
    }


def main():
    old_notes = read_old_notes(OLD_PLIST)
    if not old_notes:
        print("No notes found in the old app - nothing to migrate.")
        return 0

    existing = read_new_notes(NEW_STORE)
    known = {note.get("id") for note in existing}

    added = [convert(note) for note in old_notes if note.get("id") not in known]
    if not added:
        print(f"All {len(old_notes)} note(s) were already imported.")
        return 0

    os.makedirs(os.path.dirname(NEW_STORE), exist_ok=True)
    if os.path.exists(NEW_STORE):
        shutil.copy2(NEW_STORE, NEW_STORE + ".bak")

    with open(NEW_STORE, "w", encoding="utf-8") as handle:
        json.dump(existing + added, handle, indent=2, ensure_ascii=False)

    print(f"Imported {len(added)} note(s) into {NEW_STORE}")
    for note in added:
        first = next((l for l in note["content"].splitlines() if l.strip()), "(empty)")
        print(f"  - {first[:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
