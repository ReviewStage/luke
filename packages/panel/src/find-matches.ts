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
 * `hidden` is not searched, nor what wears `FIND_SKIP_ATTRIBUTE`. A closed
 * `<details>` is searched, since what it folds is still the tab's to find,
 * and opened when its match is brought into view, as Chromium's own find
 * opens one.
 *
 * What a shadow root draws is not searched, as a File tab's tree is not,
 * unless its host wears `FIND_SHADOW_ATTRIBUTE`, as a diff drawn by Pierre
 * does (`diff-view/index.ts`): its open shadow root's words are then read
 * in the host's place, less what the attribute's selector names, and its
 * changes watched (`watchText`), each walk up from a match crossing from
 * the shadow root to its host, so a match there is painted, ordered among
 * the rest, and scrolled into view as any other; what its host slots into
 * it, a diff's review threads under their lines, is read where its slot
 * stands. The rules that paint a match are the document's, and a shadow
 * root takes none of them, so such a root adopts its own.
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

/**
 * The attribute worn by a host whose open shadow root is searched in its
 * place; its value is a selector naming what in that root is left out of
 * the words, as a gutter of numbers is, or nothing.
 */
export const FIND_SHADOW_ATTRIBUTE = "data-find-shadow";

/** What a find watches of the tab's text and of each shadow root searched. */
const WATCHED: MutationObserverInit = { childList: true, subtree: true, characterData: true };

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

/** Whether an element's subtree is left out of the words searched, `skipped` naming more of it within a shadow root. */
function unread(element: Element, skipped: string | undefined): boolean {
  return (
    UNREAD_TAGS.has(element.tagName) ||
    element.hasAttribute("hidden") ||
    element.hasAttribute(FIND_SKIP_ATTRIBUTE) ||
    (skipped !== undefined && element.matches(skipped))
  );
}

/** The element a node stands in, crossing from a shadow root to its host. */
function parentAcross(node: Node): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  return node.parentNode instanceof ShadowRoot ? node.parentNode.host : null;
}

/** The shadow root searched in an element's place, and what in it is left out; none where it is not searched. */
function searchedShadow(
  element: Element,
): { root: ShadowRoot; skipped: string | undefined } | undefined {
  const root = element.shadowRoot;
  if (root === null || !element.hasAttribute(FIND_SHADOW_ATTRIBUTE)) return undefined;
  const skipped = element.getAttribute(FIND_SHADOW_ATTRIBUTE) ?? "";
  return { root, skipped: skipped === "" ? undefined : skipped };
}

/** The nearest element around a text node that sets its text apart from the next block's, or the shadow root it stands at the top of. */
function blockOf(node: Text, root: Element): Node {
  let element = node.parentElement;
  while (element !== null && element !== root && INLINE_TAGS.has(element.tagName)) {
    element = element.parentElement;
  }
  return element ?? (node.parentNode instanceof ShadowRoot ? node.parentNode : root);
}

/** A string being read, and the block its last text stood in. */
interface Reading {
  text: string;
  readonly runs: TextRun[];
  block: Node | undefined;
}

/** Reads every searched text node under `parent`, in document order, onto the string, a shadow root searched in its host's place. */
function readUnder(parent: Node, root: Element, skipped: string | undefined, into: Reading): void {
  readNodes(parent.childNodes, root, skipped, into);
}

/**
 * Reads every searched text node in and under `nodes`, in order, onto the
 * string: a shadow root searched in its host's place, and a slot in it in
 * the place of what its host slots there, as a diff's review threads stand
 * under their lines.
 */
function readNodes(
  nodes: Iterable<Node>,
  root: Element,
  skipped: string | undefined,
  into: Reading,
): void {
  for (const node of nodes) {
    if (node instanceof Text) {
      if (node.data.length === 0) continue;
      const own = blockOf(node, root);
      if (into.block !== undefined && own !== into.block) into.text += BLOCK_BREAK;
      into.block = own;
      into.runs.push({ node, start: into.text.length });
      into.text += node.data;
      continue;
    }
    if (!(node instanceof Element) || unread(node, skipped)) continue;
    if (node instanceof HTMLSlotElement) {
      readNodes(node.assignedNodes({ flatten: true }), root, undefined, into);
      continue;
    }
    const shadow = searchedShadow(node);
    if (shadow === undefined) readUnder(node, root, skipped, into);
    else readUnder(shadow.root, root, shadow.skipped, into);
  }
}

/** Reads every searched text node under `root`, in document order, into one string. */
function readText(root: Element): ReadText {
  const into: Reading = { text: "", runs: [], block: undefined };
  readUnder(root, root, undefined, into);
  return { text: into.text, runs: into.runs };
}

/** The node a node stands for in the document's own tree: itself, or the host of each shadow root it stands in. */
function inDocumentTree(node: Node): Node {
  let at = node;
  for (let top = at.getRootNode(); top instanceof ShadowRoot; top = at.getRootNode()) at = top.host;
  return at;
}

/** The node a node stands for where a shadow root draws it: the slot it is assigned to, or itself where it is slotted nowhere. */
function inFlatTree(node: Node): Node {
  for (let at: Node | null = node; at !== null; at = at.parentNode) {
    if (at instanceof Element && at.assignedSlot !== null) return at.assignedSlot;
  }
  return node;
}

/**
 * Whether range `a` starts before range `b`. Note that two ranges in
 * different trees, one in a shadow root and one outside it, are ordered by
 * where each is drawn: what a host slots into its shadow root where its
 * slot stands there, as the words are read (`readNodes`), and otherwise
 * where each stands in the document's own tree, because a range compares
 * boundary points only within its own tree.
 */
function startsBefore(a: Range, b: Range): boolean {
  if (a.startContainer.getRootNode() === b.startContainer.getRootNode()) {
    return a.compareBoundaryPoints(Range.START_TO_START, b) < 0;
  }
  const drawnOne = inFlatTree(a.startContainer);
  const drawnOther = inFlatTree(b.startContainer);
  if (drawnOne !== drawnOther && drawnOne.getRootNode() === drawnOther.getRootNode()) {
    return (drawnOne.compareDocumentPosition(drawnOther) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }
  const one = inDocumentTree(drawnOne);
  const other = inDocumentTree(drawnOther);
  return (
    one !== other && (one.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
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
  let element = parentAcross(range.startContainer);
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
    element = parentAcross(element);
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
  const start = parentAcross(range.startContainer) ?? root;
  const known = seen.get(start);
  if (known !== undefined) return known;
  let element: Element | null = start;
  while (element !== null && element !== root && !scrollsAlong(element, "y")) {
    element = parentAcross(element);
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
      : !startsBefore(range, anchor),
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
    let element = parentAcross(range.startContainer);
    element !== null && element !== root;
    element = parentAcross(element)
  ) {
    if (element instanceof HTMLDetailsElement && !element.open) element.open = true;
  }
  scrollToRange(range, root);
}

/** Whether `element` stands under `root`, across the shadow roots between them. */
function containsAcross(root: Element, element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = parentAcross(at)) {
    if (at === root) return true;
  }
  return false;
}

/**
 * Calls `onChange` whenever the text under `root` changes, or the text in
 * a shadow root searched in a host's place (`FIND_SHADOW_ATTRIBUTE`), each
 * such root watched from the moment its host stands under `root`, until the
 * answer is called.
 */
export function watchText(root: Element, onChange: () => void): () => void {
  const watched = new WeakSet<Node>();
  const watchShadows = () => {
    for (const host of root.querySelectorAll(`[${FIND_SHADOW_ATTRIBUTE}]`)) {
      const shadow = host.shadowRoot;
      if (shadow === null || watched.has(shadow)) continue;
      watched.add(shadow);
      observer.observe(shadow, WATCHED);
    }
  };
  const observer = new MutationObserver(() => {
    watchShadows();
    onChange();
  });
  observer.observe(root, WATCHED);
  watchShadows();
  return () => observer.disconnect();
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
  if (element === null || !containsAcross(root, element)) return undefined;
  if (element.closest(`[${FIND_SKIP_ATTRIBUTE}]`) !== null) return undefined;
  const words = selection.toString();
  return words.length === 0 || words.includes("\n") ? undefined : words;
}
