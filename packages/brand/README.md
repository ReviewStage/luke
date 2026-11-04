# Brand assets

The identity is the **Keel**: a disc cut by a narrow V that opens through its
top edge and cradles an island, in one color. Its V opens 25° off vertical
and meets on a round join 70% down the disc; the channel is 10.5% of the
disc; and every corner where the channel meets the rim, and the island's tip,
is rounded at 3%. Below 32 pixels a small cut takes over, its channel opened to
13.5% so the V still reads at 16. The wordmark is the name set in Geist
SemiBold at −2% tracking and outlined, the i's dot drawn round; in the lockup
the disc is 1.3 times the cap height, centered on it, a third of the disc from
the word.

The colors are the brand's: `scripts/brand-palette.mjs` is the one table
both generators read, so `@repo/ui`'s palette (`tokens/brand.css`) and the
artwork here are cut from the same values. A rebrand, or a second theme, is a
change of that table.

Everything here is generated. Do not hand-edit the SVGs; change the constants in
`scripts/generate-brand-assets.mjs` (the mark, the wordmark, the layouts) or
`scripts/brand-palette.mjs` (the colors), and re-run:

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
for m in light dark white monochrome color-light color-dark; do
  for s in 256 1024; do
    rsvg-convert -w $s -h $s mark/mark-$m.svg -o mark/mark-$m-$s.png
  done
done
for m in light dark black; do
  for s in 400 1024; do
    rsvg-convert -w $s -h $s avatar/avatar-$m.svg -o avatar/avatar-$m-$s.png
  done
done
for m in light dark black white; do
  for w in 512 4096; do
    rsvg-convert -w $w wordmark/wordmark-$m.svg -o wordmark/wordmark-$m-$w.png
  done
done
for m in light dark black white color-light color-dark; do
  for w in 512 4096; do
    rsvg-convert -w $w logo/logo-$m.svg -o logo/logo-$m-$w.png
  done
  for w in 512 2048; do
    rsvg-convert -w $w logo/logo-stacked-$m.svg -o logo/logo-stacked-$m-$w.png
  done
done
for g in dark light copper; do
  rsvg-convert -w 3168 -h 792 banner/banner-$g-4x1.svg -o banner/banner-$g-4x1.png
  rsvg-convert -w 3000 -h 1000 banner/banner-$g-3x1.svg -o banner/banner-$g-3x1.png
  rsvg-convert -w 4200 -h 700 banner/banner-$g-6x1.svg -o banner/banner-$g-6x1.png
  rsvg-convert -w 1800 -h 400 banner/banner-$g-9x2.svg -o banner/banner-$g-9x2.png
  rsvg-convert -w 3840 -h 2160 banner/banner-$g-16x9.svg -o banner/banner-$g-16x9.png
done
for d in hero keel terrain bloom; do
  for c in night ember chrome graphite rust paper ink sand copper kiln mono; do
    b=banner/dots/banner-dots-$d-$c
    rsvg-convert -w 3168 -h 792 $b-4x1.svg -o $b-4x1.png
    rsvg-convert -w 3000 -h 1000 $b-3x1.svg -o $b-3x1.png
    rsvg-convert -w 4200 -h 700 $b-6x1.svg -o $b-6x1.png
    rsvg-convert -w 3840 -h 2160 $b-16x9.svg -o $b-16x9.png
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
| `packages/brand/src/generated/brand-palette.ts` | `BRAND_PALETTE`: the brand's colors as plain values, written by `generate-surface-shared.mjs` from `brand-palette.mjs` |

The mark is static: it carries no motion.

## Assets

| File | Use |
|---|---|
| `wordmark/wordmark-{light,dark,black,white}.svg` + `-{512,4096}.png` | The name alone, outlined, in each mode's ink, and in pure black and pure white |
| `logo/logo-{light,dark,black,white}.svg` + `-{512,4096}.png` | The lockup, mark beside the name, on a transparent ground, for headers, docs, and decks: in each mode's ink, and in pure black and pure white for a partner, a printer, or a sponsor's wall that asks for exactly those |
| `logo/logo-color-{light,dark}.svg` + `-{512,4096}.png` | The lockup in color: the mark in the mode's copper beside the name in the mode's ink |
| `logo/logo-stacked-{light,dark,black,white,color-light,color-dark}.svg` + `-{512,2048}.png` | The stacked lockup, the disc twice the cap height centered over the name, on a transparent ground, for a square-ish space, in the same inks as the lockup |
| `icon/icon-{light,dark}.svg` + PNGs | The app icon on Apple's macOS grid: an 824-unit tile with a 185.4-unit corner on a 1024 canvas, the disc 78% of the tile (`ICON_MARK`, the one share every app icon takes). Dark: the night tile under the mark in copper. Light: the copper tile under a white mark. Flat, both |
| `mark/mark-{light,dark,white}.svg` + `-{256,1024}.png` | The mark alone, in each mode's ink or pure white on transparency, with a twelfth of the square's width as air on each side |
| `mark/mark-monochrome.svg` + `-{256,1024}.png` | The mark in pure black on transparency: the one-ink glyph a partner surface tints for its own theme, such as an integration's small icon on Sentry, which takes no color but black |
| `mark/mark-color-{light,dark}.svg` + `-{256,1024}.png` | The mark alone in each mode's copper on transparency, as the color logos draw it |
| `avatar/avatar-{light,dark,black}.svg` + `-{400,1024}.png` | The mark on a square tile: the icon's tile per mode, or white on flat black, with the disc at 78% of it, as in the app icons. For a profile photo, so the circle GitHub, X, Slack, and LinkedIn cut from it still leaves a ring round the rim, and for a surface that rounds a square's corners itself, GitHub's organization avatar among them. Cut at 400, the size X and LinkedIn ask for, and at 1024 |
| `banner/banner-{dark,light,copper}-{4x1,3x1,6x1,9x2,16x9}.svg` + `.png` | The lockup centered on a flat ground, for a cover, a background, or a logo slot: 4:1 for LinkedIn's profile background (1584×396, cut at 3168×792), 3:1 for X's header (1500×500, cut at 3000×1000), 6:1 for LinkedIn's company page cover (cut at 4200×700, the size LinkedIn asks for), 9:2 for a sidebar's logo slot such as Bookface's company card (cut at 1800×400, the lockup all but filling it), and 16:9 for a slide or a video call (cut at 3840×2160). Three grounds: each mode's, and the light icon's copper under white |
| `banner/dots/banner-dots-{design}-{colorway}-{4x1,3x1,6x1,16x9}.svg` + `.png` | The same covers, cut at the same sizes, drawn in the landing's dithered square dots. Four designs: `hero`, the mark as the landing's copper ball, lit from the upper left in dots packed close, beside a name set to the left; `keel`, that ball huge and running off the right edge; `terrain`, patches of noise round a centered name, clear in an ellipse round it; and `bloom`, dots blooming in from the top right and the bottom left. On the LinkedIn covers (4:1 and 6:1) the left-set name stands past the photo LinkedIn lays over the lower left. Eleven colorways, each in the brand table's inks or a mix of two of them: on the dark ground, `night` (one copper, the landing's own), `ember` (four coppers up to cream), `chrome` (the theme's grays), `graphite` (grays on the sidebar's near-black), and `rust` (coppers on a copper-tinted dark); on the light grounds, `paper` (coppers), `ink` (grays), and `sand` (two coppers on the sidebar's light), where the ball is drawn in its shadow; on copper, `copper` (one bright copper) and `kiln` (copper up to cream); and `mono`, white on black. No 9:2: its lockup leaves no room for the art |
| `icon/web-icon.svg` | The web app icon: the dark tile, full bleed, the disc 78% of it. The site's 180-pixel `apple-touch-icon.png` is cut from it, as are the manifest's `app-icon-{192,512}.png`, for Android's home screen as is and as maskable: the disc sits inside the 80% circle a mask keeps |
| `icon/favicon.svg` | The site's favicon: the dark tile with no Dock margin under the copper small cut, the disc 78% of the tile, so it reads at 16 pixels in a light tab and a dark one. Copied to `apps/web/public/favicon.svg` and packed at 16, 32, and 48 into `apps/web/public/favicon.ico` |
| `social/og-card.svg` | The 1200×630 link-preview card the web pages' `og:image` points at: the lockup on the dark ground. One card, dark only: a link preview follows no UI theme. Its PNG is cut into `apps/web/public/og-card.png`, which scrapers fetch from the site's root |
| `button/cta-download-{light,dark}.svg` | The download button, drawn as the site's primary button in each mode's accent, for a page that links the download |
| `dmg/dmg-background.svg` + PNGs | The disk image window's ground, with one round-ended arrow from the app to Applications, laid out by `scripts/dmg-window.mjs` |
