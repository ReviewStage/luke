/**
 * style-element-sheets.ts -- the `<style>` elements a library writes under a root, said again as constructed sheets, which the panel's policy admits.
 *
 * The panel's policy is `style-src 'self'`, which refuses an inline `<style>`
 * element, and both a terminal (`terminal/adopted-styles.ts`) and a diff
 * (`diff-view/inline-styles.ts`) write some. A constructed sheet is not
 * inline markup, so each adopts the sheets kept here where its own root
 * reads them: the document for a terminal, the shadow root for a diff.
 */

/** Whether a change under the root touched a `<style>` element's rules. */
export function touchesStyle(record: MutationRecord): boolean {
  const target = record.target;
  return (
    target instanceof HTMLStyleElement ||
    target.parentNode instanceof HTMLStyleElement ||
    [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof HTMLStyleElement)
  );
}

/**
 * A reading of the `<style>` elements under `root` as sheets: each call
 * answers one sheet for each element standing, rewritten where its rules
 * changed, and lets go of the sheet of each element gone.
 */
export function styleElementSheets(root: ParentNode): () => CSSStyleSheet[] {
  const sheets = new Map<HTMLStyleElement, { sheet: CSSStyleSheet; text: string }>();
  return () => {
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
    return [...sheets.values()].map((held) => held.sheet);
  };
}
