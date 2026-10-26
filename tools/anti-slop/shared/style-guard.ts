import { parseSync } from "oxc-parser";

/**
 * The design system's style guard: what a stylesheet or a Tailwind class
 * string may spell outside `@luke/ui`'s tokens. docs/DESIGN.md and
 * `packages/ui/README.md` state each rule in prose; this holds them as data,
 * read by `style-guard.ts`, which `pnpm lint` runs after oxlint, since
 * oxlint reads no CSS. A rule with places left to fix starts from a baseline
 * that may only shrink (`style-baselines/`); a rule that started clean takes
 * none. Like the press guard, it has no escape hatch: no comment silences
 * it, and an exception is a file named here, never a mark on a line.
 */

export const STYLE_RULE = {
  COLOUR: "literal-colour",
  TYPE: "literal-type",
  RADIUS: "literal-radius",
  ELLIPSIS: "ellipsis",
  DURATION: "literal-duration",
  EASING: "literal-easing",
  PICKER_WIDTH: "literal-picker-width",
  SPACING: "literal-spacing",
  CURSOR: "pointer-cursor",
  CRUMB_WIDTH: "crumb-width",
  HAS_OVER_ANY: "has-over-any",
  BAR_CORNER: "bar-corner",
} as const;
export type StyleRule = (typeof STYLE_RULE)[keyof typeof STYLE_RULE];

/** What each rule refuses, and whether it started with places left to fix. */
export const STYLE_RULES: Readonly<
  Record<StyleRule, { readonly refuses: string; readonly backlog: boolean }>
> = {
  [STYLE_RULE.COLOUR]: {
    refuses: "a colour literal (hex, rgb(), hsl(), oklch(), a palette utility) outside a token",
    backlog: true,
  },
  [STYLE_RULE.TYPE]: {
    refuses: "a literal font size or weight, in a declaration or a Tailwind utility",
    backlog: true,
  },
  [STYLE_RULE.RADIUS]: {
    refuses: "a literal corner radius, 50% among them",
    backlog: true,
  },
  [STYLE_RULE.ELLIPSIS]: {
    refuses: "`text-overflow: ellipsis` or `truncate`: a cut line fades",
    backlog: true,
  },
  [STYLE_RULE.DURATION]: {
    refuses:
      "a literal duration or delay, except on an endless loop that answers a play-state token",
    backlog: false,
  },
  [STYLE_RULE.EASING]: {
    refuses: "a literal easing (`ease`, `linear`, `cubic-bezier()`) where a motion token goes",
    backlog: true,
  },
  [STYLE_RULE.PICKER_WIDTH]: {
    refuses:
      "a literal width on a picker's, popover's or menu's selector: it hangs at one of `POPOVER_WIDTH`'s three tokens",
    backlog: false,
  },
  [STYLE_RULE.SPACING]: {
    refuses:
      "a pixel or rem literal on `padding`, `margin`, `gap`, `row-gap` or `column-gap` in the panel's stylesheets: the spacing role or scale step is read (0, `1px` and `auto` pass)",
    backlog: true,
  },
  [STYLE_RULE.CURSOR]: {
    refuses:
      "the pointing hand spelled out (`cursor: pointer`, `cursor-pointer`) or a cursor chosen per profile: a control reads `cursor-press` (`--luke-cursor-press`), a real link `cursor-link` (`--luke-cursor-link`)",
    backlog: false,
  },
  [STYLE_RULE.HAS_OVER_ANY]: {
    refuses:
      "a `:has()` on an ancestor or an earlier sibling of a subject that is any element (`> *`, `> :not(.a)`): the browser then restyles the whole window for every element added under it, so the state is said on the subject's parent or by an attribute the component sets",
    backlog: false,
  },
  [STYLE_RULE.BAR_CORNER]: {
    refuses:
      "a corner radius on a bar's own box (`.luke-pane-bar`, `.luke-toolbar`), in a stylesheet or as a `rounded-*` beside its class: the sheet rounds the bar standing at its top, once, in `packages/panel/src/styles/shell.css` (\"The sheet's top\"), so no page rounds its own",
    backlog: false,
  },
  [STYLE_RULE.CRUMB_WIDTH]: {
    refuses:
      "a path's crumb drawn wider than its words: a `min-width` above zero, or a share of the room with no `max-width: max-content` on the sheet's crumbs, stands a gap before the next chevron",
    backlog: false,
  },
};

export const STYLE_RULE_IDS: readonly StyleRule[] = Object.values(STYLE_RULE);

/** The sheets that define the tokens, where every literal belongs. */
const TOKEN_SHEETS = ["packages/ui/src/tokens/", "packages/ui/src/tailwind/theme.css"];

/** Agents' own tooling, which draws nothing in the app. */
const TOOLING = [".agents/", ".claude/", ".codex/", ".cursor/", ".opencode/"];

/**
 * Files one rule passes whole: the face's motions are generated from
 * `@luke/brand`'s tables, phase by phase, and answer `--luke-face-motion`.
 */
const RULE_EXEMPT_FILES: Readonly<Partial<Record<StyleRule, readonly string[]>>> = {
  [STYLE_RULE.DURATION]: ["packages/ui/src/face/face-motion.css"],
  [STYLE_RULE.EASING]: ["packages/ui/src/face/face-motion.css"],
};

/**
 * Folders one rule passes whole: `@luke/ui` is where a popover's width is
 * drawn from its token, and the catalog's stage and rooms are its own
 * demonstration layout, not a picker.
 */
const RULE_EXEMPT_FOLDERS: Readonly<Partial<Record<StyleRule, readonly string[]>>> = {
  [STYLE_RULE.PICKER_WIDTH]: ["packages/ui/", "apps/catalog/"],
};

/**
 * Where one rule reads at all: spacing is held in the panel's own sheets,
 * where `@luke/ui`'s spacing roles are read, and a component sheet in
 * `@luke/ui` is where a role is drawn from its scale.
 */
const RULE_SCOPES: Readonly<Partial<Record<StyleRule, RegExp>>> = {
  [STYLE_RULE.SPACING]: /^packages\/panel\/src\/styles\/[^/]+\.css$/u,
};

/**
 * Custom properties that name an ink of something outside the palette: a
 * terminal's ANSI colours, a code theme's, a provider mark's brand ink.
 */
const FOREIGN_INK_PREFIXES = ["--terminal-", "--code-", "--integration-ink-"];

/** Where Tailwind class strings are read: every module Tailwind reads. */
const CLASS_SOURCE_ROOTS = ["packages/ui/src/", "packages/panel/src/", "apps/"];
const CLASS_SOURCE = /\.(?:tsx|ts|jsx|js|mjs)$/u;
const TEST_SOURCE = /(?:\.test\.|\/testing\/|\/__tests__\/|\/tests\/|\/evals\/)/u;

export const CSS_SOURCE = /\.css$/u;

export function isWatched(file: string): boolean {
  if (TOOLING.some((prefix) => file.startsWith(prefix))) return false;
  if (TOKEN_SHEETS.some((prefix) => file.startsWith(prefix))) return false;
  if (CSS_SOURCE.test(file)) return true;
  return isClassSource(file);
}

function isClassSource(file: string): boolean {
  if (!CLASS_SOURCE.test(file) || TEST_SOURCE.test(file) || file.endsWith(".d.ts")) return false;
  if (file.startsWith("apps/") && !/^apps\/[^/]+\/src\//u.test(file)) return false;
  return CLASS_SOURCE_ROOTS.some((root) => file.startsWith(root));
}

export interface StyleViolation {
  readonly rule: StyleRule;
  readonly line: number;
  readonly excerpt: string;
}

// ---------------------------------------------------------------- CSS

interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly line: number;
}

interface CssBlock {
  readonly preludes: readonly string[];
  /** The line its own prelude starts on. */
  readonly line: number;
  readonly declarations: CssDeclaration[];
  /** `@apply` lists in the block, each a class string. */
  readonly applies: { readonly classes: string; readonly line: number }[];
}

interface CssComment {
  readonly text: string;
  readonly line: number;
}

function newlines(text: string): number {
  return text.split("\n").length - 1;
}

/** The end of the string literal opening at `start`, past its closing quote. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length && text[index] !== quote && text[index] !== "\n") {
    index += text[index] === "\\" ? 2 : 1;
  }
  return Math.min(index + 1, text.length);
}

function closeStatement(block: CssBlock, buffer: string, line: number): void {
  const statement = buffer.trim();
  if (statement.startsWith("@apply")) {
    block.applies.push({ classes: statement.slice("@apply".length), line });
    return;
  }
  const colon = statement.indexOf(":");
  if (colon === -1) return;
  const property = statement.slice(0, colon).trim();
  if (!/^-{0,2}[a-zA-Z][\w-]*$/u.test(property)) return;
  block.declarations.push({
    property: property.startsWith("--") ? property : property.toLowerCase(),
    value: statement.slice(colon + 1).trim(),
    line,
  });
}

/**
 * Every block of a stylesheet with the preludes it nests under, its
 * declarations, and the sheet's comments. Note that we scan rather than
 * parse: the guard reads declarations and the rule they stand in, and a
 * scanner that knows comments, strings, and parentheses finds those in
 * nested CSS and Tailwind's at-rules alike, with no dependency.
 */
export function scanCss(text: string): {
  readonly blocks: readonly CssBlock[];
  readonly comments: readonly CssComment[];
} {
  const top: CssBlock = { preludes: [], line: 1, declarations: [], applies: [] };
  const blocks: CssBlock[] = [top];
  const stack: CssBlock[] = [top];
  const comments: CssComment[] = [];
  let buffer = "";
  let bufferLine = 1;
  let line = 1;
  let depth = 0;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      const comment = text.slice(index, end);
      comments.push({ text: comment, line });
      line += newlines(comment);
      buffer += " ";
      index = end;
      continue;
    }
    if (buffer.trim() === "" && !/\s/u.test(char)) bufferLine = line;
    if (char === '"' || char === "'") {
      const end = stringEnd(text, index);
      buffer += text.slice(index, end);
      line += newlines(text.slice(index, end));
      index = end;
      continue;
    }
    if (char === "\n") line += 1;
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    const current = stack.at(-1) ?? top;
    if (depth === 0 && char === "{") {
      const block: CssBlock = {
        preludes: [...current.preludes, buffer.trim()],
        line: bufferLine,
        declarations: [],
        applies: [],
      };
      blocks.push(block);
      stack.push(block);
      buffer = "";
    } else if (depth === 0 && (char === ";" || char === "}")) {
      closeStatement(current, buffer, bufferLine);
      if (char === "}" && stack.length > 1) stack.pop();
      buffer = "";
    } else {
      buffer += char;
    }
    index += 1;
  }
  return { blocks, comments };
}

/** A value with its strings and `url()`s taken out, which name no colour, size, or time. */
function bareValue(value: string): string {
  return value
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, '""')
    .replace(/url\([^)]*\)/giu, "url()");
}

/** A value with every `var(…)` reference taken out, fallbacks and all. */
function withoutVars(value: string): string {
  let out = "";
  let index = 0;
  while (index < value.length) {
    if (value.startsWith("var(", index)) {
      let depth = 0;
      let end = index;
      for (; end < value.length; end += 1) {
        if (value[end] === "(") depth += 1;
        if (value[end] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out += " ";
      index = end + 1;
      continue;
    }
    out += value[index];
    index += 1;
  }
  return out;
}

const COLOUR_LITERAL =
  /(?<![\w&-])#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/iu;

const WIDE_KEYWORDS = /\b(?:inherit|initial|unset|revert|revert-layer)\b/gu;

/**
 * A number left once tokens and keywords are out: a literal size, weight,
 * or radius. A zero is none, and a number with no unit is a factor of a
 * token (`calc(var(--luke-control-height) / 2)`) unless `unitless` says it
 * is a value of its own, as a weight is.
 */
function holdsLiteralNumber(value: string, unitless = false): boolean {
  const left = withoutVars(bareValue(value)).replace(WIDE_KEYWORDS, " ");
  for (const match of left.matchAll(/(?<![\w.-])((?:\d*\.)?\d+)([a-z%]*)/giu)) {
    const [, digits = "", unit = ""] = match;
    if (Number(digits) === 0) continue;
    if (unit.length > 0 || unitless) return true;
  }
  return false;
}

const SIZE_KEYWORDS =
  /\b(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)\b/u;
const WEIGHT_KEYWORDS = /\b(?:normal|bold|bolder|lighter)\b/u;

function literalType(property: string, value: string): boolean {
  const left = withoutVars(bareValue(value));
  if (property === "font-size") return holdsLiteralNumber(value) || SIZE_KEYWORDS.test(left);
  if (property === "font-weight")
    return holdsLiteralNumber(value, true) || WEIGHT_KEYWORDS.test(left);
  if (property === "font") return holdsLiteralNumber(value, true) || WEIGHT_KEYWORDS.test(left);
  return false;
}

const RADIUS_PROPERTY = /^border(?:-[a-z]+)*-radius$/u;

const LENGTH_LITERAL = /(?<![\w.#-])(?:\d*\.)?\d+(?:px|r?em|ch|vw|vh|vmin|vmax)\b/iu;

/** Whether a value spells a length in a unit, a percentage or a `var()` aside: the width of a box asked for in pixels. */
function holdsLiteralLength(value: string): boolean {
  return LENGTH_LITERAL.test(
    withoutVars(bareValue(value)).replace(/(?<![\w.#-])0+(?:\.0+)?[a-z]+/giu, " "),
  );
}

const WIDTH_PROPERTY = /^(?:min-|max-)?width$/u;

/**
 * A class that names a picker, a popover or a menu's layer: the word among
 * the class's own, so `.mention-menu` and `.settings-picker` count and
 * `.menubar` does not.
 */
const PICKER_CLASS = /^(?:[\w-]+-)?(?:picker|popover|menu|combobox)(?:-[\w-]+)?$/u;

/** The glyph, picture and field boxes that stand inside a picker, whose size is theirs, not the picker's. */
const INNER_ELEMENT = /(?:^|[\s>+~])(?:svg|img|input|textarea)(?:[:[\s]|$)/u;

/**
 * Whether a block's selector draws a picker's own box: its last compound
 * names a picker class and is no glyph or field inside one. Note that we
 * read the last compound only, because a rule's earlier parts say where it
 * stands, not what it sizes.
 */
function isPickerBox(block: CssBlock): boolean {
  const selector = selectorOf(block);
  if (selector.length === 0) return false;
  return selector.split(",").some((part) => {
    const last =
      part
        .trim()
        .split(/[\s>+~]+/u)
        .at(-1) ?? "";
    if (INNER_ELEMENT.test(` ${last}`)) return false;
    return [...last.matchAll(/\.(-?[_a-zA-Z](?:[\w-])*)/gu)].some((match) =>
      PICKER_CLASS.test(match[1] ?? ""),
    );
  });
}

const SPACING_PROPERTY =
  /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)$/u;

const SPACING_LITERAL = /(?<![\w.#])-?(?:\d*\.)?\d+(px|rem)\b/giu;

/**
 * Whether a value spells a pixel or rem length of its own: a zero is none,
 * and a hairline (`1px`, either way round) is none, being a border's width
 * rather than a space. Note that a literal inside `calc()` counts, because
 * a space built from a literal is still one.
 */
function holdsLiteralSpacing(value: string): boolean {
  const left = withoutVars(bareValue(value)).replace(WIDE_KEYWORDS, " ");
  for (const match of left.matchAll(SPACING_LITERAL)) {
    const length = Math.abs(Number.parseFloat(match[0]));
    if (length === 0) continue;
    if (length === 1 && match[1]?.toLowerCase() === "px") continue;
    return true;
  }
  return false;
}

const TIME_LITERAL = /(?<![\w.#-])(?:\d*\.)?\d+m?s\b/iu;
const ZERO_TIME = /(?<![\w.#-])0*\.?0+m?s\b/giu;
const EASING_FUNCTION = /\b(?:cubic-bezier|steps|linear)\(/u;
const EASING_KEYWORD =
  /(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)(?![\w-])/u;
const MOTION_PROPERTY = /^(?:transition|animation)(?:-[a-z-]+)?$/u;

/** The play-state tokens an endless loop answers (docs/DESIGN.md's vocabulary). */
const PLAY_STATE_TOKEN = /var\(\s*--(?:luke-)?(?:loop|face)-motion\b/u;

const FACE_MOTION_TOKEN = /var\(\s*--luke-face-motion\b/u;

/**
 * Whether a declaration is an animation the play-state exception covers:
 * one in a block whose animation answers a play-state token and either
 * never ends or follows the face's own gestures (`--luke-face-motion`),
 * whose finite companions docs/DESIGN.md lets keep a gesture's phase. A
 * transition beside it is no part of the loop and is checked as any other.
 */
function isAnsweredLoop(declaration: CssDeclaration, block: CssBlock): boolean {
  if (!declaration.property.startsWith("animation")) return false;
  const animations = block.declarations.filter(({ property }) => property.startsWith("animation"));
  const answering = animations.filter(({ value }) => PLAY_STATE_TOKEN.test(value));
  if (answering.length === 0) return false;
  const face = answering.some(({ value }) => FACE_MOTION_TOKEN.test(value));
  return face || animations.some(({ value }) => /\binfinite\b/u.test(value));
}

function literalDuration(declaration: CssDeclaration): boolean {
  return TIME_LITERAL.test(withoutVars(bareValue(declaration.value)).replace(ZERO_TIME, " "));
}

function literalEasing(declaration: CssDeclaration): boolean {
  const value = withoutVars(bareValue(declaration.value));
  if (EASING_FUNCTION.test(value)) return true;
  return MOTION_PROPERTY.test(declaration.property) && EASING_KEYWORD.test(value);
}

/** The innermost selector a declaration stands under, at-rules aside. */
function selectorOf(block: CssBlock): string {
  return block.preludes.findLast((prelude) => !prelude.startsWith("@")) ?? "";
}

/**
 * A token block, where a literal is a token's definition rather than a
 * use of one (docs/DESIGN.md's "Readability"): a `:root`, or a palette's
 * profile of one, in any sheet.
 */
function isTokenBlock(block: CssBlock): boolean {
  return /^:root(?:\[[^\]]*\])*$/u.test(selectorOf(block));
}

/**
 * An ink from outside the palette: a provider mark's brand ink, which each
 * app sets for the grounds it draws on (`packages/ui`'s AGENTS.md), or a
 * custom property a foreign theme names.
 */
function holdsForeignInk(block: CssBlock, property: string): boolean {
  if (selectorOf(block).includes(".integration-mark-")) return true;
  return FOREIGN_INK_PREFIXES.some((prefix) => property.startsWith(prefix));
}

/** The pointing hand as a cursor's own value, not a word inside a custom property's name. */
const POINTER_CURSOR = /(?<![\w-])pointer(?![\w-])/u;

/** A selector or a Tailwind variant that picks a profile, as a cursor of its own per app would. */
const PROFILE_PICK = /luke-profile/u;

/**
 * Whether a declaration chooses its own cursor where the one rule goes: the
 * hand spelled out, or any cursor set under a profile's selector, which is
 * the rule copied rather than read (profiles.css's `--luke-cursor-press`).
 */
function ownCursor(declaration: CssDeclaration, block: CssBlock): boolean {
  if (declaration.property !== "cursor") return false;
  if (POINTER_CURSOR.test(bareValue(declaration.value))) return true;
  return block.preludes.some((prelude) => PROFILE_PICK.test(prelude));
}

/** A path's landmark, whose list items are its crumbs (`@luke/ui`'s `Breadcrumbs`). */
const PATH_CLASS = /\.luke-breadcrumbs\b/u;

/** A selector with what its brackets and parentheses hold taken out, so `:has(> .x)` splits as one compound. */
function withoutArguments(selector: string): string {
  let out = selector.replace(/\[[^\]]*\]/gu, "[]");
  while (/\([^()]*\)/u.test(out)) out = out.replace(/\([^()]*\)/gu, "");
  return out;
}

/** A selector with what its brackets and parentheses hold taken out, as `withoutArguments` does, but a `:has()` inside another's, as `:not(:has(> .b))` holds one, left standing as `:has`, so a compound still says it holds one. */
function withoutArgumentsKeepingHas(selector: string): string {
  let out = selector.replace(/\[[^\]]*\]/gu, "[]");
  while (/\([^()]*\)/u.test(out)) {
    out = out.replace(/\(([^()]*)\)/gu, (_whole, inner: string) =>
      inner.includes(":has") ? ":has" : "",
    );
  }
  return out;
}

/** A subject that is any element: `*`, or pseudo-classes and pseudo-elements alone, `:is()` and `:where()` aside, which name what they match. */
const ANY_SUBJECT = /^\*?(?:::?(?!is$|where$|is:|where:)[\w-]+)*$/u;

/**
 * Whether a block's selector puts `:has()` on a compound before its last,
 * an ancestor or an earlier sibling, whose subject is any element. Note that
 * Chrome cannot tell which elements such a selector reaches, so every
 * element added anywhere under the `:has()`'s anchor restyles all of it.
 */
function hasOverAnySubject(block: CssBlock): boolean {
  return withoutArgumentsKeepingHas(selectorOf(block))
    .split(",")
    .some((part) => {
      const compounds = part
        .trim()
        .split(/[\s>+~]+/u)
        .filter((compound) => compound !== "");
      const subject = compounds.at(-1) ?? "";
      return (
        compounds.slice(0, -1).some((compound) => compound.includes(":has")) &&
        ANY_SUBJECT.test(subject)
      );
    });
}

/** Whether a block's selector draws a path's crumb: a list item, in its last compound, of a path. */
function isCrumbBox(block: CssBlock): boolean {
  return withoutArguments(selectorOf(block))
    .split(",")
    .some((part) => {
      const last =
        part
          .trim()
          .split(/[\s>+~]+/u)
          .at(-1) ?? "";
      return PATH_CLASS.test(part) && /^li(?![\w-])/u.test(last);
    });
}

/** Whether a sheet caps its crumbs at their own width, so a share of the room never stretches one. */
function capsCrumbs(blocks: readonly CssBlock[]): boolean {
  return blocks.some(
    (block) =>
      isCrumbBox(block) &&
      block.declarations.some(
        (declaration) =>
          declaration.property === "max-width" && declaration.value.trim() === "max-content",
      ),
  );
}

/**
 * Whether a declaration draws a crumb wider than its words. Note that a
 * floor is a crumb's flex basis, never its `min-width`, because a
 * `min-width` above a short crumb's words stretches its item and stands a
 * gap before the next chevron; and a crumb that takes a share of the room
 * grows only where the sheet caps crumbs at their own width.
 */
function widensCrumb(declaration: CssDeclaration, block: CssBlock, capped: boolean): boolean {
  if (!isCrumbBox(block)) return false;
  const { property, value } = declaration;
  if (property === "min-width") return !/^0(?:[a-z]+)?$/u.test(value.trim());
  const grow =
    property === "flex-grow"
      ? value.trim()
      : property === "flex"
        ? value.trim().split(/\s+/u)[0]
        : "";
  return !capped && grow !== undefined && /^\d*\.?\d+$/u.test(grow) && Number(grow) > 0;
}

/** The classes a bar's own box wears: `PaneBar`'s and `Toolbar`'s. */
const BAR_CLASS = /\.luke-(?:pane-bar|toolbar)(?![\w-])/u;

/** The sheet that rounds a bar at a sheet's top, and the radius its one rule publishes there. */
const SHEET_CORNER_FILE = "packages/panel/src/styles/shell.css";
const SHEET_CORNER_VALUE = /^var\(--sheet-top-(?:left|right)-radius, var\(--sheet-radius\)\)$/u;

/** `text` cut at each `separator` that stands outside every parenthesis and bracket. */
function splitTopLevel(text: string, separator: RegExp): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** A compound with each `:not()` and `:has()` taken out whole, however deep its own parentheses. */
function withoutNegations(compound: string): string {
  let out = "";
  let index = 0;
  while (index < compound.length) {
    const opening = /^:(?:not|has)\(/u.exec(compound.slice(index));
    if (opening === null) {
      out += compound[index];
      index += 1;
      continue;
    }
    let depth = 0;
    let end = index + opening[0].length - 1;
    for (; end < compound.length; end += 1) {
      if (compound[end] === "(") depth += 1;
      if (compound[end] === ")") depth -= 1;
      if (depth === 0) break;
    }
    index = end + 1;
  }
  return out;
}

/**
 * Whether a block's selector draws a bar's own box: a bar's class in the
 * last compound of one of its selectors, an `:is()` or `:where()` there
 * included, and a `:not()` or `:has()` there aside, which name boxes the
 * subject is not or holds.
 */
function isBarBox(block: CssBlock): boolean {
  return splitTopLevel(selectorOf(block), /,/u).some((part) => {
    const last = splitTopLevel(part, /[\s>+~]/u).at(-1) ?? "";
    return BAR_CLASS.test(withoutNegations(last));
  });
}

/**
 * Whether a declaration rounds a bar by hand. Note that the one rule that
 * rounds a bar, at a sheet's top, reads the radius the sheet publishes, so
 * a copy of it elsewhere, or a page's own radius on its bar, is refused.
 */
function roundsBar(declaration: CssDeclaration, block: CssBlock, file: string): boolean {
  if (!RADIUS_PROPERTY.test(declaration.property) || !isBarBox(block)) return false;
  return !(file === SHEET_CORNER_FILE && SHEET_CORNER_VALUE.test(declaration.value.trim()));
}

function cssRuleOf(declaration: CssDeclaration, block: CssBlock): StyleRule | undefined {
  const { property, value } = declaration;
  const bare = bareValue(value);
  if (isTokenBlock(block)) return undefined;
  if (ownCursor(declaration, block)) return STYLE_RULE.CURSOR;
  if (property === "text-overflow" && /\bellipsis\b/u.test(bare)) return STYLE_RULE.ELLIPSIS;
  if (RADIUS_PROPERTY.test(property) && holdsLiteralNumber(value)) return STYLE_RULE.RADIUS;
  if (literalType(property, value)) return STYLE_RULE.TYPE;
  if (WIDTH_PROPERTY.test(property) && holdsLiteralLength(value) && isPickerBox(block)) {
    return STYLE_RULE.PICKER_WIDTH;
  }
  if (SPACING_PROPERTY.test(property) && holdsLiteralSpacing(value)) return STYLE_RULE.SPACING;
  const loop = isAnsweredLoop(declaration, block);
  if (!loop && literalDuration(declaration)) return STYLE_RULE.DURATION;
  if (!loop && literalEasing(declaration)) return STYLE_RULE.EASING;
  const mask = /^(?:-webkit-)?mask/u.test(property);
  if (!mask && !holdsForeignInk(block, property) && COLOUR_LITERAL.test(bare))
    return STYLE_RULE.COLOUR;
  return undefined;
}

// ------------------------------------------------------- Tailwind classes

/** The names `@luke/ui`'s Tailwind theme maps onto tokens, by namespace. */
export interface ThemeNames {
  readonly [namespace: string]: ReadonlySet<string>;
}

const THEME_NAMESPACES = ["color", "text", "radius", "ease", "animate", "font-weight"];

/** The names each theme namespace maps, read from `@luke/ui`'s theme sheet. */
export function themeNames(themeSheet: string): ThemeNames {
  const names: Record<string, Set<string>> = {};
  for (const namespace of THEME_NAMESPACES) names[namespace] = new Set();
  for (const block of scanCss(themeSheet).blocks) {
    if (!block.preludes.some((prelude) => prelude.startsWith("@theme"))) continue;
    for (const { property } of block.declarations) {
      for (const namespace of THEME_NAMESPACES) {
        const prefix = `--${namespace}-`;
        if (!property.startsWith(prefix)) continue;
        const name = property.slice(prefix.length);
        if (!name.includes("--")) names[namespace]?.add(name);
      }
    }
  }
  return names;
}

const PALETTE =
  /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$|^(?:black|white)$/u;
const COLOUR_UTILITY =
  /^(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|inset-ring|outline|fill|stroke|from|via|to|decoration|divide|placeholder|accent|caret|shadow|inset-shadow|drop-shadow)-(.+)$/u;
const TYPE_SCALE = /^(?:xs|sm|base|lg|xl|\dxl)$/u;
const WEIGHTS = /^(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/u;
const RADIUS_UTILITY = /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee|x|y))?(?:-(.+))?$/u;
const TOKEN_ARBITRARY = /^(?:\[var\(--luke-[\w-]+\)\]|\(--luke-[\w-]+\))$/u;
const LENGTH_ARBITRARY = /^\[(?:length:)?-?(?:\d*\.)?\d+[a-z%]*\]$/u;

/** A class with its variants, important mark, negation, and modifier taken off. */
function utilityOf(token: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) start = index + 1;
  }
  return token
    .slice(start)
    .replace(/^[!-]+|!$/gu, "")
    .replace(/\/[\w.[\]()-]+$/u, "");
}

function themeHas(names: ThemeNames, namespace: string, name: string): boolean {
  return names[namespace]?.has(name) === true;
}

function classRuleOf(token: string, names: ThemeNames): StyleRule | undefined {
  const utility = utilityOf(token);
  if (utility === "truncate" || utility === "text-ellipsis") return STYLE_RULE.ELLIPSIS;
  if (/^cursor-(?:pointer|\[pointer\])$/u.test(utility)) return STYLE_RULE.CURSOR;
  if (utility.startsWith("cursor-") && PROFILE_PICK.test(token)) return STYLE_RULE.CURSOR;
  const text = /^text-(.+)$/u.exec(utility)?.[1];
  if (text !== undefined && !themeHas(names, "text", text)) {
    if (TYPE_SCALE.test(text) || LENGTH_ARBITRARY.test(text)) return STYLE_RULE.TYPE;
  }
  const weight = /^font-(.+)$/u.exec(utility)?.[1];
  if (weight !== undefined && !themeHas(names, "font-weight", weight)) {
    if (WEIGHTS.test(weight) || /^\[\d+\]$/u.test(weight)) return STYLE_RULE.TYPE;
  }
  const radius = RADIUS_UTILITY.exec(utility);
  if (radius !== null) {
    const size = radius[1];
    const keyword = size === "none" || size === "full";
    const token =
      size !== undefined && (themeHas(names, "radius", size) || TOKEN_ARBITRARY.test(size));
    if (!keyword && !token) return STYLE_RULE.RADIUS;
  }
  const motion = /^(duration|delay|ease|animate)-(.+)$/u.exec(utility);
  if (motion !== null) {
    const [, kind = "", value = ""] = motion;
    const named = kind === "ease" || kind === "animate" ? themeHas(names, kind, value) : false;
    if (!named && value !== "none" && !TOKEN_ARBITRARY.test(value)) {
      return kind === "ease" ? STYLE_RULE.EASING : STYLE_RULE.DURATION;
    }
  }
  const colour = COLOUR_UTILITY.exec(utility)?.[1];
  if (colour !== undefined && !themeHas(names, "color", colour)) {
    if (PALETTE.test(colour) || (colour.startsWith("[") && COLOUR_LITERAL.test(colour))) {
      return STYLE_RULE.COLOUR;
    }
  }
  return undefined;
}

/**
 * A string reads as a class list when every word could be a utility: no
 * capital, no sentence punctuation, past what an arbitrary value's
 * brackets hold (`content-['·']`). Note that we ask this of the whole
 * string, because a word like `truncate` in a sentence is no class.
 */
export function isClassList(text: string): boolean {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  return (
    words.length > 0 &&
    words.every((word) =>
      /^[!a-z0-9@*&[\]():%#_.,/'=>~+-]+$/u.test(word.replace(/\[[^\]]*\]/gu, "[]")),
    )
  );
}

function classViolations(
  classes: string,
  line: number,
  names: ThemeNames,
): readonly StyleViolation[] {
  if (!isClassList(classes)) return [];
  const violations: StyleViolation[] = [];
  const tokens = classes.split(/\s+/u).filter((token) => token.length > 0);
  const bar = tokens.some((token) => BAR_CLASS.test(`.${token}`));
  for (const token of tokens) {
    const rule = classRuleOf(token, names);
    if (rule !== undefined) violations.push({ rule, line, excerpt: token });
    const rounded = RADIUS_UTILITY.exec(utilityOf(token));
    if (bar && rounded !== null && rounded[1] !== "none") {
      violations.push({ rule: STYLE_RULE.BAR_CORNER, line, excerpt: token });
    }
  }
  return violations;
}

/** The 1-based line of each offset, by a search over where the lines start. */
function lineFinder(text: string): (offset: number) => number {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

/**
 * Every string a module spells, with its line, a module's import and export
 * sources aside: the class strings among them are what is checked. Note
 * that we parse rather than scan, because JSX text is full of apostrophes.
 */
function moduleStrings(file: string, text: string): readonly { text: string; line: number }[] {
  const lineOf = lineFinder(text);
  const strings: { text: string; line: number }[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const type: unknown = Reflect.get(node, "type");
    const start = Number(Reflect.get(node, "start"));
    if (type === "Literal" && typeof Reflect.get(node, "value") === "string") {
      strings.push({ text: String(Reflect.get(node, "value")), line: lineOf(start) });
      return;
    }
    if (type === "TemplateElement") {
      const value: unknown = Reflect.get(node, "value");
      const cooked =
        value !== null && typeof value === "object" ? Reflect.get(value, "cooked") : "";
      strings.push({ text: typeof cooked === "string" ? cooked : "", line: lineOf(start) });
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "source" && typeof type === "string" && /Import|Export/u.test(type)) continue;
      visit(Reflect.get(node, key));
    }
  };
  visit(parseSync(file, text).program);
  return strings;
}

// ------------------------------------------------------------ the guard

/** What would silence the guard, which nothing may: a comment naming it or stylelint. */
const DISABLE_COMMENT = /\b(?:style-guard|stylelint)-(?:disable|ignore)\b/u;

/** The 1-based lines of a stylesheet holding a comment that asks to silence the guard. */
export function styleSuppressionLines(text: string): readonly number[] {
  return scanCss(text)
    .comments.filter((comment) => DISABLE_COMMENT.test(comment.text))
    .map((comment) => comment.line);
}

/** Every place `file`, holding `text`, breaks a style rule. */
export function styleViolations(
  file: string,
  text: string,
  names: ThemeNames,
): readonly StyleViolation[] {
  if (!isWatched(file)) return [];
  const violations: StyleViolation[] = [];
  if (CSS_SOURCE.test(file)) {
    const { blocks } = scanCss(text);
    const capped = capsCrumbs(blocks);
    for (const block of blocks) {
      if (block.declarations.length > 0 && hasOverAnySubject(block)) {
        violations.push({
          rule: STYLE_RULE.HAS_OVER_ANY,
          line: block.line,
          excerpt: selectorOf(block),
        });
      }
      for (const declaration of block.declarations) {
        const rule =
          cssRuleOf(declaration, block) ??
          (widensCrumb(declaration, block, capped) ? STYLE_RULE.CRUMB_WIDTH : undefined) ??
          (roundsBar(declaration, block, file) ? STYLE_RULE.BAR_CORNER : undefined);
        if (rule === undefined) continue;
        violations.push({
          rule,
          line: declaration.line,
          excerpt: `${declaration.property}: ${declaration.value}`,
        });
      }
      for (const apply of block.applies) {
        violations.push(...classViolations(apply.classes, apply.line, names));
      }
    }
  } else {
    for (const string of moduleStrings(file, text)) {
      violations.push(...classViolations(string.text, string.line, names));
    }
  }
  return violations.filter(
    (violation) =>
      RULE_SCOPES[violation.rule]?.test(file) !== false &&
      !RULE_EXEMPT_FILES[violation.rule]?.includes(file) &&
      !RULE_EXEMPT_FOLDERS[violation.rule]?.some((folder) => file.startsWith(folder)),
  );
}
