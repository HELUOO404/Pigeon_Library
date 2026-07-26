# Runtime QA Screenshots

These screenshots are reproducible visual checks for the offline-media extension.

- `learn-desktop.png`: real PigeonLib learning page with the existing built-in package fully loaded.
- `learn-mobile.png`: mobile learning page after raw HTML containment; wide course media remains inside its own scrollable content area and does not widen the page.
- `step-simulation-desktop.png`: initial desktop step-video state; later steps and Continue are locked.
- `step-simulation-mobile.png`: true 390px Chrome device-emulation layout with the media above the steps; automated bounds checks prove zero horizontal overflow.
- `step-simulation-verified.png`: simulated correct selection plus media-ended state; the status reports tail-frame hold and Continue is enabled while the next step remains locked.

The QA fixture is `app/offline-runtime-qa.html`. It imports the same renderer and interaction module used by `learn.html`; it is not part of any course package. `scripts/capture-runtime-qa.mjs` applies exact device metrics and fails on document or component overflow. The verified screenshot uses a simulated successful media event; real captured Experiment 43 media must still receive playback, decode, tail-frame, and continuation checks after download.
