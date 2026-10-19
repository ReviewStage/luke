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
import ui from "@luke/ui/styles.css?inline";
import tokens from "@luke/ui/tokens.css?inline";

/**
 * container-width.ts -- the panel's stylesheets as containers of given widths, on a given kind of device, read them, for jsdom, which lays nothing out and answers no container, media, or layer rule.
 *
 * A component that answers its own width does so through `@container`
 * rules: the composer's foot (tasks.css), a banner's stacked layout
 * (desktop.css). jsdom drops a container query whole, so `layContainersAt`
 * hands back the stylesheets with each query resolved for the widths asked:
 * its rules standing where the container is that narrow (or that wide), and
 * gone where it is not. A named query reads its container's width by name,
 * an unnamed one the width given for the nearest container, and a query on
 * a container the test names no width for is dropped, as jsdom would.
 *
 * A control shown only under the pointer answers the device through an
 * input-type media query, `(hover: …)` or `(pointer: …)`, which jsdom
 * drops too: each is resolved for a touch screen (no hover, a coarse
 * pointer) where the layout says `touch`, and for a mouse (hover, a fine
 * pointer) where it does not. Every other media query is left for jsdom to
 * drop.
 *
 * The shared tokens (`@luke/ui/tokens.css`) are laid first, so a root
 * wearing a profile and a density reads its roles, and a query that rules
 * a coarse pointer out (`not all and (pointer: coarse)`) is resolved as its
 * opposite. The shared components' sheet (`@luke/ui/styles.css`) is laid
 * where the desktop's `index.css` imports it, and each `@layer` block's rules, which
 * jsdom would drop, are laid ahead of every unlayered rule, layer by layer
 * in the order the layers first appear, as the cascade orders them. Note
 * that jsdom still weighs a selector's specificity across layers, which the
 * cascade does not. Laid into the test's document, they let
 * `getComputedStyle` say what the component draws at that width, which
 * `shown` reads up the element's ancestors.
 */

/** The shared tokens, the panel's stylesheets, and the shared components' beneath them, in the order the desktop's `index.css` imports them. */
const SHEETS = [
  tokens,
  settings,
  base,
  ui,
  markdown,
  shortcut,
  tooltip,
  signIn,
  tasks,
  desktop,
  issues,
  call,
] as const;

/**
 * An at-rule resolved here, through the brace that opens its block: a
 * container query with one width condition and its name where it has one,
 * an input-type media query, or a named layer.
 */
const AT_RULE =
  /@container (?:([a-z-]+) )?\((?:(max-width|min-width): (\d+)px|width (<|<=|>|>=) (\d+)px)\) \{|@media (not all and )?\((hover|pointer): ([a-z]+)\) \{|@layer ([a-z-]+) \{/g;

/** What each device answers the input-type features: on a touch screen nothing hovers and the pointer is a finger; a mouse hovers, finely. */
const DEVICE = {
  TOUCH: { hover: "none", pointer: "coarse" },
  MOUSE: { hover: "hover", pointer: "fine" },
} as const;

/** What the sheets are laid for beyond the named containers' widths. */
export interface ContainerLayout {
  /** The nearest container's width, which an unnamed `@container` query reads; its rules are dropped where none is given. */
  readonly unnamed?: number;
  /** Whether the device is a touch screen, which `(hover: none)` and `(pointer: coarse)` rules answer; a mouse's where left out. */
  readonly touch?: boolean;
}

/** What the sheets are resolved for: the named containers' widths and the rest of the layout. */
interface Resolution {
  readonly widths: Readonly<Record<string, number>>;
  readonly layout: ContainerLayout;
  /** Each layer's rules, gathered by its name in the order the layers first appear. */
  readonly layers: Map<string, string[]>;
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

/** Whether a container or media query matched by `AT_RULE` holds for the layout given. */
function holds(query: RegExpExecArray, resolution: Resolution): boolean {
  const [, name, word, wordLength, sign, signLength, negated, feature, value] = query;
  const { widths, layout } = resolution;
  if (feature !== undefined) {
    const answers = Object.entries(layout.touch === true ? DEVICE.TOUCH : DEVICE.MOUSE);
    const answered = answers.some(([asked, answer]) => asked === feature && answer === value);
    return negated === undefined ? answered : !answered;
  }
  const width = name === undefined ? layout.unnamed : widths[name];
  return (
    width !== undefined && widthHolds(width, word ?? sign ?? "", Number(wordLength ?? signLength))
  );
}

/** A stylesheet's unlayered rules with every query resolved for the layout given, those nested in a block that stands included; its layers' rules are gathered into the resolution. */
function resolvedAt(css: string, resolution: Resolution): string {
  const rules = new RegExp(AT_RULE);
  let resolved = "";
  let from = 0;
  for (let rule = rules.exec(css); rule !== null; rule = rules.exec(css)) {
    const open = rule.index + rule[0].length;
    const end = blockEnd(css, open);
    const layer = rule[9];
    resolved += css.slice(from, rule.index);
    if (layer !== undefined) {
      const gathered = resolution.layers.get(layer) ?? [];
      resolution.layers.set(layer, gathered);
      gathered.push(resolvedAt(css.slice(open, end - 1), resolution));
    } else if (holds(rule, resolution)) {
      resolved += resolvedAt(css.slice(open, end - 1), resolution);
    }
    from = end;
    rules.lastIndex = end;
  }
  return resolved + css.slice(from);
}

/** Lays the stylesheets into the document for named containers of the widths given, the nearest one's, and the device given, answering the style element, which the caller removes. */
export function layContainersAt(
  widths: Readonly<Record<string, number>>,
  layout: ContainerLayout = {},
): HTMLStyleElement {
  const resolution: Resolution = { widths, layout, layers: new Map() };
  const unlayered = SHEETS.map((css) => resolvedAt(css, resolution));
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = [...[...resolution.layers.values()].flat(), ...unlayered].join("\n");
  return style;
}

/** Whether an element is drawn at all: neither it nor any box around it is `display: none`. */
export function shown(element: Element): boolean {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).display === "none") return false;
  }
  return true;
}
