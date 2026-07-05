#!/usr/bin/env python3
"""
add_note_dates.py

Adds `created` and `updated` date fields to the YAML frontmatter of every
Markdown note in The Veggie Fortress Obsidian vault, using actual file system
timestamps.

- Notes with existing frontmatter: dates are merged in (existing fields kept)
- Notes with no frontmatter: a frontmatter block is created
- Already has created/updated fields: they are overwritten with accurate values

Usage:
    python3 add_note_dates.py           # dry run — shows what would change
    python3 add_note_dates.py --write   # actually updates the files
"""

import os
import re
import sys
import datetime

VAULT_PATH = os.path.expanduser(
    "~/Library/Mobile Documents/iCloud~md~obsidian/Documents/The Veggie Fortress"
)

# Date format used in frontmatter
DATE_FORMAT = "%Y-%m-%d"

DRY_RUN = "--write" not in sys.argv


def get_file_dates(path):
    stat = os.stat(path)
    # st_birthtime is macOS-only (creation time); fall back to st_mtime if missing
    birth = getattr(stat, "st_birthtime", stat.st_mtime)
    created = datetime.datetime.fromtimestamp(birth).strftime("%Y-%m-%d")
    updated = datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d")
    return created, updated


def process_note(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    created, updated = get_file_dates(path)

    if content.startswith("---\n"):
        # File has existing frontmatter — find the closing ---
        end = content.find("\n---\n", 4)
        if end != -1:
            frontmatter = content[4:end]
            body = content[end + 5:]

            # Strip any existing created/updated lines
            frontmatter = re.sub(r"^created:.*\n?", "", frontmatter, flags=re.MULTILINE)
            frontmatter = re.sub(r"^updated:.*\n?", "", frontmatter, flags=re.MULTILINE)
            frontmatter = frontmatter.strip()

            # Rebuild: dates first, then existing fields
            if frontmatter:
                new_frontmatter = f"created: {created}\nupdated: {updated}\n{frontmatter}"
            else:
                new_frontmatter = f"created: {created}\nupdated: {updated}"

            new_content = f"---\n{new_frontmatter}\n---\n{body}"
        else:
            # Malformed frontmatter — prepend a clean block
            new_content = f"---\ncreated: {created}\nupdated: {updated}\n---\n{content}"
    else:
        # No frontmatter at all
        new_content = f"---\ncreated: {created}\nupdated: {updated}\n---\n{content}"

    changed = new_content != content
    return new_content, changed


def main():
    if DRY_RUN:
        print("DRY RUN — no files will be changed. Pass --write to apply.\n")

    count = 0
    changed_count = 0
    errors = []

    for root, dirs, files in os.walk(VAULT_PATH):
        # Skip hidden directories (e.g. .obsidian)
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))

        for filename in sorted(files):
            if not filename.endswith(".md"):
                continue

            path = os.path.join(root, filename)
            rel_path = os.path.relpath(path, VAULT_PATH)

            try:
                new_content, changed = process_note(path)
                count += 1

                if changed:
                    changed_count += 1
                    print(f"  {'(would update)' if DRY_RUN else 'updated'} {rel_path}")
                    if not DRY_RUN:
                        with open(path, "w", encoding="utf-8") as f:
                            f.write(new_content)

            except Exception as e:
                errors.append(f"{rel_path}: {e}")

    print(f"\n{'Would update' if DRY_RUN else 'Updated'} {changed_count} of {count} notes.")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for err in errors:
            print(f"  {err}")


if __name__ == "__main__":
    main()
