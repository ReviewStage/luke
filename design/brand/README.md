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
for s in 16 32 64 128 256 512 1024; do
  rsvg-convert -w $s -h $s icon/luke-icon.svg -o icon/luke-icon-$s.png
done
rsvg-convert -w 18 -h 18 menubar/luke-menubar-template.svg -o menubar/lukeTemplate.png
rsvg-convert -w 36 -h 36 menubar/luke-menubar-template.svg -o menubar/lukeTemplate@2x.png
```

## Modes

`-dark` assets are light ink (`#f5f5f7`) for dark UIs; `-light` assets are near-black
(`#1d1d1f`) for light UIs. The brand accent, when one is needed, is Apple system blue
`#0A84FF`. The app icon uses a space-black tile with a white face and works on either
mode.

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
| `icon/luke-icon.svg` + `luke-icon-{16…1024}.png` | App icon (squircle tile) |
| `menubar/luke-menubar-template.svg` + `lukeTemplate{,@2x}.png` | macOS menu-bar template image (pure black + alpha; macOS recolors it). To build an `.icns`: put the icon PNGs in a `.iconset` folder and run `iconutil -c icns` on macOS |
| `motion/luke-<state>-{light,dark}.svg` | Animated state marks (below) |

## Motion states

Animations are SMIL, baked into each SVG — they play anywhere SVG animation is
supported (browsers, most macOS contexts) and survive copy/paste. Motion is always
whole-head or eyes-only; the mouth never morphs (chosen deliberately — mouth morphing
read as unnatural).

| State file | Product moment |
|---|---|
| `talking` | speaking / narrating (head bob) |
| `yes` | acknowledged (nod) |
| `error` | something went wrong (shimmy) |
| `reviewing` | inspecting a session (wince-like squint) |
| `success` | task done (squash-and-stretch hop) |
| `listening` | curious tilt |
| `idle` | double blink |
| `notification` | brow flash |
| `wink` | confirmation / easter egg |
| `sleeping` | paused session (lids down, zzz) |
| `refresh` | relaunch (one pirouette) |
| `boop` | tap feedback (puff) |
| `monitoring` | humming along (slow sway) |
| `appear` | attaching (peek-slide in) |
| `attention` | attention caught (perk up) |
| `floating` | hovering idle |
| `hiding` | minimized (peekaboo duck) |
| `tease` | playful (brow waggle) |
| `waiting` | needs approval (fidget) |

Full parameter provenance: `design/motion-selections.md`.
