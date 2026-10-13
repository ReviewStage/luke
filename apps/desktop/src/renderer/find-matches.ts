/**
 * find-matches.ts -- what a find in a tab finds: the words of a query in the text under one element, as ranges, painted with the CSS Custom Highlight API and brought into view one at a time.
 *
 * Nothing here writes to the page it searches. A match is a `Range` over the
 * text nodes React drew, painted through `CSS.highlights` rather than
 * wrapped in a `<mark>`, so React's tree is never touched behind its back,
 * and the screen recording, which masks every word, has no new element to
 * mask (`session-replay.ts`). It is its own file because it is the DOM's
 * half of the find, apart from the bar that asks it (`find-in-tab.tsx`).
 *
 * A query is matched against the element's text read as one string, so a
 * match runs across the inline spans a line is drawn in, as a word split
 * over a code line's coloured tokens is, but never from one line or
 * paragraph into the next: text in another block is set apart by a line
 * break, which a query, typed in a one-line field, never holds. What is
 * `hidden` is not searched, nor what wears `FIND_SKIP_ATTRIBUTE`, nor what a shadow root draws, which
 * a tree walker does not enter. A closed `<details>` is searched, since what
 * it folds is still the tab's to find, and opened when its match is brought
 * into view, as Chromium's own find opens one.
 */

/** The two highlights every find paints into: each match, and the one it is at, drawn over the rest. */
const FIND_HIGHLIGHT = {
  MATCH: "find-match",
  CURRENT: "find-current",
} as const;

type FindHighlight = (typeof FIND_HIGHLIGHT)[keyof typeof FIND_HIGHLIGHT];

/** The tags whose text runs on into its neighbours' on one line; any other element sets its text apart. */
const INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "CITE",
  "CODE",
  "DEL",
  "DFN",
  "EM",
  "I",
  "INS",
  "KBD",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
]);

/** The elements whose text is never read as words. */
const UNREAD_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

/**
 * The attribute worn by what is drawn among a tab's words and is none of
 * them: the find bar itself, standing inside the tab it searches, and a
 * code line's number in its gutter.
 */
export const FIND_SKIP_ATTRIBUTE = "data-find-skip";

/** What sets the text of two blocks apart in the string a query is matched against. */
const BLOCK_BREAK = "\n";

/** The characters a query matches literally that a pattern would read as syntax. */
const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** One text node as it stands in the string read: where its text starts there. */
interface TextRun {
  readonly node: Text;
  readonly start: number;
}

/** An element's text read as one string, and the run each part of it came from. */
interface ReadText {
  readonly text: string;
  readonly runs: readonly TextRun[];
}

/** The matches a find paints, and the one it is at; -1 where it is at none. */
export interface FindPainting {
  readonly ranges: readonly Range[];
  readonly at: number;
}

export const NO_PAINTING: FindPainting = { ranges: [], at: -1 };

/** Whether an element's subtree is left out of the words searched. */
function unread(element: Element): boolean {
  return (
    UNREAD_TAGS.has(element.tagName) ||
    element.hasAttribute("hidden") ||
    element.hasAttribute(FIND_SKIP_ATTRIBUTE)
  );
}

/** The nearest element around a text node that sets its text apart from the next block's. */
function blockOf(node: Text, root: Element): Element {
  let element = node.parentElement;
  while (element !== null && element !== root && INLINE_TAGS.has(element.tagName)) {
    element = element.parentElement;
  }
  return element ?? root;
}

/** Reads every searched text node under `root`, in document order, into one string. */
function readText(root: Element): ReadText {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node instanceof Element && unread(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const runs: TextRun[] = [];
  let text = "";
  let block: Element | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || node.data.length === 0) continue;
    const own = blockOf(node, root);
    if (block !== undefined && own !== block) text += BLOCK_BREAK;
    block = own;
    runs.push({ node, start: text.length });
    text += node.data;
  }
  return { text, runs };
}

/** The run an offset into the string read falls in, the last one starting at or before it. */
function runAt(runs: readonly TextRun[], offset: number): TextRun {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const run = runs[middle];
    if (run !== undefined && run.start <= offset) low = middle;
    else high = middle - 1;
  }
  const run = runs[low];
  if (run === undefined) throw new Error(`no text run holds offset ${offset}`);
  return run;
}

/** The range over the string read from `start` up to `end`, in the text nodes it came from. */
function rangeOver(read: ReadText, start: number, end: number): Range {
  const first = runAt(read.runs, start);
  const last = runAt(read.runs, end - 1);
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

/** The highlight a name paints, registered the first time it is asked for. */
function highlightOf(name: FindHighlight): Highlight {
  const registered = CSS.highlights.get(name);
  if (registered !== undefined) return registered;
  const highlight = new Highlight();
  // The match a find is at is drawn over the tint every match wears.
  highlight.priority = name === FIND_HIGHLIGHT.CURRENT ? 1 : 0;
  CSS.highlights.set(name, highlight);
  return highlight;
}

/** Whether an element scrolls along an axis, holding more than it shows. */
function scrollsAlong(element: Element, axis: "x" | "y"): boolean {
  const style = getComputedStyle(element);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (overflow !== "auto" && overflow !== "scroll") return false;
  return axis === "y"
    ? element.scrollHeight > element.clientHeight
    : element.scrollWidth > element.clientWidth;
}

/**
 * Scrolls each scroller between a range and `root` that has the range out
 * of its view until the range stands in the middle of it. Note that the
 * scrollers are moved themselves rather than through `scrollIntoView`,
 * which would scroll every box around the tab, the window's own panes
 * included (`renderer/CLAUDE.md`).
 */
function scrollToRange(range: Range, root: Element): void {
  let element = range.startContainer.parentElement;
  while (element !== null) {
    const box = element.getBoundingClientRect();
    const target = range.getBoundingClientRect();
    if (scrollsAlong(element, "y") && (target.top < box.top || target.bottom > box.bottom)) {
      element.scrollTop += target.top - box.top - (box.height - target.height) / 2;
    }
    if (scrollsAlong(element, "x") && (target.left < box.left || target.right > box.right)) {
      element.scrollLeft += target.left - box.left - (box.width - target.width) / 2;
    }
    if (element === root) return;
    element = element.parentElement;
  }
}

/**
 * Every match of `query` in the text under `root`, in document order,
 * without regard to case; none for an empty query.
 */
export function findRanges(root: Element, query: string): Range[] {
  if (query.length === 0) return [];
  const read = readText(root);
  const pattern = new RegExp(query.replace(PATTERN_SYNTAX, "\\$&"), "giu");
  const ranges: Range[] = [];
  for (const match of read.text.matchAll(pattern)) {
    ranges.push(rangeOver(read, match.index, match.index + match[0].length));
  }
  return ranges;
}

/**
 * The box a range is seen through: the nearest scroller around it up to
 * `root`, or `root`, each element's answer kept in `seen` for the next
 * range in it.
 */
function viewOf(range: Range, root: Element, seen: Map<Element, Element>): Element {
  const start = range.startContainer.parentElement ?? root;
  const known = seen.get(start);
  if (known !== undefined) return known;
  let element: Element | null = start;
  while (element !== null && element !== root && !scrollsAlong(element, "y")) {
    element = element.parentElement;
  }
  const view = element ?? root;
  seen.set(start, view);
  return view;
}

/**
 * The match a find should be at among `ranges`: the first at or after
 * `anchor`, the match it was at before the ranges were read again, so new
 * text arriving around it does not move it; or, with no anchor, the first
 * not scrolled above the top of the scroller it is read in, so the find
 * starts where the reader is. The first of all where none follows, and -1
 * where there is none.
 */
export function matchFrom(
  ranges: readonly Range[],
  anchor: Range | undefined,
  root: Element,
): number {
  if (ranges.length === 0) return -1;
  const seen = new Map<Element, Element>();
  const after = ranges.findIndex((range) =>
    anchor === undefined
      ? range.getBoundingClientRect().bottom >=
        viewOf(range, root, seen).getBoundingClientRect().top
      : range.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0,
  );
  return Math.max(0, after);
}

/** Paints `next` in place of `previous`, each find painting only its own matches into the shared highlights. */
export function repaint(previous: FindPainting, next: FindPainting): void {
  // A find with nothing painted and nothing to paint leaves the document's highlights be.
  if (previous.ranges.length === 0 && next.ranges.length === 0) return;
  const match = highlightOf(FIND_HIGHLIGHT.MATCH);
  const current = highlightOf(FIND_HIGHLIGHT.CURRENT);
  for (const range of previous.ranges) match.delete(range);
  const was = previous.ranges[previous.at];
  if (was !== undefined) current.delete(was);
  for (const range of next.ranges) match.add(range);
  const now = next.ranges[next.at];
  if (now !== undefined) current.add(now);
}

/**
 * Brings a match into view: every closed `<details>` around it opened, as
 * Chromium's own find opens one, and every scroller up to `root` moved
 * until it stands in the middle.
 */
export function reveal(range: Range, root: Element): void {
  for (
    let element = range.startContainer.parentElement;
    element !== null && element !== root;
    element = element.parentElement
  ) {
    if (element instanceof HTMLDetailsElement && !element.open) element.open = true;
  }
  scrollToRange(range, root);
}

/**
 * The words selected inside `root` to seed a find with: the selection's
 * text where it stands on one line within the tab, outside the bar, and
 * nothing otherwise.
 */
export function selectedWords(root: Element): string | undefined {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const within = selection.getRangeAt(0).commonAncestorContainer;
  const element = within instanceof Element ? within : within.parentElement;
  // Words selected in the bar's own field are the query already.
  if (element === null || !root.contains(element)) return undefined;
  if (element.closest(`[${FIND_SKIP_ATTRIBUTE}]`) !== null) return undefined;
  const words = selection.toString();
  return words.length === 0 || words.includes("\n") ? undefined : words;
}
