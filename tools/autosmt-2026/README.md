# AutoSMT 2026 Course Capture Workbench

This directory is the self-contained work area for the 2026 vocational preliminary course capture. It keeps the reusable scripts, raw website snapshots, score checkpoints, candidate evidence, launchers, and handoff record together.

## Layout

- `scripts/`: Node and PowerShell tools. They resolve the repository root internally and do not require a fixed terminal directory.
- `archive/`: retired tools retained for historical audit only; nothing in this directory is an active conversion entry point.
- `launch/`: one-click Windows launchers.
- `reports/`: raw menu/detail HTML, parsed metadata, score snapshots, checkpoints, candidate maps, and the local job queue.
- `CONVERSION.md`: the authoritative AutoSMT-to-Pigeon conversion rules, hard stops, and delivery gates.
- `REBUILD-REQUIREMENTS.md`: the confirmed product requirements summarized before conversion rules were finalized.
- `HANDOFF.md`: the historical capture status and resume checklist; conversion decisions defer to `CONVERSION.md`.

## Security

No account password is stored in this directory. `launch/启动AutoSMT会话守护.bat` asks locally once and keeps its session only in the running PowerShell process. Closing the guard window or restarting Windows clears it.

## Normal Operation

1. Start `launch/启动AutoSMT会话守护.bat` and enter credentials locally.
2. Launch scripts add jobs to `reports/autosmt-jobs/pending/`.
3. The guard executes one job at a time. Checkpoints are written after each completed unit.
4. Stop the guard before changing queue order or modifying answer logic.

On startup, after confirming no live lock exists, the guard returns any interrupted `running/` jobs to `pending/` automatically. This makes a forced Windows/process stop resumable without treating a partial job as complete.

The guard does not save credentials, cookies, or a reusable secret file. A stale `reports/autosmt-jobs/session-guard.lock` means a guard was interrupted and must be removed only after confirming its process has stopped.

## Key Scripts

There is currently no approved full-course generation script. The retired `archive/build-course-content-legacy.mjs` must not be run; implement a new converter only after the golden sample passes the gates in `CONVERSION.md`.

- `scripts/autosmt-score-gate.mjs`: login-scoped capture, score parsing, answer verification, activity detail capture, and checkpoints.
- `scripts/autosmt-score-gate.mjs capture-runtime-responses`: read-only runtime evidence capture for Experiment 22 `CZNDJS` (all 81 `data1`/`data2` pairs), Experiment 33/34 `LD`, and Experiment 7 tab 1 plus Experiment 16 tabs 1/2 `btn_wdqxfz` temperature curves; it checkpoints the located activity/tab, request parameters, exact raw response, parsed value, finite numeric projection, and SHA-256, and stops on login HTML, empty or malformed responses, duplicate activity/request contexts, or matching Experiment 33/34 `LD` responses.
- `scripts/run-autosmt-session-worker.ps1`: single local authorization guard and serialized job runner.
- `scripts/enqueue-autosmt-job.ps1`: adds a credential-free job JSON file to the local queue.
- `scripts/build-autosmt-section-index.mjs`: derives included experiment/engineering targets from captured section menus.
- `scripts/index-autosmt-reference-images.mjs`: indexes prior-year image evidence.
- `scripts/build-course-delivery.mjs`: produces a deployment package, sibling local media, and portable full backup once a course source is complete.
- `scripts/build-activity-resource-inventory.mjs`: derives direct asset references and dynamic PHP/video endpoints from every saved activity tab without changing the raw snapshots.
- `scripts/audit-capture-integrity.mjs`: hard-checks the 49-activity scope, all 80 tab pairs, progress coverage, Experiment 1/9 tab structure, answer-bearing page count, and resource-inventory coverage.
- `scripts/test-pigeon-media-loader.mjs` and `scripts/test-step-simulation.mjs`: local runtime regression checks for the offline-media extension.
- `scripts/test-offline-content-renderer.mjs`: verifies package-relative HTML resources using both quote styles and local video asset resolution.
- `scripts/test-fidelity-media.mjs`: verifies that the project fidelity gate covers video titles, HTML/sandbox visible text, and step questions/options stored in source-page scripts.
- `scripts/test-course-delivery.mjs`: builds and removes a temporary course to verify resource-closure checks, split asset delivery (all `assets/` paths, including images/media/simulations), the full backup, assetBase, and SHA-256 reporting.
- `scripts/optimize-delivery-images.py`: after delivery build, generates lossless `.webp` siblings for PNG/JPEG/BMP images; the web renderer prefers these variants and falls back to originals. Requires Pillow.
- `scripts/capture-runtime-qa.mjs`: uses Chrome DevTools device emulation to capture desktop/mobile simulation screenshots and fail on any horizontal overflow or clipped component bounds.

## Evidence Rules

The current website and its score page are authoritative. `reports/legacy-candidate-*` files are candidate evidence only. Their values can reduce trials, but every activity must still be confirmed as `100.00` on the website before course content/media extraction begins.

Do not edit raw `reports/activity-details/*.html` snapshots. They preserve the exact source text, question controls, script behavior, media references, and tab boundaries used for fidelity checks.
