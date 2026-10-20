import { GAP_CONTROL, GAP_CONTROL_ATTRIBUTE, GAP_LINES } from "./contract.js";

/**
 * gap-controls.ts -- the controls of a gap between a file's hunks, alike on every gap: its words open the whole of it, and its arrows the next lines their way.
 *
 * Pierre draws a gap's band with an arrow at the file's top or foot, two
 * between hunks where the gap is longer than one press opens, and the words
 * saying how many lines it leaves out, which Pierre opens twenty lines both
 * ways. Here the words open the whole gap, whichever gap it is, as Pierre
 * opens it from its own Expand all, which it draws hidden; and the arrows
 * open the next twenty lines, or all of a short gap, as Pierre has them. The
 * words of the trailing gap, which says only that more may follow, read the
 * file first and open it to its end. A file whose gaps cannot be opened is
 * drawn with no index on its gaps, and none of its words is marked.
 *
 * Each control is marked as it is drawn (`watchGapControls`): which it is
 * (`GAP_CONTROL_ATTRIBUTE`), a button in the tab order, named for what it
 * opens, which the view hangs over it as its hint. Enter or Space presses it
 * as a click does, and the keyboard's focus comes back to the same control
 * once Pierre draws the file again, where the gap still stands. Note that
 * Pierre writes a file's rows anew on every drawing, so the marks are put
 * back each time its rows change, before the window paints, reading only
 * the columns written anew and never the code's rows; a file the list lets
 * go is watched no more until it is drawn again.
 */

/** What each control of a gap says it opens. */
const GAP_WORDS = {
  MORE: `Show ${GAP_LINES} more lines`,
  /** The trailing gap's words, before the file is read: how far it runs is not known yet. */
  REST: "Show the rest of the file",
  every: (lines: number) => (lines === 1 ? "Show 1 line" : `Show all ${lines} lines`),
} as const;

/** A gap Pierre lets open: one it draws with the index of the hunk after it. */
const OPENABLE = "[data-separator][data-expand-index]";

/**
 * A gap as it is seen: Pierre draws each gap in the numbers' column and
 * again, hidden, among the code's rows, so only the first is marked.
 */
const SEEN = `[data-gutter] ${OPENABLE}`;

/** The column of the code's rows, the bulk of what Pierre writes, where no gap is seen. */
const CODE_ROWS = "[data-content]";

/** A gap's words, how many lines it leaves out. */
const WORDS = "[data-unmodified-lines]";

/** A gap's arrows, Pierre's hidden Expand all aside. */
const ARROWS = "[data-expand-button]:not([data-expand-all-button])";

/** Pierre's own Expand all, which it draws, hidden, beside the arrows of a gap longer than one press opens. */
const PIERRE_ALL = "[data-expand-button][data-expand-all-button]";

/** The mark Pierre opens a whole gap from, on whichever element its press lands. */
const ALL_MARK = "data-expand-all-button";

/** The arrows' own marks for which way each opens, each control found again by one of them or by its words. */
const ARROW_WAYS = ["data-expand-up", "data-expand-down", "data-expand-both"] as const;

/** What a gap's words open: every line it leaves out, or, where it does not say how many, the rest of the file. */
function wordsOf(words: Element): string {
  const lines = Number.parseInt(words.textContent ?? "", 10);
  return Number.isNaN(lines) ? GAP_WORDS.REST : GAP_WORDS.every(lines);
}

/** What a gap's arrow opens: the next lines of a long gap, or all of a short one, as its words do. */
function arrowWordsOf(arrow: Element): string {
  const band = arrow.closest("[data-separator-wrapper]");
  const words = band?.querySelector(WORDS);
  const lines = Number.parseInt(words?.textContent ?? "", 10);
  if (band?.querySelector(PIERRE_ALL) != null || words == null || Number.isNaN(lines)) {
    return GAP_WORDS.MORE;
  }
  return GAP_WORDS.every(lines);
}

/** Marks `element` as the gap's control `control`, a button named `name` in the tab order. */
function mark(
  element: Element,
  control: (typeof GAP_CONTROL)[keyof typeof GAP_CONTROL],
  name: string,
): void {
  element.setAttribute(GAP_CONTROL_ATTRIBUTE, control);
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("aria-label", name);
}

/** Marks every control of the gaps seen under `scope` that is not marked yet. */
function markGapControls(scope: ParentNode): void {
  const unmarked = `:not([${GAP_CONTROL_ATTRIBUTE}])`;
  for (const words of scope.querySelectorAll(`${SEEN} ${WORDS}${unmarked}`)) {
    words.setAttribute(ALL_MARK, "");
    mark(words, GAP_CONTROL.ALL, wordsOf(words));
  }
  for (const arrow of scope.querySelectorAll(`${SEEN} ${ARROWS}${unmarked}`)) {
    mark(arrow, GAP_CONTROL.MORE, arrowWordsOf(arrow));
  }
}

/** How a control is found again once Pierre draws its gap anew: its gap's index, and its words or the way it opens. */
function againOf(control: Element): string | undefined {
  const index = control.closest(OPENABLE)?.getAttribute("data-expand-index");
  if (index == null) return undefined;
  const way = ARROW_WAYS.find((each) => control.hasAttribute(each));
  return `[data-gutter] [data-expand-index="${index}"] ${way === undefined ? WORDS : `[${way}]`}`;
}

/** Focuses the first control under `root` found by `again` that takes the focus, the one drawn where it is seen. */
function focusAgain(root: ShadowRoot, again: string): void {
  for (const control of root.querySelectorAll<HTMLElement>(again)) {
    control.focus({ preventScroll: true });
    if (root.activeElement === control) return;
  }
}

/**
 * Marks the gaps' controls drawn in `root`, a file's shadow root, now and
 * each time its rows are drawn again, and presses one from the keyboard.
 * Answers what stops the watch.
 */
export function watchGapControls(root: ShadowRoot): () => void {
  // The control the keyboard pressed, until Pierre draws its gap anew.
  let pressed: { readonly control: Element; readonly again: string | undefined } | undefined;
  const observer = new MutationObserver((records) => {
    // Only what Pierre wrote anew is read again, and the code's rows not at all.
    const scopes = new Set<Node>();
    for (const { target, addedNodes } of records) {
      if (addedNodes.length === 0) continue;
      if (target instanceof Element && target.closest(CODE_ROWS) !== null) continue;
      scopes.add(target);
    }
    for (const scope of scopes) {
      if (scope instanceof Element || scope instanceof ShadowRoot) markGapControls(scope);
    }
    if (pressed === undefined || pressed.control.isConnected) return;
    const { again } = pressed;
    pressed = undefined;
    if (again !== undefined) focusAgain(root, again);
  });
  markGapControls(root);
  observer.observe(root, { childList: true, subtree: true });
  const press = (event: Event) => {
    if (!(event instanceof KeyboardEvent) || (event.key !== "Enter" && event.key !== " ")) return;
    const control = event.target;
    if (!(control instanceof Element) || !control.hasAttribute(GAP_CONTROL_ATTRIBUTE)) return;
    event.preventDefault();
    pressed = { control, again: againOf(control) };
    // Pierre opens a gap on a click, whose path it reads from the press's target, ⇧ opening all of it.
    control.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, shiftKey: event.shiftKey }),
    );
  };
  root.addEventListener("keydown", press);
  return () => {
    observer.disconnect();
    root.removeEventListener("keydown", press);
  };
}
