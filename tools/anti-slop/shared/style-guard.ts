import { parseSync } from "oxc-parser";

export const STYLE_RULE = {
  COLOR: "literal-color",
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
  GRID_COLUMNS: "grid-columns",
} as const;
export type StyleRule = (typeof STYLE_RULE)[keyof typeof STYLE_RULE];

export const STYLE_RULES: Readonly<
  Record<StyleRule, { readonly refuses: string; readonly backlog: boolean }>
> = {
  [STYLE_RULE.COLOR]: {
    refuses: "a color literal (hex, rgb(), hsl(), oklch(), a palette utility) outside a token",
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
      "the pointing hand spelled out (`cursor: pointer`, `cursor-pointer`) or a cursor chosen per profile: a control reads `cursor-press` (`--ui-cursor-press`), a real link `cursor-link` (`--ui-cursor-link`)",
    backlog: false,
  },
  [STYLE_RULE.HAS_OVER_ANY]: {
    refuses:
      "a `:has()` on an ancestor or an earlier sibling of a subject that is any element (`> *`, `> :not(.a)`): the browser then restyles the whole window for every element added under it, so the state is said on the subject's parent or by an attribute the component sets",
    backlog: false,
  },
  [STYLE_RULE.BAR_CORNER]: {
    refuses:
      "a corner radius on a bar's own box (`.ui-pane-bar`, `.ui-toolbar`), in a stylesheet or as a `rounded-*` beside its class: the sheet rounds the bar standing at its top, once, in `packages/panel/src/styles/shell.css` (\"The sheet's top\"), so no page rounds its own",
    backlog: false,
  },
  [STYLE_RULE.CRUMB_WIDTH]: {
    refuses:
      "a path's crumb drawn wider than its words: a `min-width` above zero, or a share of the room with no `max-width: max-content` on the sheet's crumbs, stands a gap before the next chevron",
    backlog: false,
  },
  [STYLE_RULE.GRID_COLUMNS]: {
    refuses:
      "a grid that places its items (`place-items-*`, `justify-items-*`) and names no columns: its one `auto` column grows to its item's widest line, so a card or a sheet centered in it stands off the screen's edge on a phone",
    backlog: true,
  },
};

export const STYLE_RULE_IDS: readonly StyleRule[] = Object.values(STYLE_RULE);

const TOKEN_SHEETS = ["packages/ui/src/tokens/", "packages/ui/src/tailwind/theme.css"];

const TOOLING = [".agents/", ".claude/"];

const RULE_EXEMPT_FOLDERS: Readonly<Partial<Record<StyleRule, readonly string[]>>> = {
  [STYLE_RULE.PICKER_WIDTH]: ["packages/ui/", "apps/catalog/"],
};

const RULE_SCOPES: Readonly<Partial<Record<StyleRule, RegExp>>> = {
  [STYLE_RULE.SPACING]: /^packages\/panel\/src\/styles\/[^/]+\.css$/u,
};

const FOREIGN_INK_PREFIXES = ["--terminal-", "--code-", "--integration-ink-"];

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

interface CssDeclaration {
  readonly property: string;
  readonly value: string;
  readonly line: number;
}

interface CssBlock {
  readonly preludes: readonly string[];
  readonly line: number;
  readonly declarations: CssDeclaration[];
  readonly applies: { readonly classes: string; readonly line: number }[];
}

interface CssComment {
  readonly text: string;
  readonly line: number;
}

function newlines(text: string): number {
  return text.split("\n").length - 1;
}

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

function bareValue(value: string): string {
  return value
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, '""')
    .replace(/url\([^)]*\)/giu, "url()");
}

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

const COLOR_LITERAL =
  /(?<![\w&-])#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/iu;

const WIDE_KEYWORDS = /\b(?:inherit|initial|unset|revert|revert-layer)\b/gu;

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

function holdsLiteralLength(value: string): boolean {
  return LENGTH_LITERAL.test(
    withoutVars(bareValue(value)).replace(/(?<![\w.#-])0+(?:\.0+)?[a-z]+/giu, " "),
  );
}

const WIDTH_PROPERTY = /^(?:min-|max-)?width$/u;

const PICKER_CLASS = /^(?:[\w-]+-)?(?:picker|popover|menu|combobox)(?:-[\w-]+)?$/u;

const INNER_ELEMENT = /(?:^|[\s>+~])(?:svg|img|input|textarea)(?:[:[\s]|$)/u;

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

const PLAY_STATE_TOKEN = /var\(\s*--(?:ui-)?loop-motion\b/u;

function isAnsweredLoop(declaration: CssDeclaration, block: CssBlock): boolean {
  if (!declaration.property.startsWith("animation")) return false;
  const animations = block.declarations.filter(({ property }) => property.startsWith("animation"));
  const answering = animations.filter(({ value }) => PLAY_STATE_TOKEN.test(value));
  if (answering.length === 0) return false;
  return animations.some(({ value }) => /\binfinite\b/u.test(value));
}

function literalDuration(declaration: CssDeclaration): boolean {
  return TIME_LITERAL.test(withoutVars(bareValue(declaration.value)).replace(ZERO_TIME, " "));
}

function literalEasing(declaration: CssDeclaration): boolean {
  const value = withoutVars(bareValue(declaration.value));
  if (EASING_FUNCTION.test(value)) return true;
  return MOTION_PROPERTY.test(declaration.property) && EASING_KEYWORD.test(value);
}

function selectorOf(block: CssBlock): string {
  return block.preludes.findLast((prelude) => !prelude.startsWith("@")) ?? "";
}

function isTokenBlock(block: CssBlock): boolean {
  return /^:root(?:\[[^\]]*\])*$/u.test(selectorOf(block));
}

function holdsForeignInk(block: CssBlock, property: string): boolean {
  if (selectorOf(block).includes(".integration-mark-")) return true;
  return FOREIGN_INK_PREFIXES.some((prefix) => property.startsWith(prefix));
}

const POINTER_CURSOR = /(?<![\w-])pointer(?![\w-])/u;

const PROFILE_PICK = /ui-profile/u;

function ownCursor(declaration: CssDeclaration, block: CssBlock): boolean {
  if (declaration.property !== "cursor") return false;
  if (POINTER_CURSOR.test(bareValue(declaration.value))) return true;
  return block.preludes.some((prelude) => PROFILE_PICK.test(prelude));
}

const PATH_CLASS = /\.ui-breadcrumbs\b/u;

function withoutArguments(selector: string): string {
  let out = selector.replace(/\[[^\]]*\]/gu, "[]");
  while (/\([^()]*\)/u.test(out)) out = out.replace(/\([^()]*\)/gu, "");
  return out;
}

function withoutArgumentsKeepingHas(selector: string): string {
  let out = selector.replace(/\[[^\]]*\]/gu, "[]");
  while (/\([^()]*\)/u.test(out)) {
    out = out.replace(/\(([^()]*)\)/gu, (_whole, inner: string) =>
      inner.includes(":has") ? ":has" : "",
    );
  }
  return out;
}

const ANY_SUBJECT = /^\*?(?:::?(?!is$|where$|is:|where:)[\w-]+)*$/u;

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

const BAR_CLASS = /\.ui-(?:pane-bar|toolbar)(?![\w-])/u;

const SHEET_CORNER_FILE = "packages/panel/src/styles/shell.css";
const SHEET_CORNER_VALUE = /^var\(--sheet-top-(?:left|right)-radius, var\(--sheet-radius\)\)$/u;

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

function isBarBox(block: CssBlock): boolean {
  return splitTopLevel(selectorOf(block), /,/u).some((part) => {
    const last = splitTopLevel(part, /[\s>+~]/u).at(-1) ?? "";
    return BAR_CLASS.test(withoutNegations(last));
  });
}

function roundsBar(declaration: CssDeclaration, block: CssBlock, file: string): boolean {
  if (!RADIUS_PROPERTY.test(declaration.property) || !isBarBox(block)) return false;
  return !(file === SHEET_CORNER_FILE && SHEET_CORNER_VALUE.test(declaration.value.trim()));
}

const ITEMS_PLACEMENT = /^(?:place|justify)-items$/u;

const COLUMNS_NAMED = /^grid(?:-template(?:-columns)?)?$/u;

const BOUNDED_COLUMN = /minmax\(\s*0\s*,/u;

function autoColumnGrid(block: CssBlock): CssDeclaration | undefined {
  const display = block.declarations.find(
    (declaration) => declaration.property === "display" && declaration.value.trim() === "grid",
  );
  if (display === undefined) return undefined;
  const places = block.declarations.some((declaration) =>
    ITEMS_PLACEMENT.test(declaration.property),
  );
  const named = block.declarations.some(
    (declaration) =>
      COLUMNS_NAMED.test(declaration.property) && BOUNDED_COLUMN.test(declaration.value),
  );
  return places && !named ? display : undefined;
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
  if (!mask && !holdsForeignInk(block, property) && COLOR_LITERAL.test(bare))
    return STYLE_RULE.COLOR;
  return undefined;
}

export interface ThemeNames {
  readonly [namespace: string]: ReadonlySet<string>;
}

const THEME_NAMESPACES = ["color", "text", "radius", "ease", "animate", "font-weight"];

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
const COLOR_UTILITY =
  /^(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|inset-ring|outline|fill|stroke|from|via|to|decoration|divide|placeholder|accent|caret|shadow|inset-shadow|drop-shadow)-(.+)$/u;
const TYPE_SCALE = /^(?:xs|sm|base|lg|xl|\dxl)$/u;
const WEIGHTS = /^(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/u;
const RADIUS_UTILITY = /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee|x|y))?(?:-(.+))?$/u;
const TOKEN_ARBITRARY = /^(?:\[var\(--ui-[\w-]+\)\]|\(--ui-[\w-]+\))$/u;
const LENGTH_ARBITRARY = /^\[(?:length:)?-?(?:\d*\.)?\d+[a-z%]*\]$/u;

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
  const color = COLOR_UTILITY.exec(utility)?.[1];
  if (color !== undefined && !themeHas(names, "color", color)) {
    if (PALETTE.test(color) || (color.startsWith("[") && COLOR_LITERAL.test(color))) {
      return STYLE_RULE.COLOR;
    }
  }
  return undefined;
}

export function isClassList(text: string): boolean {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  return (
    words.length > 0 &&
    words.every((word) =>
      /^[!a-z0-9@*&[\]():%#_.,/'=>~+-]+$/u.test(word.replace(/\[[^\]]*\]/gu, "[]")),
    )
  );
}

const ITEMS_UTILITY = /^(?:place|justify)-items-/u;

const BOUNDED_COLUMNS = /^grid-cols-(?:\d+|\[minmax\(0,.*\])$/u;

function variantsOf(token: string, utility: string): string {
  return token.slice(0, token.lastIndexOf(utility)).replace(/!$/u, "");
}

function autoColumnClasses(tokens: readonly string[]): string | undefined {
  const utilities = tokens.map(utilityOf);
  const grid = (utility: string) => utility === "grid" || ITEMS_UTILITY.test(utility);
  if (!utilities.includes("grid") || !utilities.some((utility) => ITEMS_UTILITY.test(utility))) {
    return undefined;
  }
  const at = utilities.indexOf("grid");
  const scope = variantsOf(tokens[at] ?? "", "grid");
  const bounded = tokens.some(
    (token, index) =>
      BOUNDED_COLUMNS.test(utilities[index] ?? "") &&
      variantsOf(token, utilities[index] ?? "") === scope,
  );
  if (bounded) return undefined;
  return tokens.filter((_, index) => grid(utilities[index] ?? "")).join(" ");
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
  const grid = autoColumnClasses(tokens);
  if (grid !== undefined) violations.push({ rule: STYLE_RULE.GRID_COLUMNS, line, excerpt: grid });
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

const DISABLE_COMMENT = /\b(?:style-guard|stylelint)-(?:disable|ignore)\b/u;

export function styleSuppressionLines(text: string): readonly number[] {
  return scanCss(text)
    .comments.filter((comment) => DISABLE_COMMENT.test(comment.text))
    .map((comment) => comment.line);
}

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
      const grid = autoColumnGrid(block);
      if (grid !== undefined) {
        violations.push({
          rule: STYLE_RULE.GRID_COLUMNS,
          line: grid.line,
          excerpt: `${selectorOf(block)} { display: grid }`,
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
      !RULE_EXEMPT_FOLDERS[violation.rule]?.some((folder) => file.startsWith(folder)),
  );
}
