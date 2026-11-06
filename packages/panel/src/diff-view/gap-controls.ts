import { GAP_CONTROL, GAP_CONTROL_ATTRIBUTE, GAP_LINES } from "./contract.js";

const GAP_WORDS = {
  MORE: `Show ${GAP_LINES} more lines`,
  REST: "Show the rest of the file",
  every: (lines: number) => (lines === 1 ? "Show 1 line" : `Show all ${lines} lines`),
} as const;

const OPENABLE = "[data-separator][data-expand-index]";

const SEEN = `[data-gutter] ${OPENABLE}`;

const CODE_ROWS = "[data-content]";

const WORDS = "[data-unmodified-lines]";

const ARROWS = "[data-expand-button]:not([data-expand-all-button])";

const PIERRE_ALL = "[data-expand-button][data-expand-all-button]";

const ALL_MARK = "data-expand-all-button";

const ARROW_WAYS = ["data-expand-up", "data-expand-down", "data-expand-both"] as const;

function wordsOf(words: Element): string {
  const lines = Number.parseInt(words.textContent ?? "", 10);
  return Number.isNaN(lines) ? GAP_WORDS.REST : GAP_WORDS.every(lines);
}

function arrowWordsOf(arrow: Element): string {
  const band = arrow.closest("[data-separator-wrapper]");
  const words = band?.querySelector(WORDS);
  const lines = Number.parseInt(words?.textContent ?? "", 10);
  if (band?.querySelector(PIERRE_ALL) != null || words == null || Number.isNaN(lines)) {
    return GAP_WORDS.MORE;
  }
  return GAP_WORDS.every(lines);
}

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

function againOf(control: Element): string | undefined {
  const index = control.closest(OPENABLE)?.getAttribute("data-expand-index");
  if (index == null) return undefined;
  const way = ARROW_WAYS.find((each) => control.hasAttribute(each));
  return `[data-gutter] [data-expand-index="${index}"] ${way === undefined ? WORDS : `[${way}]`}`;
}

function focusAgain(root: ShadowRoot, again: string): void {
  for (const control of root.querySelectorAll<HTMLElement>(again)) {
    control.focus({ preventScroll: true });
    if (root.activeElement === control) return;
  }
}

export function watchGapControls(root: ShadowRoot): () => void {
  let pressed: { readonly control: Element; readonly again: string | undefined } | undefined;
  const observer = new MutationObserver((records) => {
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
