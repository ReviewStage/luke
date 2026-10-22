/**
 * stylesheet-text.d.ts -- a test reads one of the panel's stylesheets as its text.
 *
 * `container-width.ts` imports each of the panel's sheets with Vite's `?raw`,
 * and the shared components' with `?inline`, its imports inlined, which
 * vitest answers with the text where the suite's `css.include` names it
 * (`vitest.config.ts`), so it reads them without `node:fs`.
 */
declare module "*.css?raw" {
  const text: string;
  export default text;
}

declare module "*.css?inline" {
  const text: string;
  export default text;
}
