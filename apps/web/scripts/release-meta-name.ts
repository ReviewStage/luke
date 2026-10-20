/**
 * release-meta-name.ts -- the name of the `<meta>` the app's page names its deployment's commit in.
 *
 * The build writes it (`release-meta.ts`) and the tab reads it
 * (`src/app/stale-release.ts`); it stands alone so the Vite config that
 * writes it loads nothing of the tab's.
 */

export const RELEASE_META = "luke-release";
