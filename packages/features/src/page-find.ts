import { Schema as EffectSchema } from "effect";
import { PAGE_LINK_SCRIPT } from "./page-link.js";
import { PAGE_PICK_SCRIPT } from "./page-pick.js";
import { PAGE_SIZE_SCRIPT } from "./page-size.js";
import { PAGE_THEME_SCRIPT } from "./page-theme.js";

export const PAGE_FIND_TYPE = "app-page-find";

export const PAGE_FIND_ACT = {
  SEARCH: "search",
  STEP: "step",
  CLEAR: "clear",
} as const;

export const PAGE_FIND_KEY = {
  FIND: "find",
  NEXT: "next",
  PREVIOUS: "previous",
} as const;

const PAGE_FIND_SELECTION_CHARS = 1_000;

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
  EffectSchema.Struct({
    type: EffectSchema.Literal(PAGE_FIND_TYPE),
    key: EffectSchema.Literals(Object.values(PAGE_FIND_KEY)),
  }),
]);

const PAGE_FIND_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_FIND_TYPE)};
  const MAX_SELECTION = ${PAGE_FIND_SELECTION_CHARS};
  const MATCH = "ui-find-match";
  const CURRENT = "ui-find-current";
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
    // Note that the match is shown only where the window and every scroller it stands in hold it.
    const box = range.getBoundingClientRect();
    const holds = (edges) => box.top >= edges.top && box.bottom <= edges.bottom && box.left >= edges.left && box.right <= edges.right;
    let shown = holds({ top: 0, bottom: innerHeight, left: 0, right: innerWidth });
    for (let element = range.startContainer.parentElement; shown && element !== null; element = element.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(element);
      if (overflowX !== "visible" || overflowY !== "visible") shown = holds(element.getBoundingClientRect());
    }
    if (!shown) range.startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
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
    find.observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"] });
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

  // A find chord is the panel's, as it is anywhere else in the window: the page never sees it.
  addEventListener("keydown", (event) => {
    if (!event.metaKey || event.ctrlKey || event.altKey) return;
    const letter = event.key.toLowerCase();
    const key = letter === "f" && !event.shiftKey ? ${JSON.stringify(PAGE_FIND_KEY.FIND)}
      : letter === "g" ? (event.shiftKey ? ${JSON.stringify(PAGE_FIND_KEY.PREVIOUS)} : ${JSON.stringify(PAGE_FIND_KEY.NEXT)})
      : undefined;
    if (key === undefined) return;
    // Note that a held chord's repeats stay the panel's too, though only the press runs it.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) post({ key });
  }, true);

  document.addEventListener("selectionchange", () => {
    post({ selection: String(getSelection() ?? "").slice(0, MAX_SELECTION) });
  });
})();`;

const DOCTYPE = /^<!doctype[^>]*>/i;

function doctypeEnd(html: string): number {
  let at = html.length - html.trimStart().length;
  while (html.startsWith("<!--", at)) {
    const close = html.indexOf("-->", at + 4);
    if (close < 0) return 0;
    const next = close + 3;
    at = next + (html.length - next - html.slice(next).trimStart().length);
  }
  const doctype = DOCTYPE.exec(html.slice(at))?.[0];
  return doctype === undefined ? 0 : at + doctype.length;
}

export function withPageScripts(html: string): string {
  const end = doctypeEnd(html);
  const scripts = `<script>${PAGE_FIND_SCRIPT}</script><script>${PAGE_LINK_SCRIPT}</script><script>${PAGE_PICK_SCRIPT}</script><script>${PAGE_SIZE_SCRIPT}</script><script>${PAGE_THEME_SCRIPT}</script>`;
  return `${html.slice(0, end)}${scripts}${html.slice(end)}`;
}
