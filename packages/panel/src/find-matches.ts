import { FIND_SKIP_ATTRIBUTE } from "@repo/ui/find-skip";

const FIND_HIGHLIGHT = {
  MATCH: "find-match",
  CURRENT: "find-current",
} as const;

type FindHighlight = (typeof FIND_HIGHLIGHT)[keyof typeof FIND_HIGHLIGHT];

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

const UNTIL_FOUND = "until-found";

const BEFORE_MATCH = "beforematch";

const UNREAD_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

export const FIND_SHADOW_ATTRIBUTE = "data-find-shadow";

const WATCHED: MutationObserverInit = { childList: true, subtree: true, characterData: true };

const BLOCK_BREAK = "\n";

const PATTERN_SYNTAX = /[.*+?^${}()|[\]\\/]/g;

interface TextRun {
  readonly node: Text;
  readonly start: number;
}

interface ReadText {
  readonly text: string;
  readonly runs: readonly TextRun[];
}

export interface FindPainting {
  readonly ranges: readonly Range[];
  readonly at: number;
}

export const NO_PAINTING: FindPainting = { ranges: [], at: -1 };

function hiddenUntilFound(element: Element): boolean {
  return element.getAttribute("hidden")?.toLowerCase() === UNTIL_FOUND;
}

function hiddenFromFind(element: Element): boolean {
  return element.hasAttribute("hidden") && !hiddenUntilFound(element);
}

function unread(element: Element, skipped: string | undefined): boolean {
  return (
    UNREAD_TAGS.has(element.tagName) ||
    hiddenFromFind(element) ||
    element.hasAttribute(FIND_SKIP_ATTRIBUTE) ||
    (skipped !== undefined && element.matches(skipped))
  );
}

function parentAcross(node: Node): Element | null {
  if (node.parentElement !== null) return node.parentElement;
  return node.parentNode instanceof ShadowRoot ? node.parentNode.host : null;
}

function searchedShadow(
  element: Element,
): { root: ShadowRoot; skipped: string | undefined } | undefined {
  const root = element.shadowRoot;
  if (root === null || !element.hasAttribute(FIND_SHADOW_ATTRIBUTE)) return undefined;
  const skipped = element.getAttribute(FIND_SHADOW_ATTRIBUTE) ?? "";
  return { root, skipped: skipped === "" ? undefined : skipped };
}

function blockOf(node: Text, root: Element): Node {
  let element = node.parentElement;
  while (element !== null && element !== root && INLINE_TAGS.has(element.tagName)) {
    element = element.parentElement;
  }
  return element ?? (node.parentNode instanceof ShadowRoot ? node.parentNode : root);
}

interface Reading {
  text: string;
  readonly runs: TextRun[];
  block: Node | undefined;
}

function readUnder(parent: Node, root: Element, skipped: string | undefined, into: Reading): void {
  readNodes(parent.childNodes, root, skipped, into);
}

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

function readText(root: Element): ReadText {
  const into: Reading = { text: "", runs: [], block: undefined };
  readUnder(root, root, undefined, into);
  return { text: into.text, runs: into.runs };
}

function inDocumentTree(node: Node): Node {
  let at = node;
  for (let top = at.getRootNode(); top instanceof ShadowRoot; top = at.getRootNode()) at = top.host;
  return at;
}

function inFlatTree(node: Node): Node {
  for (let at: Node | null = node; at !== null; at = at.parentNode) {
    if (at instanceof Element && at.assignedSlot !== null) return at.assignedSlot;
  }
  return node;
}

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

function rangeOver(read: ReadText, start: number, end: number): Range {
  const first = runAt(read.runs, start);
  const last = runAt(read.runs, end - 1);
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function highlightOf(name: FindHighlight): Highlight {
  const registered = CSS.highlights.get(name);
  if (registered !== undefined) return registered;
  const highlight = new Highlight();
  highlight.priority = name === FIND_HIGHLIGHT.CURRENT ? 1 : 0;
  CSS.highlights.set(name, highlight);
  return highlight;
}

function scrollsAlong(element: Element, axis: "x" | "y"): boolean {
  const style = getComputedStyle(element);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (overflow !== "auto" && overflow !== "scroll") return false;
  return axis === "y"
    ? element.scrollHeight > element.clientHeight
    : element.scrollWidth > element.clientWidth;
}

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

export function repaint(previous: FindPainting, next: FindPainting): void {
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

export function reveal(range: Range, root: Element): void {
  for (
    let element = parentAcross(range.startContainer);
    element !== null && element !== root;
    element = parentAcross(element)
  ) {
    if (element instanceof HTMLDetailsElement && !element.open) element.open = true;
    if (hiddenUntilFound(element)) {
      element.dispatchEvent(new Event(BEFORE_MATCH, { bubbles: true }));
      element.removeAttribute("hidden");
    }
  }
  scrollToRange(range, root);
}

function containsAcross(root: Element, element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = parentAcross(at)) {
    if (at === root) return true;
  }
  return false;
}

export function watchText(root: Element, onChange: () => void): () => void {
  const watched = new WeakSet<Node>();
  let frame: number | undefined;
  const watchShadows = () => {
    for (const host of root.querySelectorAll(`[${FIND_SHADOW_ATTRIBUTE}]`)) {
      const shadow = host.shadowRoot;
      if (shadow === null || watched.has(shadow)) continue;
      watched.add(shadow);
      observer.observe(shadow, WATCHED);
    }
  };
  const observer = new MutationObserver(() => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      watchShadows();
      onChange();
    });
  });
  observer.observe(root, WATCHED);
  watchShadows();
  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

export function selectedWords(root: Element): string | undefined {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const within = selection.getRangeAt(0).commonAncestorContainer;
  const element = within instanceof Element ? within : within.parentElement;
  if (element === null || !containsAcross(root, element)) return undefined;
  if (element.closest(`[${FIND_SKIP_ATTRIBUTE}]`) !== null) return undefined;
  const words = selection.toString();
  return words.length === 0 || words.includes("\n") ? undefined : words;
}
