#!/usr/bin/env python3
"""Rebuild course deliveries so lossless WebP variants remain manifest-verified."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
COURSES = {"2026-ic-manufacturing", "2026-ic-devices", "2026-ic-packaging"}
COLLECTION = "2026-vocational-preliminary"

only = set(sys.argv[1:]) or COURSES
unknown = only - COURSES
if unknown:
    raise SystemExit(f"unknown course id: {', '.join(sorted(unknown))}")

for course_id in sorted(only):
    subprocess.run([
        "node",
        str(ROOT / "tools" / "autosmt-2026" / "scripts" / "build-course-delivery.mjs"),
        course_id,
        "--collection",
        COLLECTION,
    ], cwd=ROOT, check=True)
