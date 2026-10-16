/**
 * stylesheet.d.ts -- a stylesheet is imported for its side effect alone: the
 * bundler that loads a module (Vite in the browser tests and the catalog,
 * esbuild in the desktop) puts the sheet on the page, and nothing is bound.
 */
declare module "*.css";
