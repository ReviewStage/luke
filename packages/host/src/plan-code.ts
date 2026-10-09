import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import langBash from "@shikijs/langs/bash";
import langC from "@shikijs/langs/c";
import langCpp from "@shikijs/langs/cpp";
import langCss from "@shikijs/langs/css";
import langGo from "@shikijs/langs/go";
import langHtml from "@shikijs/langs/html";
import langJava from "@shikijs/langs/java";
import langJavascript from "@shikijs/langs/javascript";
import langJson from "@shikijs/langs/json";
import langJsx from "@shikijs/langs/jsx";
import langKotlin from "@shikijs/langs/kotlin";
import langMarkdown from "@shikijs/langs/markdown";
import langPython from "@shikijs/langs/python";
import langRuby from "@shikijs/langs/ruby";
import langRust from "@shikijs/langs/rust";
import langSql from "@shikijs/langs/sql";
import langSwift from "@shikijs/langs/swift";
import langToml from "@shikijs/langs/toml";
import langTsx from "@shikijs/langs/tsx";
import langTypescript from "@shikijs/langs/typescript";
import langYaml from "@shikijs/langs/yaml";
import githubDarkDefault from "@shikijs/themes/github-dark-default";
import githubLightDefault from "@shikijs/themes/github-light-default";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import {
  CODE_UNREADABLE,
  type CodeToken,
  type CodeUnreadable,
  type PlanCode,
} from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * plan-code.ts -- the code on screen during a planning call: a file of the plan's folder read on this Mac, cut to a window around the lines pointed at, and coloured.
 *
 * Luke names code by place (`CodeRef`) through the planning model's
 * `show_code`, and the lines are read here, from the folder this Mac alone
 * records for the plan, so the screen always shows the file as it stands on
 * disk.
 *
 * Note that the path comes from the service, so it is not trusted: it is resolved with every link followed and must land
 * inside the folder, and a `.env` file is never read, the same files the
 * planning model's sandbox refuses (`planning-commands.ts`).
 *
 * The colouring runs here rather than in the window, because the window's
 * content policy refuses WebAssembly and its bundle has a budget; Shiki's
 * JavaScript regex engine runs in this process and the window draws spans.
 * Every run carries its colour in both of GitHub's themes, so the window
 * follows the appearance as it changes without asking for the code again.
 */

export const PLAN_CODE = {
  /** The largest file read at all; a larger one is said to be too large. */
  MAX_FILE_BYTES: 1024 * 1024,
  /** The most lines the screen holds at once: the lines pointed at, with the file around them. */
  WINDOW_LINES: 400,
} as const;

/** A file kept secret, refused wherever it sits in the folder. */
const SECRET_FILE = /(^|\/)\.env[^/]*$/;

/** The language each file extension is coloured as; any other file is drawn plain. */
const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  [".ts", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".tsx", "tsx"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "jsx"],
  [".json", "json"],
  [".css", "css"],
  [".html", "html"],
  [".md", "markdown"],
  [".py", "python"],
  [".go", "go"],
  [".rs", "rust"],
  [".swift", "swift"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".rb", "ruby"],
  [".c", "c"],
  [".h", "c"],
  [".cc", "cpp"],
  [".cpp", "cpp"],
  [".hpp", "cpp"],
  [".sql", "sql"],
  [".sh", "bash"],
  [".bash", "bash"],
  [".zsh", "bash"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".toml", "toml"],
]);

/** The themes the code is coloured in, one per appearance. */
const THEME = { DARK: "github-dark-default", LIGHT: "github-light-default" } as const;

let highlighter: HighlighterCore | undefined;

/** The one highlighter, built the first time code is coloured, since most launches show none. */
function sharedHighlighter(): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({
    themes: [githubDarkDefault, githubLightDefault],
    langs: [
      langBash,
      langC,
      langCpp,
      langCss,
      langGo,
      langHtml,
      langJava,
      langJavascript,
      langJson,
      langJsx,
      langKotlin,
      langMarkdown,
      langPython,
      langRuby,
      langRust,
      langSql,
      langSwift,
      langToml,
      langTsx,
      langTypescript,
      langYaml,
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/** The first line of the window that holds the lines pointed at, centred where the file allows. */
function windowStart(ref: CodeRef, lineCount: number): number {
  if (ref.startLine === undefined || ref.endLine === undefined) return 1;
  const pointed = ref.endLine - ref.startLine + 1;
  const margin = Math.max(0, Math.floor((PLAN_CODE.WINDOW_LINES - pointed) / 2));
  const latest = Math.max(1, lineCount - PLAN_CODE.WINDOW_LINES + 1);
  return Math.min(Math.max(1, ref.startLine - margin), latest);
}

/** A run's colour in one theme, or nothing for that theme's own foreground. */
function runColour(color: string | undefined, foreground: string): string | undefined {
  const lower = color?.toLowerCase();
  return lower === foreground ? undefined : lower;
}

/** Runs of one colour in both themes merged, and each theme's own foreground left unnamed, so a line carries little. */
function compactLine(
  tokens: readonly { content: string; variants: Record<string, { color?: string | undefined }> }[],
  foreground: { readonly dark: string; readonly light: string },
): CodeToken[] {
  const line: CodeToken[] = [];
  for (const token of tokens) {
    const color = runColour(token.variants[THEME.DARK]?.color, foreground.dark);
    const lightColor = runColour(token.variants[THEME.LIGHT]?.color, foreground.light);
    const last = line.at(-1);
    const merged = last !== undefined && last.color === color && last.lightColor === lightColor;
    if (merged) line.pop();
    let run: CodeToken = { text: merged ? last.text + token.content : token.content };
    if (color !== undefined) run = { ...run, color };
    if (lightColor !== undefined) run = { ...run, lightColor };
    line.push(run);
  }
  return line;
}

/**
 * The lines from `first` to `last` coloured as the file's language. Note
 * that the file is coloured from its first line rather than the window's,
 * because a window opened inside a comment or a string would be coloured
 * wrong.
 */
function colouredLines(
  path: string,
  lines: readonly string[],
  first: number,
  last: number,
): CodeToken[][] {
  const language = LANGUAGE_BY_EXTENSION.get(extname(path).toLowerCase());
  if (language === undefined) {
    return lines.slice(first - 1, last).map((text) => (text === "" ? [] : [{ text }]));
  }
  const core = sharedHighlighter();
  const foreground = {
    dark: core.getTheme(THEME.DARK).fg.toLowerCase(),
    light: core.getTheme(THEME.LIGHT).fg.toLowerCase(),
  };
  const tokens = core.codeToTokensWithThemes(lines.slice(0, last).join("\n"), {
    lang: language,
    themes: { [THEME.DARK]: THEME.DARK, [THEME.LIGHT]: THEME.LIGHT },
  });
  return tokens.slice(first - 1, last).map((line) => compactLine(line, foreground));
}

/** Why a read refused, as the screen says it. */
class Unreadable {
  constructor(readonly reason: CodeUnreadable) {}
}

/** The real path of `path` inside `root`, refused when it leaves it or names a secret. */
async function resolveInside(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || SECRET_FILE.test(path)) throw new Unreadable(CODE_UNREADABLE.REFUSED);
  let target: string;
  try {
    target = await realpath(resolve(root, path));
  } catch {
    throw new Unreadable(CODE_UNREADABLE.MISSING);
  }
  const inside = relative(root, target);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside) || SECRET_FILE.test(inside)) {
    throw new Unreadable(CODE_UNREADABLE.REFUSED);
  }
  return target;
}

/** The file's text, refused when it is not a file, too large, or not text. */
async function readText(target: string): Promise<string> {
  const stats = await stat(target);
  if (!stats.isFile()) throw new Unreadable(CODE_UNREADABLE.MISSING);
  if (stats.size > PLAN_CODE.MAX_FILE_BYTES) throw new Unreadable(CODE_UNREADABLE.TOO_LARGE);
  const bytes = await readFile(target);
  if (bytes.includes(0)) throw new Unreadable(CODE_UNREADABLE.TOO_LARGE);
  return bytes.toString("utf8");
}

/** The screen's code for `ref`: its window of the file coloured, or why none was drawn. */
async function readCode(folder: string, ref: CodeRef): Promise<PlanCode> {
  try {
    const root = await realpath(folder);
    const text = await readText(await resolveInside(root, ref.path));
    const lines = text.split(/\r?\n/);
    const first = windowStart(ref, lines.length);
    const last = Math.min(lines.length, first + PLAN_CODE.WINDOW_LINES - 1);
    return {
      ref,
      firstLine: first,
      lineCount: lines.length,
      lines: colouredLines(ref.path, lines, first, last),
    };
  } catch (failure) {
    if (failure instanceof Unreadable) return { ref, unreadable: failure.reason };
    return { ref, unreadable: CODE_UNREADABLE.MISSING };
  }
}

/**
 * The code on screen for `ref`, read from the plan's folder on this Mac, or
 * why it drew none; never a failure, since a reference the screen cannot
 * draw is still what was named.
 */
export function planCode(folder: string | undefined, ref: CodeRef): Effect.Effect<PlanCode> {
  if (folder === undefined) return Effect.succeed({ ref, unreadable: CODE_UNREADABLE.NO_FOLDER });
  return Effect.promise(() => readCode(folder, ref));
}
