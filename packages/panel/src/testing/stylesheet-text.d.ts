/**
 * stylesheet-text.d.ts -- a test reads one of the panel's stylesheets as its text.
 *
 * `container-width.ts` imports each sheet with Vite's `?raw`, which vitest
 * answers with the file's text where the suite's `css.include` names it
 * (`vitest.config.ts`), so it reads them without `node:fs`.
 */
declare module "*.css?raw" {
  const text: string;
  export default text;
}
