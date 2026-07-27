#!/usr/bin/env python3
"""Generate lossless WebP siblings for web delivery images without modifying source assets."""
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "dist-courses" / "2026-vocational-preliminary"
COURSES = {"2026-ic-manufacturing", "2026-ic-devices", "2026-ic-packaging"}
EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp"}

only = set(sys.argv[1:]) or COURSES
unknown = only - COURSES
if unknown:
    raise SystemExit(f"unknown course id: {', '.join(sorted(unknown))}")

for course_id in sorted(only):
    image_dir = BASE / course_id / "assets" / "images"
    if not image_dir.is_dir():
        raise SystemExit(f"missing image directory: {image_dir}")
    source_bytes = output_bytes = count = 0
    for source in sorted(image_dir.iterdir()):
        if source.suffix.lower() not in EXTENSIONS or not source.is_file():
            continue
        target = source.with_name(f"{source.name}.webp")
        with Image.open(source) as image:
            image.save(target, "WEBP", lossless=True, method=6, exact=True)
        source_bytes += source.stat().st_size
        output_bytes += target.stat().st_size
        count += 1
    ratio = output_bytes / source_bytes if source_bytes else 0
    print(f"{course_id}: {count} images, {source_bytes} -> {output_bytes} bytes ({ratio:.1%})")
