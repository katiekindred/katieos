#!/usr/bin/env python3
"""
vault_gap_query.py

Finds notes in The Veggie Fortress containing specific tags and reports
how long it's been since each note was last modified.
Sorted by most stale first — good for surfacing ignored or forgotten notes.

Default tags: #👀  #🫵  #🔗

Usage:
    python3 vault_gap_query.py
    python3 vault_gap_query.py --tags "#👀" "#custom"
"""

import os
import re
import sys
import datetime

VAULT_PATH = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Veggie Fortress"
)

DEFAULT_TAGS = {"#👀", "#🫵", "#🔗"}


def get_file_dates(path):
    stat = os.stat(path)
    birth = getattr(stat, "st_birthtime", stat.st_mtime)
    created = datetime.datetime.fromtimestamp(birth)
    updated = datetime.datetime.fromtimestamp(stat.st_mtime)
    return created, updated


def find_tags(content, tags):
    found = set()
    for tag in tags:
        # Match tag followed by whitespace, punctuation, or end of string
        if re.search(re.escape(tag) + r"(?=\s|$|[^\w#])", content):
            found.add(tag)
    return found


def format_gap(gap):
    days = gap.days
    if days == 0:
        return "same day"
    elif days < 30:
        return f"{days}d"
    elif days < 365:
        months = days // 30
        remainder = days % 30
        return f"{months}mo {remainder}d" if remainder else f"{months}mo"
    else:
        years = days // 365
        remainder = days % 365
        months = remainder // 30
        return f"{years}y {months}mo" if months else f"{years}y"


def main():
    # Parse optional custom tags
    if "--tags" in sys.argv:
        idx = sys.argv.index("--tags")
        tags = set(sys.argv[idx + 1:]) or DEFAULT_TAGS
    else:
        tags = DEFAULT_TAGS

    results = []
    errors = []

    for root, dirs, files in os.walk(VAULT_PATH):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))

        for filename in sorted(files):
            if not filename.endswith(".md"):
                continue

            path = os.path.join(root, filename)
            rel_path = os.path.relpath(path, VAULT_PATH)

            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()

                matched = find_tags(content, tags)
                if not matched:
                    continue

                created, updated = get_file_dates(path)
                staleness = datetime.datetime.now() - updated

                results.append({
                    "name": os.path.splitext(filename)[0],
                    "path": rel_path,
                    "created": created,
                    "updated": updated,
                    "staleness": staleness,
                    "tags": matched,
                })

            except Exception as e:
                errors.append(f"{rel_path}: {e}")

    if not results:
        print(f"\nNo notes found with tags: {', '.join(sorted(tags))}")
        return

    results.sort(key=lambda x: (-x["staleness"].days, x["created"]))

    tag_label = "  ".join(sorted(tags))
    print(f"\nNotes tagged {tag_label} — most stale first\n")
    print(f"  {'Note':<42} {'Created':<12} {'Last modified':<14} {'Untouched':<12} Tags")
    print("  " + "-" * 92)

    for r in results:
        name = r["name"]
        if len(name) > 41:
            name = name[:38] + "..."
        tag_str = "  ".join(sorted(r["tags"]))
        print(
            f"  {name:<42} "
            f"{r['created'].strftime('%Y-%m-%d'):<12} "
            f"{r['updated'].strftime('%Y-%m-%d'):<14} "
            f"{format_gap(r['staleness']):<12} "
            f"{tag_str}"
        )

    print(f"\n  {len(results)} note{'s' if len(results) != 1 else ''} found.")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print(f"  {e}")


if __name__ == "__main__":
    main()
