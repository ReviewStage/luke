/**
 * stylesheet.d.ts -- a bundle's entry imports its own stylesheet, for its side effect alone.
 *
 * A Terminal tab's entry imports its `index.css`, which the bundler loads
 * beside the entry's code (the desktop's `scripts/build.mjs`'s
 * `sideStylesheetsLinked`); nothing is read from the import.
 */
declare module "*.css" {}
