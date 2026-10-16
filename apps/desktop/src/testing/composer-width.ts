import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * composer-width.ts -- the window's stylesheets as a composer card of one width reads them, for jsdom, which lays nothing out and answers no container query.
 *
 * The composer's foot answers its card's width through `@container
 * composer (max-width: …)` rules (planning.css). jsdom drops a container
 * query whole, so `composerStylesAt` hands back the stylesheets with each
 * such rule resolved for a card of the width asked: its rules standing
 * where the card is that narrow, and gone where it is wider. Laid into the
 * test's document, they let `getComputedStyle` say what the foot shows at
 * that width, which `shown` reads up the element's ancestors.
 */

const STYLES = path.join(import.meta.dirname, "../renderer/styles");

/** The composer's container queries, by the greatest card width each holds at. */
const COMPOSER_QUERY = /@container composer \(max-width: (\d+)px\) \{/g;

/** Where the block opened just before `from` closes, past its closing brace. */
function blockEnd(css: string, from: number): number {
  let depth = 1;
  let at = from;
  while (depth > 0 && at < css.length) {
    if (css[at] === "{") depth += 1;
    if (css[at] === "}") depth -= 1;
    at += 1;
  }
  return at;
}

/** A stylesheet with every composer query resolved for a card `width` pixels wide. */
function resolvedAt(css: string, width: number): string {
  let resolved = "";
  let from = 0;
  for (const query of css.matchAll(COMPOSER_QUERY)) {
    const open = query.index + query[0].length;
    const end = blockEnd(css, open);
    resolved += css.slice(from, query.index);
    if (width <= Number(query[1])) resolved += css.slice(open, end - 1);
    from = end;
  }
  return resolved + css.slice(from);
}

/** The panel's composer stylesheets, planning.css and desktop.css after it, as a card `width` pixels wide reads them. */
function composerStylesAt(width: number): string {
  return ["planning.css", "desktop.css"]
    .map((name) => resolvedAt(readFileSync(path.join(STYLES, name), "utf8"), width))
    .join("\n");
}

/** Lays the stylesheets into the document for a card `width` pixels wide, answering the style element, which the caller removes. */
export function layComposerAt(width: number): HTMLStyleElement {
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = composerStylesAt(width);
  return style;
}

/** Whether an element is drawn at all: neither it nor any box around it is `display: none`. */
export function shown(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).display === "none") return false;
  }
  return true;
}
