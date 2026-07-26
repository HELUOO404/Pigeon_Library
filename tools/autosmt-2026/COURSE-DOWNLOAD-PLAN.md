# 2026 Course Download Plan

Status: exploration complete. Do not begin bulk capture until the score gate below is green.

## Current Score Gate

The included scope excludes homework 10, experiments 20-21, and engineering 3-4 and 7-8. Existing evidence verifies all other homework and most experiments/engineering activities at 100 with a reopened zero-blank audit.

The remaining work is:

| Activity | Current evidence | Required next action |
| --- | --- | --- |
| Experiment 24 | 83.33, every control saved | Repair the two incorrect current-site candidate values, replay all fields, then audit. |
| Experiment 25 | 99.19, every control saved | Locate the one changed candidate against current options, replay all fields, then audit. |
| Experiments 26-28 | Candidate text fully matches current options, not yet score-verified | Replay each activity separately and audit after each score read. |
| Experiments 29-31 | 0, full mapping not yet reconstructed | Finish screenshot-to-current-option mapping before any submission. |

The local session guard has stopped. Restart `launch/启动AutoSMT会话守护.bat` and enter credentials locally before processing queued or new jobs. The guard must be the only process that talks to the logged-in site. No credential file or cookie export is permitted.

The immutable completion condition for every included activity is both:

1. A fresh website score page reports `100.00`.
2. A reopened raw activity page has zero blank answer controls on every answer-bearing tab.

## Download Scope

The planned deliverables are exactly:

| Course ID | Exact title | Source chapters |
| --- | --- | --- |
| `2026-ic-manufacturing` | `2026职业赛道初赛IC制造` | 1 |
| `2026-ic-devices` | `2026职业赛道初赛IC器件` | 2-3 |
| `2026-ic-packaging` | `2026职业赛道初赛IC封装` | 4-6 |

The title values intentionally do not contain `课程包`.

All 28 sections must be captured. Each section has the four common source areas: overview, theory, lecture video, and homework; its assigned experiment/engineering tabs are captured in addition. A tab with no question controls is still course material and is not skipped.

## Evidence From Exploration

- `reports/section-activity-index.json` records all 28 section menus.
- `reports/activity-details/` contains 80 raw tabs for all 49 in-scope activities, including experiment 1's four tabs and experiment 9's non-question first tab.
- `scripts/build-activity-resource-inventory.mjs` currently finds 105 direct resource references and 54 pages with dynamic video endpoints.
- Dynamic clips are resolved from authenticated `PlayVideo.php?videoId=...` calls; direct HTML attributes alone are insufficient.
- `scripts/audit-capture-integrity.mjs` currently passes for the 49 activities, 80 tabs, and 62 answer-bearing pages.

## Capture Procedure

1. Finish the score gate above and save a fresh score snapshot plus all page-state audits.
2. Under the single guard session, visit every chapter/section and request the current HTML for overview, theory, lecture video, homework, and every activity menu/subtab. Store raw response bytes, request metadata, and a stable section/component key under `reports/source-capture/`; do not normalize source text at this stage.
3. Parse every captured HTML resource reference (`src`, `poster`, `href`, `srcset`, CSS URLs, iframe source, script and stylesheet dependencies). Download each authenticated same-origin resource once into a hash-addressed capture store and record original URL, local path, MIME type, byte size, SHA-256, and referring pages.
4. Resolve each of the 54 dynamic video pages through the exact page-declared endpoint and every verified simulation action. Save the returned clip IDs, media bytes, poster/tail-frame source, and ordering. For experiment 43, preserve each verified step's ordered clip list and answer gate; do not merge clips into one unlabelled video.
5. For simulations, retain the raw page HTML, local copies of every referenced JS/CSS/image/font/video dependency, and a dependency manifest. Relative URLs must be rewritten only in the packaged copy, never in the raw snapshot.
6. Run a resource closure audit: no unresolved same-origin references, no external URL in a course source, no duplicate asset with mismatched content, and no unrecorded dynamic clip.

## Course Authoring And Packaging

1. Build three independent sources below `courses/2026-vocational-preliminary/` using the exact chapter split above.
2. Transcribe website text verbatim into structured blocks. Keep original tables as HTML when their merged cells or fixed layout would be lost; keep interactive pages as sandbox blocks unless they match the existing `stepSimulation` contract.
3. Put all answer explanations in separate enhancement fields. Never rewrite source body text, question wording, options, table cells, or media captions.
4. Map normal lecture media to `video` blocks. Map experiment 43 to `stepSimulation`: one compact dropdown per step, correct-answer gate, noninteractive local clip playback, terminal frame retained, and next step unlocked only after correct completion.
5. Run the Pigeon fidelity gate, resource closure checks, and `build-course-delivery.mjs` for each course. Produce both the deployment package with sibling media and the portable `.full.pigeon` backup.

## Mandatory Acceptance Checks

Before delivery, run:

```powershell
node tools/autosmt-2026/scripts/audit-capture-integrity.mjs
node tools/autosmt-2026/scripts/test-step-simulation.mjs
node tools/autosmt-2026/scripts/test-pigeon-media-loader.mjs
node tools/autosmt-2026/scripts/test-offline-content-renderer.mjs
node tools/autosmt-2026/scripts/test-fidelity-media.mjs
node tools/autosmt-2026/scripts/test-course-delivery.mjs
node tools/autosmt-2026/scripts/capture-runtime-qa.mjs
cd app
npm.cmd run build
```

Then use browser screenshots and network logs to prove, for all three courses:

- images render and tables do not overflow or misalign on desktop and mobile;
- lecture videos and captured simulation clips play offline;
- sandbox dependencies load from package-local files only;
- experiment 43 rejects a wrong selection, plays the verified clip for a correct selection, retains its tail frame, and unlocks the next dropdown;
- no course text or question differs from the current website source.

Bulk download has intentionally not started. This plan is the handoff point requested by the user.
