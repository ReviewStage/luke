import { styleElementSheets, touchesStyle } from "../style-element-sheets.js";

/**
 * adopted-styles.ts -- the rules a terminal writes into `<style>` elements of its own, adopted by the document as constructed sheets, which the panel's policy admits.
 *
 * The panel's policy is `style-src 'self'` (the desktop's
 * `renderer/index.html` and the web's `vercel.json`), which refuses an
 * inline `<style>` element, and xterm.js writes three of them inside the
 * element it draws in: the scrollbar's colours, and, where it draws without
 * WebGL, each cell's size and the theme's colours, without which its DOM
 * renderer draws nothing legible. A constructed stylesheet is not inline
 * markup, so the policy admits it, as it admits the file tree's
 * (`file-tree/index.ts`). So each `<style>` the terminal writes under its
 * root is said again as a sheet the document adopts, kept as the terminal
 * rewrites it, and dropped when the terminal is taken down. The policy
 * still refuses the element itself, which the console reports once for each.
 */

/**
 * Adopts the rules of every `<style>` element under `root`, now and as they
 * change, until the answer is called.
 */
export function adoptInlineStyles(root: HTMLElement): () => void {
  const sheets = styleElementSheets(root);
  // The sheets the document holds for this root, which the next adoption replaces.
  let adopted = new Set<CSSStyleSheet>();
  const others = () => document.adoptedStyleSheets.filter((sheet) => !adopted.has(sheet));
  const adopt = () => {
    const mine = new Set(sheets());
    document.adoptedStyleSheets = [...others(), ...mine];
    adopted = mine;
  };
  const observer = new MutationObserver((records) => {
    if (records.some(touchesStyle)) adopt();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  adopt();
  return () => {
    observer.disconnect();
    document.adoptedStyleSheets = others();
    adopted = new Set();
  };
}
