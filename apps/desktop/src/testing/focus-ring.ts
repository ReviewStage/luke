import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

/**
 * focus-ring.ts -- the window's stylesheets as jsdom can read them, for a test of where the keyboard's ring is drawn.
 *
 * jsdom lays nothing out, and of a stylesheet it reads only what its style
 * engine parses: it skips a cascade layer's rules, keeps a `var()` as the
 * words it is spelled in, drops the `outline` shorthand, and works out no
 * `calc` but a sum. `layWindowStyles` hands it the stylesheets in the order
 * `index.css` imports them, Tailwind's utilities compiled where they stand,
 * each resolved first: a layer's rules stand where they are written with
 * no specificity of their own, so every rule outside a layer outranks them
 * as it does in the window; every token takes its value from the window's
 * `:root` (the dark appearance, which the ring's tokens do not vary by); an
 * `overflow-clip-margin` Chromium would drop is dropped; an `outline` is
 * spelled as its longhands; and a `calc` of lengths is worked out. `ringOf` then reads what a focused control draws, and `ringClippedBy`
 * names the box around it, if any, that cuts that ring off.
 */

const STYLES = path.join(import.meta.dirname, "../renderer/styles");

/** The stylesheets `index.css` imports, in its order; the Tailwind entry is compiled rather than read. */
const SHEETS = [
  "settings.css",
  "base.css",
  "markdown.css",
  "shortcut.css",
  "tooltip.css",
  "skeleton.css",
  "sign-in.css",
  "planning.css",
  "tailwind.css",
  "desktop.css",
  "call.css",
] as const;

/** Where the block opening at `open` closes, past its closing brace. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let at = open;
  do {
    if (css[at] === "{") depth += 1;
    if (css[at] === "}") depth -= 1;
    at += 1;
  } while (depth > 0 && at < css.length);
  return at;
}

/** Where the parenthesis opening at `open` closes, past it. */
function parenEnd(css: string, open: number): number {
  let depth = 0;
  let at = open;
  do {
    if (css[at] === "(") depth += 1;
    if (css[at] === ")") depth -= 1;
    at += 1;
  } while (depth > 0 && at < css.length);
  return at;
}

/** Every rule's selector wrapped in `:where()`, so any rule outside a layer outranks it, as in the window. */
function withoutSpecificity(css: string): string {
  let out = "";
  let depth = 0;
  let prelude = "";
  for (const character of css) {
    if (depth === 0 && character === "{") {
      const selector = prelude.trim();
      out += selector.startsWith("@") ? `${selector} {` : `:where(${selector}) {`;
      prelude = "";
      depth = 1;
      continue;
    }
    if (depth === 0) {
      prelude += character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    out += character;
  }
  return out;
}

/** A sheet with every cascade layer opened up, its rules left in place and outranked by every rule outside one. */
function unlayered(sheet: string): string {
  const css = sheet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@layer [\w-]+(, [\w-]+)*;/g, "");
  let out = "";
  let from = 0;
  for (let open = css.indexOf("@layer ", from); open !== -1; open = css.indexOf("@layer ", from)) {
    const brace = css.indexOf("{", open);
    const end = blockEnd(css, brace);
    out += css.slice(from, open) + withoutSpecificity(css.slice(brace + 1, end - 1));
    from = end;
  }
  return out + css.slice(from);
}

/** The custom properties a sheet's first `:root` block declares, as written: base.css's, or Tailwind's theme's. */
function rootTokens(css: string): ReadonlyMap<string, string> {
  const start = css.search(/:root(, :host)? \{/);
  if (start === -1) return new Map();
  const block = css.slice(start, blockEnd(css, css.indexOf("{", start)));
  return new Map(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

/**
 * The token a box sets for what it holds, and so is left for each element
 * to read where it stands rather than resolved once: the ring's offset,
 * which a card that clips sets to the inset.
 */
const CASCADING_TOKEN = "--focus-ring-offset";

/** A value with every `var()` replaced by its token's value, to the depth tokens are written in terms of each other. */
function resolved(value: string, tokens: ReadonlyMap<string, string>): string {
  let out = value;
  for (let depth = 0; depth < 8; depth += 1) {
    out = out.replace(/var\((--[\w-]+)\)/g, (spelled, name: string) => tokens.get(name) ?? spelled);
  }
  return out;
}

/**
 * Every `var()` replaced by its token's value as `:root` resolves it, but a
 * use of the cascading token itself, which is left to be read where it
 * stands. Note that a token written in terms of it, as the ring's reach is,
 * takes the root's value, as it does in the window, where a custom
 * property's `var()` is resolved where the property is declared.
 */
function withTokens(css: string, tokens: ReadonlyMap<string, string>): string {
  return css.replace(/var\((--[\w-]+)\)/g, (spelled, name: string) =>
    name === CASCADING_TOKEN ? spelled : resolved(tokens.get(name) ?? spelled, tokens),
  );
}

/** A `calc` of pixel lengths, sums, differences, and products by a number, as the length it comes to. */
function workedCalc(css: string): string {
  let worked = "";
  let from = 0;
  for (let start = css.indexOf("calc(", from); start !== -1; start = css.indexOf("calc(", from)) {
    const end = parenEnd(css, start + "calc".length);
    const spelled = css.slice(start, end);
    const arithmetic = spelled
      .slice("calc".length)
      .replaceAll("calc(", "(")
      .replace(/(-?[\d.]+)px/g, "$1");
    // Note that only digits and operators are evaluated; anything else stands as written.
    const value = /^[-\d.\s+*/()]+$/.test(arithmetic)
      ? Number(Function(`return ${arithmetic};`)())
      : Number.NaN;
    worked += css.slice(from, start) + (Number.isFinite(value) ? `${value}px` : spelled);
    from = end;
  }
  return worked + css.slice(from);
}

/** The engine's reading of `overflow-clip-margin`: Chromium drops a lone `calc()` there, so the declaration is dropped as the window drops it. */
function chromiumClipMargins(css: string): string {
  return css.replace(/overflow-clip-margin:\s*calc\([^;]*;/g, "");
}

/** Every `outline: <width> <style> <colour>`, and `outline: none`, spelled as the longhands jsdom keeps. */
function outlineLonghands(css: string): string {
  return css
    .replace(/(^|[;{\s])outline:\s*(none|0)\s*;/gm, "$1outline-style: none;")
    .replace(
      /(^|[;{\s])outline:\s*([\d.]+px)\s+(solid|dashed|dotted|auto)\s+([^;]+);/gm,
      "$1outline-width: $2; outline-style: $3; outline-color: $4;",
    );
}

/** Tailwind's utilities as the build compiles them, over every class the renderer spells. */
async function tailwindSheet(): Promise<string> {
  const entry = path.join(STYLES, "tailwind.css");
  const compiler = await compile(readFileSync(entry, "utf8"), {
    base: STYLES,
    from: entry,
    onDependency: () => undefined,
  });
  return compiler.build(new Scanner({ sources: compiler.sources }).scan());
}

/** The window's stylesheets laid into the test's document, resolved for jsdom; answers the style element, which the caller removes. */
export async function layWindowStyles(): Promise<HTMLStyleElement> {
  const tailwind = await tailwindSheet();
  const written = SHEETS.map((name) =>
    name === "tailwind.css" ? tailwind : readFileSync(path.join(STYLES, name), "utf8"),
  );
  // Note that base.css's tokens are laid over the theme's, as base.css's `:root`, outside every layer, outranks it.
  const tokens = new Map([
    ...rootTokens(tailwind),
    ...rootTokens(written[SHEETS.indexOf("base.css")] ?? ""),
  ]);
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = written
    .map((css) =>
      outlineLonghands(workedCalc(chromiumClipMargins(withTokens(unlayered(css), tokens)))),
    )
    .join("\n");
  return style;
}

/** What a control draws once focused: its ring, or none. */
export type Ring = {
  readonly width: number;
  /** How far past the control's edge it stands; negative where it is drawn inside. */
  readonly offset: number;
};

/** The ring an element draws as the stylesheets stand, or none. */
export function ringOf(element: Element): Ring | undefined {
  const style = getComputedStyle(element);
  if (style.outlineStyle === "none" || style.outlineStyle === "") return undefined;
  // Note that the offset may still name the cascading token, read where the element stands.
  const offset = style
    .getPropertyValue("outline-offset")
    .replace(`var(${CASCADING_TOKEN})`, style.getPropertyValue(CASCADING_TOKEN).trim());
  return {
    width: Number.parseFloat(style.outlineWidth),
    offset: Number.parseFloat(workedCalc(offset)) || 0,
  };
}

/** How far a box that clips lets what it holds be drawn past its edge: an `overflow: clip` box's margin, none for any other. */
function clipRoom(style: CSSStyleDeclaration): number {
  if (style.overflow !== "clip") return 0;
  const margin = /([\d.]+)px/.exec(style.getPropertyValue("overflow-clip-margin"));
  return margin === null ? 0 : Number.parseFloat(margin[1] ?? "0");
}

/**
 * The nearest box around an element that cuts its ring off: one that clips
 * (`hidden` or `clip`) by less than the ring stands past the element. A
 * scroller is not counted, since what it holds is scrolled clear of its
 * edges rather than drawn past them. None where the ring is drawn inside the
 * element, or the element draws none.
 */
export function ringClippedBy(element: Element): Element | undefined {
  const ring = ringOf(element);
  if (ring === undefined || ring.offset + ring.width <= 0) return undefined;
  // Note that the window's own root boxes are left out: they clip at the window's edge, which nothing is drawn against.
  for (
    let box = element.parentElement;
    box !== null && box !== document.body;
    box = box.parentElement
  ) {
    const style = getComputedStyle(box);
    const axes = [style.overflow, style.overflowX, style.overflowY];
    if (!axes.some((value) => value === "hidden" || value === "clip")) continue;
    if (clipRoom(style) < ring.offset + ring.width) return box;
  }
  return undefined;
}

/** Moves focus as the keyboard does: a Tab pressed, which is what marks the window keyboard-driven (`keyboard-modality.ts`) and makes the focus a visible one. */
export function focusByKeyboard(element: HTMLElement): void {
  document.documentElement.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
  );
  element.focus();
  // Note that the flag is set after the focus moves, because jsdom keeps an
  // element's computed style until the document changes, and a focus alone
  // is no change to it.
  delete document.documentElement.dataset.keyboard;
  document.documentElement.dataset.keyboard = "true";
}
