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

function cssRuleOf(declaration: CssDeclaration, block: CssBlock): StyleRule | undefined {
  const { property, value } = declaration;
  const bare = bareValue(value);
  if (isTokenBlock(block)) return undefined;
  if (property === "text-overflow" && /\bellipsis\b/u.test(bare)) return STYLE_RULE.ELLIPSIS;
  if (RADIUS_PROPERTY.test(property) && holdsLiteralNumber(value)) return STYLE_RULE.RADIUS;
  if (literalType(property, value)) return STYLE_RULE.TYPE;
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
function isClassList(text: string): boolean {
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
  for (const token of classes.split(/\s+/u)) {
    if (token.length === 0) continue;
    const rule = classRuleOf(token, names);
    if (rule !== undefined) violations.push({ rule, line, excerpt: token });
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
    for (const block of scanCss(text).blocks) {
      for (const declaration of block.declarations) {
        const rule = cssRuleOf(declaration, block);
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
  return violations.filter((violation) => !RULE_EXEMPT_FILES[violation.rule]?.includes(file));
}
