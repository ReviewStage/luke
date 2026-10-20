import { Schema as EffectSchema } from "effect";

/**
 * page-find.ts -- ⌘F in a plan's page as drawn: the find the page's frame runs over its own words, and the messages the side panel and the frame pass to drive it.
 *
 * A page is drawn in a frame sandboxed to its scripts alone, with an opaque
 * origin, so nothing in the panel reaches its words to find them. Every
 * server of a page therefore answers it with one script of Luke's own after
 * the agent's HTML (`withPageFind`), which finds in the page's text at the
 * panel's asking, tints the matches with the CSS Custom Highlight API rather
 * than wrapping them, so the page's own tree is never rewritten, and brings
 * the one the find is at into view. The panel's find bar is the one every
 * tab draws (`find-in-tab.tsx`); this is its source where the words stand
 * in the frame (`page-pane.tsx`).
 *
 * The panel posts a search, a step, or a clear to the frame; the frame posts
 * back its tally after each, and again as its text changes, and the words
 * selected in it as the selection changes, which ⌘F seeds the field with.
 * The script runs among the page's own, so whatever the frame posts is the
 * page's word, not Luke's: the panel takes a message only from the frame it
 * drew and only in the shape below, and what it takes is a count and a
 * selection, nothing it acts on beyond the find bar.
 */

/** The mark every message of the find wears, setting it apart from whatever else the page posts. */
export const PAGE_FIND_TYPE = "luke-page-find";

/** What the panel asks of the frame. */
export const PAGE_FIND_ACT = {
  SEARCH: "search",
  STEP: "step",
  CLEAR: "clear",
} as const;

/** The longest selection the frame hands the panel to seed the field with. */
const PAGE_FIND_SELECTION_CHARS = 1_000;

/** A message the panel posts to the frame: find the query, step from the match it is at, or take the tints away. */
export type PageFindAsk =
  | {
      readonly type: typeof PAGE_FIND_TYPE;
      readonly act: typeof PAGE_FIND_ACT.SEARCH;
      readonly query: string;
    }
  | {
      readonly type: typeof PAGE_FIND_TYPE;
      readonly act: typeof PAGE_FIND_ACT.STEP;
      readonly query: string;
      readonly by: -1 | 1;
    }
  | { readonly type: typeof PAGE_FIND_TYPE; readonly act: typeof PAGE_FIND_ACT.CLEAR };

const countSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(0));

/** A message the frame posts to the panel: the matches it holds and which it is at, or the words selected in it. */
export const pageFindAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_FIND_TYPE),
    tally: EffectSchema.Struct({
      count: countSchema,
      at: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(-1)),
    }),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_FIND_TYPE),
    selection: EffectSchema.String.check(EffectSchema.isMaxLength(PAGE_FIND_SELECTION_CHARS)),
  }),
]);

/**
 * The script the frame runs, as the page's last. It is plain JavaScript in
 * a string because it runs in the page, apart from every bundle of Luke's.
 * A match is the query found in the page's text read as one string, case
 * aside, where an inline element runs on into its neighbours and any other
 * sets its text apart, as the panel's own find reads a tab; what is hidden
 * (`display: none`, `hidden`) or no words (scripts, styles) is not read. The
 * tints are the panel's find colours (`palettes.css`), set by a stylesheet
 * the document adopts rather than an element added to it.
 */
const PAGE_FIND_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_FIND_TYPE)};
  const MAX_SELECTION = ${PAGE_FIND_SELECTION_CHARS};
  const MATCH = "luke-find-match";
  const CURRENT = "luke-find-current";
  const INLINE = new Set(["A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DEL", "DFN", "EM", "I", "INS", "KBD", "LABEL", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR"]);
  const UNREAD = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TEXTAREA", "SELECT", "OPTION"]);
  const painted = typeof CSS !== "undefined" && CSS.highlights !== undefined && typeof Highlight === "function";
  const find = { query: "", ranges: [], at: -1, observer: undefined, styled: false };

  const post = (message) => parent.postMessage(Object.assign({ type: TYPE }, message), "*");
  const tally = () => post({ tally: { count: find.ranges.length, at: find.at } });

  const read = (node, into) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        into.nodes.push({ node: child, start: into.text.length });
        into.text += child.data;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toUpperCase();
        if (UNREAD.has(tag) || child.hidden || getComputedStyle(child).display === "none") continue;
        const inline = INLINE.has(tag);
        if (!inline) into.text += "\\n";
        read(child, into);
        if (!inline) into.text += "\\n";
      }
    }
    return into;
  };

  const rangesOf = (query) => {
    const root = document.body || document.documentElement;
    if (root === null || query.length === 0) return [];
    const { text, nodes } = read(root, { text: "", nodes: [] });
    const pattern = new RegExp(query.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"), "giu");
    // The text node a match's start stands in, or its end closes: the last starting before it.
    const nodeAt = (offset, end) => {
      let low = 0;
      let high = nodes.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (end ? nodes[middle].start < offset : nodes[middle].start <= offset) low = middle;
        else high = middle - 1;
      }
      return nodes[low];
    };
    const ranges = [];
    for (const match of text.matchAll(pattern)) {
      const last = match.index + match[0].length;
      const start = nodeAt(match.index, false);
      const end = nodeAt(last, true);
      const range = document.createRange();
      range.setStart(start.node, Math.min(match.index - start.start, start.node.length));
      range.setEnd(end.node, Math.min(last - end.start, end.node.length));
      ranges.push(range);
    }
    return ranges;
  };

  const paint = () => {
    if (!painted) return;
    if (!find.styled) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync("::highlight(" + MATCH + ") { background-color: rgba(255, 204, 0, 0.42); } ::highlight(" + CURRENT + ") { background-color: #ff9f0a; color: #000; }");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      find.styled = true;
    }
    const current = find.ranges[find.at];
    const match = new Highlight(...find.ranges.filter((range) => range !== current));
    const shown = new Highlight(...(current === undefined ? [] : [current]));
    shown.priority = 1;
    CSS.highlights.set(MATCH, match);
    CSS.highlights.set(CURRENT, shown);
  };

  const reveal = () => {
    const range = find.ranges[find.at];
    if (range === undefined) return;
    for (let element = range.startContainer.parentElement; element !== null; element = element.parentElement) {
      if (element.tagName.toUpperCase() === "DETAILS" && !element.open) element.open = true;
    }
    const box = range.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth) return;
    range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
  };

  // Whether a match starts at or after one held before, which a change to the page may have taken out of it.
  const after = (range, was) => {
    try {
      return range.compareBoundaryPoints(Range.START_TO_START, was) >= 0;
    } catch {
      return false;
    }
  };

  // A query typed further, or read again over changed text, keeps to the match it was at.
  const search = (query, shown) => {
    const was = find.ranges[find.at];
    find.query = query;
    find.ranges = rangesOf(query);
    const kept = was === undefined ? -1 : find.ranges.findIndex((range) => after(range, was));
    find.at = find.ranges.length === 0 ? -1 : Math.max(kept, 0);
    paint();
    if (shown) reveal();
    tally();
  };

  const watch = () => {
    if (find.observer !== undefined) return;
    find.observer = new MutationObserver(() => {
      if (find.query.length > 0) search(find.query, false);
    });
    find.observer.observe(document, { childList: true, subtree: true, characterData: true });
  };

  const clear = () => {
    find.observer?.disconnect();
    find.observer = undefined;
    find.query = "";
    find.ranges = [];
    find.at = -1;
    paint();
  };

  addEventListener("message", (event) => {
    const ask = event.data;
    if (event.source !== parent || ask === null || typeof ask !== "object" || ask.type !== TYPE) return;
    if (ask.act === ${JSON.stringify(PAGE_FIND_ACT.CLEAR)}) return clear();
    if (typeof ask.query !== "string" || ask.query.length === 0) return clear();
    if (ask.act === ${JSON.stringify(PAGE_FIND_ACT.SEARCH)}) {
      search(ask.query, true);
      watch();
    } else if (ask.act === ${JSON.stringify(PAGE_FIND_ACT.STEP)} && (ask.by === 1 || ask.by === -1)) {
      if (ask.query !== find.query) search(ask.query, false);
      watch();
      const count = find.ranges.length;
      if (count === 0) return tally();
      find.at = (find.at + ask.by + count) % count;
      paint();
      reveal();
      tally();
    }
  });

  document.addEventListener("selectionchange", () => {
    post({ selection: String(getSelection() ?? "").slice(0, MAX_SELECTION) });
  });
})();`;

/** The page as served: the agent's HTML, then the find's script, which the HTML parser places in the body. */
export function withPageFind(html: string): string {
  return `${html}\n<script>${PAGE_FIND_SCRIPT}</script>\n`;
}
