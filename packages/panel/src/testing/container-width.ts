import base from "@luke/panel/styles/base.css?raw";
import call from "@luke/panel/styles/call.css?raw";
import desktop from "@luke/panel/styles/desktop.css?raw";
import issues from "@luke/panel/styles/issues.css?raw";
import markdown from "@luke/panel/styles/markdown.css?raw";
import settings from "@luke/panel/styles/settings.css?raw";
import shortcut from "@luke/panel/styles/shortcut.css?raw";
import signIn from "@luke/panel/styles/sign-in.css?raw";
import tasks from "@luke/panel/styles/tasks.css?raw";
import tooltip from "@luke/panel/styles/tooltip.css?raw";

/**
 * container-width.ts -- the panel's stylesheets as containers of given widths, under a mouse or on a touch screen, read them, for jsdom, which lays nothing out and answers no container query and no input media query.
 *
 * A component that answers its own width does so through `@container`
 * rules: the composer's foot (tasks.css), a banner's stacked layout
 * (desktop.css). One that answers the input does so through `@media
 * (hover: …)` and `(pointer: …)`. jsdom drops both whole, so
 * `layContainersAt` hands back the stylesheets with each such query resolved
 * for the layout asked: its rules standing where the container is that
 * narrow (or that wide), or the input is that one, and gone where not. A
 * named query reads its container's width by name, an unnamed one the
 * width given for the nearest container, and a query on a container the
 * test names no width for is dropped, as jsdom would. Laid into the test's
 * document, they let `getComputedStyle` say what the component draws at
 * that width, which `shown` reads up the element's ancestors.
 */

/** The panel's stylesheets, in the order the desktop's `index.css` imports them. */
const SHEETS = [
  settings,
  base,
  markdown,
  shortcut,
  tooltip,
  signIn,
  tasks,
  desktop,
  issues,
  call,
] as const;

/** What each input feature answers under a mouse and on a touch screen. */
const INPUT_FEATURES = {
  hover: { mouse: "hover", touch: "none" },
  "any-hover": { mouse: "hover", touch: "none" },
  pointer: { mouse: "fine", touch: "coarse" },
  "any-pointer": { mouse: "fine", touch: "coarse" },
} as const;

type InputFeature = keyof typeof INPUT_FEATURES;

/**
 * A container query with one width condition, its name where it has one, or
 * a media query on one input feature, through the brace that opens its block.
 */
const QUERY = new RegExp(
  String.raw`@container (?:([a-z-]+) )?\((?:(max-width|min-width): (\d+)px|width (<|<=|>|>=) (\d+)px)\) \{` +
    String.raw`|@media \((${Object.keys(INPUT_FEATURES).join("|")}): ([a-z]+)\) \{`,
  "g",
);

/** Whether a feature a query names is one of the input's. */
function isInputFeature(feature: string): feature is InputFeature {
  return Object.hasOwn(INPUT_FEATURES, feature);
}

/** What the sheets are laid for beyond the named containers' widths. */
export interface ContainerLayout {
  /** The nearest container's width, which an unnamed `@container` query reads; its rules are dropped where none is given. */
  readonly unnamed?: number;
  /** Whether the input is a touch screen, which cannot hover and points coarsely, rather than a mouse. */
  readonly touch?: boolean;
}

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
function widthHolds(width: number, comparison: string, length: number): boolean {
  if (comparison === "max-width" || comparison === "<=") return width <= length;
  if (comparison === "min-width" || comparison === ">=") return width >= length;
  if (comparison === "<") return width < length;
  return width > length;
}

/** Whether a query matched by `QUERY` holds for the layout given. */
function holds(
  query: RegExpExecArray,
  widths: Readonly<Record<string, number>>,
  layout: ContainerLayout,
): boolean {
  const [, name, word, wordLength, sign, signLength, feature, value] = query;
  if (feature !== undefined) {
    if (!isInputFeature(feature)) return false;
    const answers = INPUT_FEATURES[feature];
    return (layout.touch === true ? answers.touch : answers.mouse) === value;
  }
  const width = name === undefined ? layout.unnamed : widths[name];
  return (
    width !== undefined && widthHolds(width, word ?? sign ?? "", Number(wordLength ?? signLength))
  );
}

/** A stylesheet with every query `QUERY` matches resolved for the layout given, those nested in a block that stands included. */
function resolvedAt(
  css: string,
  widths: Readonly<Record<string, number>>,
  layout: ContainerLayout,
): string {
  const queries = new RegExp(QUERY);
  let resolved = "";
  let from = 0;
  for (let query = queries.exec(css); query !== null; query = queries.exec(css)) {
    const open = query.index + query[0].length;
    const end = blockEnd(css, open);
    resolved += css.slice(from, query.index);
    if (holds(query, widths, layout))
      resolved += resolvedAt(css.slice(open, end - 1), widths, layout);
    from = end;
    queries.lastIndex = end;
  }
  return resolved + css.slice(from);
}

/** Lays the stylesheets into the document for named containers of the widths given, and the rest of the layout, answering the style element, which the caller removes. */
export function layContainersAt(
  widths: Readonly<Record<string, number>>,
  layout: ContainerLayout = {},
): HTMLStyleElement {
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = SHEETS.map((css) => resolvedAt(css, widths, layout)).join("\n");
  return style;
}

/** Whether an element is drawn at all: neither it nor any box around it is `display: none`. */
export function shown(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).display === "none") return false;
  }
  return true;
}
