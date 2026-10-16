import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * container-width.ts -- the window's stylesheets as named containers of given widths read them, for jsdom, which lays nothing out and answers no container query.
 *
 * A component that answers its own width does so through `@container <name>
 * (…)` rules: the composer's foot (planning.css), a banner's stacked layout
 * (desktop.css). jsdom drops a container query whole, so `layContainersAt`
 * hands back the stylesheets with each named query resolved for the widths
 * asked: its rules standing where the container is that narrow (or that
 * wide), and gone where it is not. A query on a container the test names no
 * width for is dropped, as jsdom would. Laid into the test's document, they
 * let `getComputedStyle` say what the component draws at that width, which
 * `shown` reads up the element's ancestors.
 */

const STYLES = path.join(import.meta.dirname, "../renderer/styles");

/** The panel's stylesheets, in the order `index.css` imports them. */
const SHEETS = ["settings.css", "base.css", "markdown.css", "planning.css", "desktop.css"] as const;

/** A named container query with one width condition: its name, its comparison, and its length. */
const NAMED_QUERY =
  /@container ([a-z-]+) \((?:(max-width|min-width): (\d+)px|width (<|<=|>|>=) (\d+)px)\) \{/g;

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

/** Whether a container `width` pixels wide meets the query's one condition. */
function holds(width: number, comparison: string, length: number): boolean {
  if (comparison === "max-width" || comparison === "<=") return width <= length;
  if (comparison === "min-width" || comparison === ">=") return width >= length;
  if (comparison === "<") return width < length;
  return width > length;
}

/** A stylesheet with every named query resolved for the widths given, by container name. */
function resolvedAt(css: string, widths: Readonly<Record<string, number>>): string {
  let resolved = "";
  let from = 0;
  for (const query of css.matchAll(NAMED_QUERY)) {
    const [whole, name = "", word, wordLength, sign, signLength] = query;
    const open = query.index + whole.length;
    const end = blockEnd(css, open);
    const width = widths[name];
    const comparison = word ?? sign ?? "";
    const length = Number(wordLength ?? signLength);
    resolved += css.slice(from, query.index);
    if (width !== undefined && holds(width, comparison, length))
      resolved += css.slice(open, end - 1);
    from = end;
  }
  return resolved + css.slice(from);
}

/** Lays the stylesheets into the document for named containers of the widths given, answering the style element, which the caller removes. */
export function layContainersAt(widths: Readonly<Record<string, number>>): HTMLStyleElement {
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = SHEETS.map((name) =>
    resolvedAt(readFileSync(path.join(STYLES, name), "utf8"), widths),
  ).join("\n");
  return style;
}

/** Whether an element is drawn at all: neither it nor any box around it is `display: none`. */
export function shown(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).display === "none") return false;
  }
  return true;
}
