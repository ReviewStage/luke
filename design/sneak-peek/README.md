# Sneak peek

A self-playing teaser of Luke living in the notch: the bare housing, the
capsule arriving, the peek, the session panel, a spoken notice, and a wink out
to the wordmark. Twenty-six seconds, then it holds on the end card.

The page is built from the product's own committed sources so it cannot drift
from what ships: the springs and durations come from
`packages/sidecar-core/src/motion-tokens.css`, every face gesture from
`apps/desktop/src/renderer/styles/face-motion.css`, the surface geometry and
type from the marketing mock's port of the renderer, the provider marks from
`packages/sidecar-core/src/provider-mark-paths.ts`, and the six sessions are
the smoke fixture's own synthetic rows.

## Watch it

Open `index.html` in a browser. It plays once on load; reload to replay.

## Record it

The recorder drives the page frame by frame under CDP virtual time, so the
capture is deterministic no matter how fast the machine renders. It needs
`puppeteer-core` on the module path and the old headless implementation,
which ships separately:

```sh
npm install puppeteer-core
npx @puppeteer/browsers install chrome-headless-shell@stable
CHROME_SHELL=<path printed above> node record.mjs
```

Frames land in `frames/` as PNGs; assemble them with ffmpeg:

```sh
ffmpeg -framerate 30 -i frames/frame-%04d.png \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart \
  luke-sneak-peek.mp4
```

Keep every rendering output out of the repository: frames, videos, GIFs, and
posters are generated evidence and belong under `artifacts/` or outside the
tree entirely.
