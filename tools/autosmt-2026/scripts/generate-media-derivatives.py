#!/usr/bin/env python3
"""Generate web delivery image variants and video posters into a staging directory."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from PIL import Image

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm", ".ogg"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def poster_path(media_path):
    relative = Path(media_path).relative_to("assets/media")
    return Path("assets/images/posters") / Path(f"{relative.as_posix()}.webp")


def generate_image_variants(course_dir, stage_dir):
    records = []
    image_root = course_dir / "assets" / "images"
    if not image_root.is_dir():
        return records
    for source in sorted(image_root.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        relative = source.relative_to(course_dir)
        image_relative = source.relative_to(image_root)
        target_relative = Path("assets/generated/images") / Path(f"{image_relative.as_posix()}.webp")
        target = stage_dir / target_relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            dimensions = image.size
            image.save(target, "WEBP", lossless=True, method=6, exact=True)
        with Image.open(target) as generated:
            if generated.size != dimensions:
                raise RuntimeError(f"WebP dimensions changed: {relative}")
        records.append({
            "kind": "image-webp",
            "source": relative.as_posix(),
            "path": target_relative.as_posix(),
            "width": dimensions[0],
            "height": dimensions[1],
            "bytes": target.stat().st_size,
            "sha256": digest(target),
        })
    return records


def collect_video_refs(value, output):
    if isinstance(value, list):
        for child in value:
            collect_video_refs(child, output)
        return
    if not isinstance(value, dict):
        return
    if value.get("type") == "video" and value.get("src") and not value.get("poster"):
        output.append((value, "src"))
    if value.get("type") == "stepSimulation":
        groups = value.get("groups") or [{"steps": value.get("steps") or []}]
        for group in groups:
            for step in group.get("steps") or []:
                if step.get("clip") and not step.get("poster") and not value.get("poster"):
                    output.append((step, "clip"))
    for child in value.values():
        collect_video_refs(child, output)


def ffmpeg_executable():
    executable = shutil.which("ffmpeg")
    if executable:
        return executable
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return None


def video_size(source):
    try:
        import imageio_ffmpeg
        frames = imageio_ffmpeg.read_frames(str(source), pix_fmt="rgb24")
        metadata = next(frames)
        frames.close()
        return tuple(metadata["size"])
    except (ImportError, KeyError, RuntimeError, StopIteration):
        return None


def generate_posters(course_dir, stage_dir, content):
    refs = []
    collect_video_refs(content, refs)
    refs = [(owner, key) for owner, key in refs if Path(str(owner[key])).suffix.lower() in VIDEO_EXTENSIONS]
    if not refs:
        return []
    ffmpeg = ffmpeg_executable()
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to generate video posters")
    records = []
    generated = {}
    for owner, key in refs:
        media_relative = Path(str(owner[key]).replace("\\", "/"))
        source = course_dir / media_relative
        if not source.is_file():
            raise RuntimeError(f"Missing poster source video: {media_relative.as_posix()}")
        target_relative = poster_path(media_relative)
        target = stage_dir / target_relative
        if target_relative not in generated:
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([
                ffmpeg, "-v", "error", "-ss", "0.5", "-i", str(source), "-frames:v", "1",
                "-vf", "scale='min(1280,iw)':-2", "-c:v", "libwebp", "-quality", "72",
                "-compression_level", "6", "-y", str(target),
            ], check=True)
            with Image.open(target) as poster:
                poster_width, poster_height = poster.size
            source_size = video_size(source)
            generated[target_relative] = {
                "kind": "video-poster",
                "source": media_relative.as_posix(),
                "path": target_relative.as_posix(),
                "capturedAtSeconds": 0.5,
                "sourceWidth": source_size[0] if source_size else None,
                "sourceHeight": source_size[1] if source_size else None,
                "width": poster_width,
                "height": poster_height,
                "bytes": target.stat().st_size,
                "sha256": digest(target),
            }
        owner["poster"] = target_relative.as_posix()
    records.extend(generated.values())
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--course-dir", required=True)
    parser.add_argument("--stage-dir", required=True)
    parser.add_argument("--content", required=True)
    parser.add_argument("--output-content", required=True)
    args = parser.parse_args()
    course_dir = Path(args.course_dir).resolve()
    stage_dir = Path(args.stage_dir).resolve()
    content = json.loads(Path(args.content).read_text(encoding="utf-8"))
    stage_dir.mkdir(parents=True, exist_ok=True)
    records = generate_image_variants(course_dir, stage_dir)
    records.extend(generate_posters(course_dir, stage_dir, content))
    Path(args.output_content).write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"records": records}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"media derivative generation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
