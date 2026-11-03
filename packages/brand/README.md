# Brand assets

The identity is the **Keel**: a disc cut by a narrow V that opens through its
top edge and cradles an island, in one colour. Its V opens 25° off vertical
and meets on a round join 70% down the disc; the channel is 10.5% of the
disc; and every corner where the channel meets the rim, and the island's tip,
is rounded at 3%. Below 32 pixels a small cut takes over, its channel opened to
13.5% so the V still reads at 16. The wordmark is the name set in Geist
SemiBold at −2% tracking and outlined, the i's dot drawn round; in the lockup
the disc is 1.3 times the cap height, centred on it, a third of the disc from
the word.

The colours are the brand's: `scripts/brand-palette.mjs` is the one table
both generators read, so `@repo/ui`'s palette (`tokens/brand.css`) and the
artwork here are cut from the same values. A rebrand, or a second theme, is a
change of that table.

Everything here is generated. Do not hand-edit the SVGs; change the constants in
`scripts/generate-brand-assets.mjs` (the mark, the wordmark, the layouts) or
`scripts/brand-palette.mjs` (the colours), and re-run:

```sh
pnpm --filter @repo/brand generate
```

PNG derivatives are rasterized from the SVGs with any SVG renderer; these were
cut with `rsvg-convert`'s equivalent in Chromium. Each icon PNG of 32 pixels or
smaller swaps the mark's path for its small cut (`MARK_ART.SMALL_PATH`):

```sh
cd packages/brand/assets
for s in 16 32 64 128 256 512 1024; do
  rsvg-convert -w $s -h $s icon/icon-dark.svg -o icon/icon-dark-$s.png
done
rsvg-convert -w 512 -h 512 icon/icon-light.svg -o icon/icon-light-512.png
for m in light dark; do
  rsvg-convert -w 1024 -h 1024 mark/mark-square-$m.svg -o mark/mark-square-$m-1024.png
  rsvg-convert -w 1024 -h 1024 mark/mark-square-transparent-$m.svg -o mark/mark-square-transparent-$m-1024.png
done
rsvg-convert -w 1024 -h 1024 mark/mark-square-black.svg -o mark/mark-square-black-1024.png
for s in 256 1024; do
  rsvg-convert -w $s -h $s mark/mark-square-monochrome.svg -o mark/mark-square-monochrome-$s.png
done
for m in light dark black; do
  for s in 400 1024; do
    rsvg-convert -w $s -h $s avatar/avatar-$m.svg -o avatar/avatar-$m-$s.png
  done
done
for m in light dark; do
  for w in 256 512; do
    rsvg-convert -w $w logo/logo-$m.svg -o logo/logo-$m-$w.png
  done
done
rsvg-convert -w 660 -h 400 dmg/dmg-background.svg -o dmg/dmg-background.png
rsvg-convert -w 1320 -h 800 dmg/dmg-background.svg -o dmg/dmg-background@2x.png
rsvg-convert -w 1200 -h 630 social/og-card.svg -o ../../../apps/web/public/og-card.png
cp icon/favicon.svg ../../../apps/web/public/favicon.svg
rsvg-convert -w 180 -h 180 icon/web-icon.svg -o ../../../apps/web/public/apple-touch-icon.png
for s in 192 512; do
  rsvg-convert -w $s -h $s icon/web-icon.svg -o ../../../apps/web/public/app-icon-$s.png
done
for s in 16 32 48; do rsvg-convert -w $s -h $s icon/favicon.svg -o /tmp/favicon-$s.png; done
# Pack the three into apps/web/public/favicon.ico with any ICO writer that
# stores PNG images.
```

## In the app

`icon/icon-{light,dark}-512.png` are copied into `dist/icon/` and handed to
`app.dock.setIcon`. The Dock tile is swapped between the two mode icons as the
theme changes; the packaged `.icns` is cut from the dark set.

The window draws the mark itself, with `@repo/ui`'s `ProductMark`, rather than
loading these SVGs, so it takes its holder's ink through `currentColor`. Its
geometry comes from this package as a generated file:

| File | What it holds |
|---|---|
| `packages/brand/src/generated/mark-art.ts` | `MARK_ART`: the mark's viewBox, its path, and its small cut |
| `packages/brand/src/generated/brand-palette.ts` | `BRAND_PALETTE`: the brand's colours as plain values, written by `generate-surface-shared.mjs` from `brand-palette.mjs` |

The mark is static: it carries no motion.

## Assets

| File | Use |
|---|---|
| `wordmark-{light,dark}.svg` | The name alone, outlined, per mode's ink |
| `logo/logo-{light,dark}.svg` + `-{256,512}.png` | The lockup, mark and name, on a transparent ground, for headers and docs |
| `icon/icon-{light,dark}.svg` + PNGs | The app icon on Apple's macOS grid: an 824-unit tile with a 185.4-unit corner on a 1024 canvas, the disc 78% of the tile (`ICON_MARK`, the one share every app icon takes). Dark: the night tile under the mark in copper. Light: the copper tile under a white mark. Flat, both |
| `mark/mark-square{,-transparent}-{light,dark}.svg` + `-1024.png` | The disc on a square canvas with a twelfth of air each side, per mode: over the icon's tile with square corners (for surfaces that round a square's corners themselves, GitHub's organization avatar among them), and in each mode's ink on transparency |
| `mark/mark-square-black.svg` + `-1024.png` | The white mark on flat pure black |
| `mark/mark-square-monochrome.svg` + `-{256,1024}.png` | The mark in pure black on transparency: the one-ink glyph a partner surface tints for its own theme, such as an integration's small icon on Sentry, which takes no colour but black |
| `avatar/avatar-{light,dark,black}.svg` + `-{400,1024}.png` | The profile photo: the icon's tile per mode, or flat black, with the disc at 78% of it, as in the app icons, so the circle GitHub, X, Slack, and LinkedIn cut from a profile photo still leaves a ring round the rim. Cut at 400, the size X and LinkedIn ask for, and at 1024 |
| `icon/web-icon.svg` | The web app icon: the dark tile, full bleed, the disc 78% of it. The site's 180-pixel `apple-touch-icon.png` is cut from it, as are the manifest's `app-icon-{192,512}.png`, for Android's home screen as is and as maskable: the disc sits inside the 80% circle a mask keeps |
| `icon/favicon.svg` | The site's favicon: the dark tile with no Dock margin under the copper small cut, the disc 78% of the tile, so it reads at 16 pixels in a light tab and a dark one. Copied to `apps/web/public/favicon.svg` and packed at 16, 32, and 48 into `apps/web/public/favicon.ico` |
| `social/og-card.svg` | The 1200×630 link-preview card the web pages' `og:image` points at: the lockup on the dark ground. One card, dark only: a link preview follows no UI theme. Its PNG is cut into `apps/web/public/og-card.png`, which scrapers fetch from the site's root |
| `button/cta-download-{light,dark}.svg` | The download button, drawn as the site's primary button in each mode's accent, for a page that links the download |
| `dmg/dmg-background.svg` + PNGs | The disk image window's ground, with one round-ended arrow from the app to Applications, laid out by `scripts/dmg-window.mjs` |
