# Narrow-width render harness (from worker 365)

The real compiled Luke renderer in headless Chrome with a stubbed `window.luke` bridge and fixture answers.
File names encode paths: `__` = `/`.

1. In your checkout: `mkdir -p apps/desktop/.harness/areas/{base,plan}` and put the `desktop-.harness__*` files there (`desktop-.harness__areas__plan__area.ts` → `apps/desktop/.harness/areas/plan/area.ts`, …). Add `apps/desktop/.harness/` to `.git/info/exclude`.
2. Put the `harness__*` files in a folder of your own, e.g. `~/harness/` (`harness__plan__scenes.mjs` → `~/harness/plan/scenes.mjs`). `npm i puppeteer-core` there.
3. Fix the absolute paths: `stub.ts`'s and `build.mjs`'s outfile (`/home/vercel-sandbox/harness/stub-<area>.js`), `shoot.mjs`'s default `--dist`, and README paths.
4. Build: `node apps/desktop/scripts/build.mjs` (renderer) then `node apps/desktop/.harness/build.mjs plan` (stub).
5. Shoot: `node ~/harness/shoot.mjs --dist <checkout>/apps/desktop/dist/renderer --scenes ~/harness/plan/scenes.mjs --stub ~/harness/stub-plan.js --out ~/harness/out --only side-changes--panel280`.
   `--force-themes 1` shoots light and dark for scenes pinned to one theme.

Floors: main280 = window 1160, sidebar widest, panel End; panel280 = window 760, panel Home; side-panel narrow layout is `@container side-panel (max-width: 359px)`.
