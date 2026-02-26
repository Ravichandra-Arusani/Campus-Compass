#!/usr/bin/env python3
"""
Move root-level debug artifacts to a backup folder outside the project.

Default mode is dry-run. Use --apply to perform moves.
"""

from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


DEBUG_IMAGE_MARKERS = (
    ".built.",
    "debug-",
    "route-",
    "campusmap-",
    "campus-graph-",
    "nirmithi-",
    "vbit-buildings-update",
)
DEBUG_TEXT_FILES = {
    "osrm-debug-log.txt",
}
SAFE_OUTPUT_DIRS = {
    "dist",
    "test-results",
}


def is_debug_image(path: Path) -> bool:
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        return False
    name = path.name.lower()
    return any(marker in name for marker in DEBUG_IMAGE_MARKERS)


def is_candidate_file(path: Path) -> bool:
    name = path.name.lower()
    if path.suffix.lower() == ".log":
        return True
    if name in DEBUG_TEXT_FILES:
        return True
    return is_debug_image(path)


def get_unique_destination(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    index = 1
    while True:
        candidate = path.with_name(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def collect_candidates(project_root: Path, include_dirs: bool) -> list[Path]:
    candidates: list[Path] = []
    for child in project_root.iterdir():
        if child.is_file() and is_candidate_file(child):
            candidates.append(child)
        elif include_dirs and child.is_dir() and child.name in SAFE_OUTPUT_DIRS:
            candidates.append(child)
    return sorted(candidates, key=lambda p: p.name.lower())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Move root-level debug artifacts to an external backup folder."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the move. Without this flag, only prints what would move.",
    )
    parser.add_argument(
        "--include-dirs",
        action="store_true",
        help="Also move safe generated folders (dist/, test-results/).",
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Project root to clean. Default: current directory.",
    )
    parser.add_argument(
        "--backup-root",
        default=None,
        help="Base backup folder. Default: ../temp_backup",
    )
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    if not project_root.exists():
        raise SystemExit(f"Project root does not exist: {project_root}")

    backup_root = (
        Path(args.backup_root).resolve()
        if args.backup_root
        else (project_root.parent / "temp_backup").resolve()
    )
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = backup_root / f"{project_root.name}-{timestamp}"

    candidates = collect_candidates(project_root, include_dirs=args.include_dirs)
    if not candidates:
        print("No matching root artifacts found.")
        return 0

    print(f"Project root: {project_root}")
    print(f"Backup folder: {backup_dir}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    print("")
    for path in candidates:
        kind = "DIR " if path.is_dir() else "FILE"
        print(f"{kind}  {path.name}")

    if not args.apply:
        print("")
        print("Dry-run only. Re-run with --apply to move these items.")
        return 0

    backup_dir.mkdir(parents=True, exist_ok=True)
    moved = 0
    for source in candidates:
        destination = get_unique_destination(backup_dir / source.name)
        shutil.move(str(source), str(destination))
        moved += 1

    print("")
    print(f"Moved {moved} item(s) to: {backup_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
