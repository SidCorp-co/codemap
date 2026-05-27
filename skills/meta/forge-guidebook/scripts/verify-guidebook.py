#!/usr/bin/env python3
"""Verify a generated guidebook: manifest shape + cross-references + links.

Usage:
    python3 verify-guidebook.py [outputDir]   # default: docs/guidebook

Exit code 0 = clean, 1 = errors found. Warnings do not fail the run.
Runs offline; only reads files under outputDir.
"""
import json
import re
import sys
from pathlib import Path

ROLES = {"any", "developer", "pm", "admin"}
STATUSES = {"pending", "captured", "reused"}
IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
LINK_RE = re.compile(r"(?<!\!)\[[^\]]*\]\(([^)]+)\)")

errors: list[str] = []
warnings: list[str] = []


def err(m: str) -> None:
    errors.append(m)


def warn(m: str) -> None:
    warnings.append(m)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/guidebook")
    if not out.is_dir():
        print(f"verify-guidebook: output dir not found: {out}")
        return 1

    # intro present
    if not (out / "intro.md").is_file():
        err("missing intro.md")

    # manifest parses
    man_path = out / "guidebook.json"
    if not man_path.is_file():
        print("verify-guidebook: missing guidebook.json")
        return 1
    try:
        man = json.loads(man_path.read_text())
    except json.JSONDecodeError as e:
        print(f"verify-guidebook: guidebook.json does not parse: {e}")
        return 1

    for key in ("project", "generatedAt", "nav", "journeys", "media"):
        if key not in man:
            err(f"manifest missing top-level key: {key}")

    # nav paths resolve
    def walk_nav(nodes: list, depth: int = 0) -> None:
        for n in nodes:
            p = n.get("path")
            if p and not (out / p).is_file():
                err(f"nav path does not exist: {p}")
            walk_nav(n.get("children", []), depth + 1)

    walk_nav(man.get("nav", []))

    # journeys: page exists, role valid, screens non-empty
    for j in man.get("journeys", []):
        page = j.get("page")
        if not page or not (out / page).is_file():
            err(f"journey '{j.get('id')}' page missing: {page}")
        if j.get("role") not in ROLES:
            err(f"journey '{j.get('id')}' invalid role: {j.get('role')}")
        if not j.get("screens"):
            warn(f"journey '{j.get('id')}' has no screens listed")

    # media slots: shape + status + path-on-disk when not pending
    slot_paths: set[str] = set()
    for m in man.get("media", []):
        mid = m.get("id", "<no-id>")
        for k in ("id", "page", "route", "recipe", "status", "path"):
            if k not in m:
                err(f"media '{mid}' missing field: {k}")
        if m.get("status") not in STATUSES:
            err(f"media '{mid}' invalid status: {m.get('status')}")
        if not isinstance(m.get("recipe", []), list):
            err(f"media '{mid}' recipe must be a list")
        mp = m.get("path")
        if mp:
            slot_paths.add(Path(mp).as_posix())
            if m.get("status") in ("captured", "reused") and not (out / mp).is_file():
                err(f"media '{mid}' status={m.get('status')} but file missing: {mp}")
        page = m.get("page")
        if page and not (out / page).is_file():
            err(f"media '{mid}' references missing page: {page}")

    # cross-ref: inline images <-> media slots; intra-doc links resolve
    referenced_imgs: set[str] = set()
    for md in out.rglob("*.md"):
        text = md.read_text()
        base = md.parent
        for ref in IMG_RE.findall(text):
            resolved = (base / ref).resolve()
            try:
                rel = resolved.relative_to(out.resolve()).as_posix()
            except ValueError:
                warn(f"{md.name}: image ref escapes output dir: {ref}")
                continue
            referenced_imgs.add(rel)
            if rel not in slot_paths:
                err(f"{md.name}: image '{ref}' has no matching media slot")
        for ref in LINK_RE.findall(text):
            if ref.startswith(("http://", "https://", "#", "mailto:")):
                continue
            target = (base / ref.split("#")[0]).resolve()
            if not target.exists():
                err(f"{md.name}: dead link to {ref}")

    for sp in slot_paths - referenced_imgs:
        warn(f"media slot not referenced by any page: {sp}")

    # report
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print()
    if errors:
        print(f"verify-guidebook: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"verify-guidebook: clean ({len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
