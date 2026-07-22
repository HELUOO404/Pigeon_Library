# Offline Media And Step Simulation Extension

This document supplements `docs/pigeon-format.md` for offline media used by the 2026 vocational preliminary course packages. Existing `schemaVersion: 1` packages remain valid.

## Asset Resolution

Package-relative paths are preferred. When a path is inside the `.pigeon` archive, the loader serves it through a Blob URL. This is suitable for images, short media, and fully portable backup archives. Supported local media extensions are `mp4`, `m4v`, `mov`, `webm`, `ogg`, and `vtt`.

For server deployment with large sibling media, set `manifest.assetBase` to a same-origin local base such as `/courses/<course-id>/`. Relative paths such as `assets/media/lecture-01.mp4` then resolve under that directory. A package-contained asset always takes precedence.

Complex simulation dependency trees belong under `assets/simulations/<simulation-id>/`. The delivery builder copies these directories unchanged beside the deployment package so relative JS imports, CSS URLs, fonts, JSON, and WASM stay valid without network access. List dynamically loaded files in the sandbox block's `dependencies` array so the resource-closure gate can verify them.

## Video Block

```jsonc
{
  "type": "video",
  "title": "Original source title",
  "src": "assets/media/lecture-01.mp4",
  "poster": "assets/images/lecture-01.jpg",
  "captions": "assets/media/lecture-01.vtt"
}
```

The player is native local HTML video. The source title, subtitles, and any text in the block are copied verbatim from the authoritative website.

## Step Simulation Block

```jsonc
{
  "type": "stepSimulation",
  "id": "exp-43-flow",
  "title": "Original source title",
  "steps": [
    {
      "prompt": "Original question text",
      "options": ["Original option A", "Original option B"],
      "answerIndex": 2,
      "clip": "assets/media/exp-43-step-01.mp4"
    }
  ]
}
```

`answerIndex` is one-based and must be the verified website answer. Practice mode presents one unlocked step at a time. A wrong selection reports only that it is incorrect; it never exposes the answer. A correct selection plays the non-interactive local clip, and playback completion keeps the final frame visible before the next step is enabled. Answer mode displays the verified answer sequence and plays each clip continuously.

In practice mode, every step is rendered as one dropdown. The active step is selectable, later steps remain disabled until unlocked, and a verified step keeps its selected answer. This keeps long process simulations compact without changing the source prompt or option wording.

The source extractor must retain the original page HTML, referenced scripts, clip ordering, question wording, options, and score-verified answer sequence in the course capture report before converting it to this block.

## Delivery Build

After a course source is complete, the delivery process produces:

- `dist-courses/<collection>/<course-id>/<course-id>.pigeon`: the deployment package, excluding large media and simulation dependency trees.
- `dist-courses/<collection>/<course-id>/assets/...`: sibling local media and simulations.
- `dist-courses/<collection>/<course-id>.full.pigeon`: the complete migration backup containing all resources.

The deployment package is intentionally not the migration backup. Do not replace the full archive with the smaller deployment package. The loader accepts a portable package up to 1GB; for large lecture-video collections, prefer the deployment package with same-origin sibling media to reduce browser memory pressure.
