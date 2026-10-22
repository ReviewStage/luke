import type { Element as HastElement, Nodes, Properties, RootContent } from "hast";
import { toHtml as hastToHtml } from "hast-util-to-html";

/**
 * inline-styles.ts -- the styles Pierre's diffs writes as markup, carried and applied through the CSSOM, which the panel's policy admits.
 *
 * The panel's policy is `style-src 'self'` (the desktop's
 * `renderer/index.html` and the web's `vercel.json`), which refuses an
 * inline `<style>` element and an inline `style` attribute parsed from
 * markup, and reports each one refused as an error on the console, which a
 * development run writes to its terminal (`main/window/renderer-errors.ts`).
 * Pierre draws a diff by writing its tree of elements as an HTML string
 * (`hast-util-to-html`'s `toHtml`) set into its shadow root, and writes
 * both: an inline style on each column (its `grid-row` span, without which
 * the gutter and the code fall out of step) and on each coloured token, and
 * a `<style>` element of the theme's colours.
 *
 * So the diff bundle answers Pierre's import of `toHtml` with this file's
 * (`scripts/build.mjs`), which writes each `style` as
 * `INLINE_STYLE_ATTRIBUTE` instead, leaving the tree Pierre handed as it
 * was, since Pierre keeps it to draw from again; and the shadow root is
 * watched (`adoptShadowStyles`), each element's style set as `style.cssText`
 * as it arrives, which is the CSSOM and not markup, and each `<style>`
 * adopted by the shadow root as a constructed sheet, as a terminal's are
 * (`../terminal/adopted-styles.ts`), between Pierre's own sheet and the
 * panel's look, which stays last. The policy still refuses the `<style>`
 * element itself, which the console reports once for each. Both are kept as
 * Pierre draws again, and let go when the diff is taken down.
 *
 * Note that an element's style is read once, when it arrives, because
 * Pierre writes its markup anew rather than editing an attribute in place.
 */

/** The attribute an element's inline style is written in, for the CSSOM to apply. */
const INLINE_STYLE_ATTRIBUTE = "data-inline-style";

/** The property `INLINE_STYLE_ATTRIBUTE` is in a hast element's properties. */
const INLINE_STYLE_PROPERTY = "dataInlineStyle";

/** What `toHtml` writes: a node, or a run of them, as Pierre hands a column's rows. */
type Tree = Nodes | RootContent[];

/** An element with its `style` moved into the data attribute, its children the same. */
function restyledElement(element: HastElement): HastElement {
  const { style, ...rest } = element.properties;
  const properties: Properties =
    style === undefined || style === null ? rest : { ...rest, [INLINE_STYLE_PROPERTY]: style };
  const children = element.children.map((child) =>
    child.type === "element" ? restyledElement(child) : child,
  );
  return { ...element, properties, children };
}

/** A node of a run with its styles moved, an element's and its children's; any other as it was. */
function restyledContent(node: RootContent): RootContent {
  return node.type === "element" ? restyledElement(node) : node;
}

/** `toHtml`, with every inline style written in `INLINE_STYLE_ATTRIBUTE`. */
export function toHtml(tree: Tree, options?: Parameters<typeof hastToHtml>[1]): string {
  if (Array.isArray(tree)) return hastToHtml(tree.map(restyledContent), options);
  if (tree.type === "root") {
    return hastToHtml({ ...tree, children: tree.children.map(restyledContent) }, options);
  }
  return hastToHtml(tree.type === "element" ? restyledElement(tree) : tree, options);
}

/** Sets the inline style written at and under `element` through the CSSOM. */
function restyle(element: Element): void {
  const selector = `[${INLINE_STYLE_ATTRIBUTE}]`;
  const styled = element.matches(selector) ? [element] : [];
  for (const each of [...styled, ...element.querySelectorAll(selector)]) {
    if (!(each instanceof HTMLElement || each instanceof SVGElement)) continue;
    each.style.cssText = each.getAttribute(INLINE_STYLE_ATTRIBUTE) ?? "";
  }
}

/** Whether a change under the root touched a `<style>` element's rules. */
function touchesStyle(record: MutationRecord): boolean {
  const target = record.target;
  return (
    target instanceof HTMLStyleElement ||
    target.parentNode instanceof HTMLStyleElement ||
    [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof HTMLStyleElement)
  );
}

/**
 * Applies what Pierre writes as markup under `root`, now and as it draws
 * again, with `look` adopted after it, until the answer is called.
 */
export function adoptShadowStyles(root: ShadowRoot, look: CSSStyleSheet): () => void {
  // Pierre's own sheet, adopted before anything here was.
  const own = root.adoptedStyleSheets.filter((sheet) => sheet !== look);
  const sheets = new Map<HTMLStyleElement, { sheet: CSSStyleSheet; text: string }>();
  const adopt = () => {
    const standing = new Set(root.querySelectorAll("style"));
    for (const style of sheets.keys()) if (!standing.has(style)) sheets.delete(style);
    for (const style of standing) {
      const text = style.textContent ?? "";
      const held = sheets.get(style);
      if (held?.text === text) continue;
      const sheet = held?.sheet ?? new CSSStyleSheet();
      sheet.replaceSync(text);
      sheets.set(style, { sheet, text });
    }
    root.adoptedStyleSheets = [...own, ...[...sheets.values()].map((held) => held.sheet), look];
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) restyle(node);
    }
    if (records.some(touchesStyle)) adopt();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  for (const child of root.children) restyle(child);
  adopt();
  return () => {
    observer.disconnect();
    root.adoptedStyleSheets = own;
  };
}
