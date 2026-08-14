# Luke brand assets

Luke's identity is the **L-face**: a monoline capital-L nose that curls into a smile,
with two eyes above it. The wordmark is **face-first caps** — the face *is* the L,
followed by custom U·K·E letterforms weight-matched to the face's stroke.

Everything here is generated. Do not hand-edit the SVGs; instead tweak the parameters
in `design/generate-brand-assets.mjs` and re-run:

```sh
node design/generate-brand-assets.mjs
```

PNG derivatives are rasterized from the SVGs (any SVG renderer works; these were made
with `rsvg-convert`):

```sh
cd design/brand
for m in light dark; do
  for s in 16 32 64 128 256 512 1024; do
    rsvg-convert -w $s -h $s icon/luke-icon-$m.svg -o icon/luke-icon-$m-$s.png
  done
done
rsvg-convert -w 18 -h 18 menubar/luke-menubar-template.svg -o menubar/lukeTemplate.png
rsvg-convert -w 36 -h 36 menubar/luke-menubar-template.svg -o menubar/lukeTemplate@2x.png
rsvg-convert -w 660 -h 400 dmg/luke-dmg-background.svg -o dmg/luke-dmg-background.png
rsvg-convert -w 1320 -h 800 dmg/luke-dmg-background.svg -o dmg/luke-dmg-background@2x.png
```

## In the app

`menubar/lukeTemplate{,@2x}.png` is copied into the desktop app's `dist/menubar/`
by `apps/desktop/scripts/build.mjs` and handed to `Tray`, and
`icon/luke-icon-{light,dark}-512.png` are copied into `dist/icon/` and handed to
`app.dock.setIcon` — the two pieces of artwork the app loads from files, because
macOS status items and the Dock take a `NativeImage` rather than markup. The
menu-bar template is recolored by the system; the Dock tile is not, so the app
swaps it between the two mode icons as the theme changes.

The notch panel draws the face itself rather than loading these SVGs, because it
needs two things a baked asset cannot give it: `currentColor`, so one drawing
serves the menu bar and the notch and can take the microphone's colour, and CSS
animation, so the renderer's `--face-motion` token can hold every loop still for
a capture run or for reduced motion. SMIL answers to neither without JavaScript.

So the generator emits its two inputs as well, from the same table these SVGs are
cut from — they are generated files and are not to be hand-edited either:

| File | What it carries |
|---|---|
| `apps/desktop/src/renderer/luke-face-art.ts` | The geometry, the motion names, their cycle lengths, and which parts each one needs drawn |
| `apps/desktop/src/renderer/styles/face-motion.css` | One `@keyframes` per moving part, with each interval's easing |

`scripts/repository-checks.sh` runs `generate-brand-assets.mjs --check`, which
compares every committed output against what the script produces now and fails if
any of them has drifted.

## Modes

`-dark` assets are light ink (`#f5f5f7`) for dark UIs; `-light` assets are near-black
(`#1d1d1f`) for light UIs. The brand accent, when one is needed, is Apple system blue
`#0A84FF`. The app icon follows the same naming: a space-black tile with a white face
for dark mode, a porcelain tile with a near-black face for light. The packaged `.icns`
is cut from the dark set, which reads on either desktop; the running app swaps the
Dock image between the two.

## Sizing

Asset viewBoxes are computed from the artwork's bounding box, not the drawing canvas:
static marks and wordmarks are trimmed tight (+6 units padding), the app-icon glyph
spans ~58% of the tile width (typical macOS glyph-in-tile proportion), and the
menu-bar template fills ~90% of its square canvas. Only the animated `motion/` marks
keep the full 240×240 canvas — they need headroom to move.

## Files

| File | Use |
|---|---|
| `luke-mark-{light,dark}.svg` | The static face mark |
| `luke-wordmark-{light,dark}.svg` | Face-first caps LUKE wordmark |
| `luke-wordmark-talking-{light,dark}.svg` | Animated hero: the face talks mid-word |
| `icon/luke-icon-{light,dark}.svg` + `luke-icon-{light,dark}-{16…1024}.png` | App icon (squircle tile), per mode |
| `menubar/luke-menubar-template.svg` + `lukeTemplate{,@2x}.png` | macOS menu-bar template image (pure black + alpha; macOS recolors it). Packaging builds `Luke.icns` from the dark icon PNGs automatically in `apps/desktop/scripts/package.mjs`; no `.icns` is committed |
| `dmg/luke-dmg-background.svg` + `luke-dmg-background{,@2x}.png` | Neutral installer background with a branded drag-and-drop arrow |
| `motion/luke-<state>-{light,dark}.svg` | Animated state marks (below) |

## Motion states

Animations are SMIL, baked into each SVG — they play anywhere SVG animation is
supported (browsers, most macOS contexts) and survive copy/paste. Motion is always
whole-head or eyes-only; the mouth never morphs (chosen deliberately — mouth morphing
read as unnatural).

Where each one is used in the app is in the README at the repository root; the
three the app has no moment for are noted there too.

| State file | Product moment |
|---|---|
| `talking` | speaking / narrating (head bob) |
| `yes` | acknowledged (nod) |
| `error` | something went wrong (shimmy) |
| `reviewing` | inspecting a session (wince-like squint) |
| `success` | task done (squash-and-stretch hop) |
| `listening` | curious tilt |
| `idle` | double blink |
| `notification` | attention caught by something new (brow flash) |
| `wink` | confirmation / easter egg |
| `sleeping` | nothing to watch (lids down, zzz) |
| `refresh` | relaunch (one pirouette) |
| `boop` | tap feedback (puff) |
| `monitoring` | humming along (slow sway) |
| `appear` | attaching (peek-slide in) |
| `attention` | attention caught (perk up) |
| `floating` | hovering idle |
| `hiding` | minimized (peekaboo duck) |
| `tease` | playful (brow waggle) |
| `waiting` | needs approval (fidget) |
