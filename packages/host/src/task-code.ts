import type { ShownCode, TaskFileWindow } from "@luke/features/task-wire";
import type { CodeToken, TaskCode, TaskFileShown } from "@luke/features/tasks-view";
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
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * task-code.ts -- the code on screen during a task's call, coloured: the lines the service read from the task's repository, as the window draws them.
 *
 * Luke names code by place through the brain's `show_code`, and the
 * service reads the lines from the brain session's checkout and sends
 * them whole (`ShownCode`); nothing is read from this Mac's disk. What is
 * done here is the colouring, which runs in this process rather than in the
 * window, because the window's content policy refuses WebAssembly and its
 * bundle has a budget; Shiki's JavaScript regex engine runs here and the
 * window draws spans. Every run carries its colour in both of GitHub's
 * themes, so the window follows the appearance as it changes without asking
 * for the code again.
 */

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

/**
 * How much of a window the Code tab's card for it draws: the lines pointed
 * at with this many of the file on either side, or, for a file shown from
 * its top, its head. Note that the rest of the window is left here rather
 * than in the window, because colouring is what costs and the view
 * carrying every code shown on a task is told to the window whole.
 */
const CODE_EXCERPT_LINES = {
  CONTEXT: 3,
  HEAD: 24,
} as const;

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
 * Lines coloured as `language`, one of the highlighter's own, or drawn plain
 * for none. Note that the colouring starts at the first line given, which is
 * what the service sent: a window opened inside a comment or a string is
 * coloured from there.
 */
function colouredLines(language: string | undefined, lines: readonly string[]): CodeToken[][] {
  if (language === undefined) {
    return lines.map((text) => (text === "" ? [] : [{ text }]));
  }
  const core = sharedHighlighter();
  const foreground = {
    dark: core.getTheme(THEME.DARK).fg.toLowerCase(),
    light: core.getTheme(THEME.LIGHT).fg.toLowerCase(),
  };
  const tokens = core.codeToTokensWithThemes(lines.join("\n"), {
    lang: language,
    themes: { [THEME.DARK]: THEME.DARK, [THEME.LIGHT]: THEME.LIGHT },
  });
  return tokens.slice(0, lines.length).map((line) => compactLine(line, foreground));
}

/**
 * The language a file is coloured as, by its extension: what follows the last
 * dot of its name, where that dot does not open the name. Note that the name is
 * read after the last `/`, because a path the service sends is a repository's
 * POSIX path, and a dot in a directory is no extension.
 */
function languageOfPath(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? LANGUAGE_BY_EXTENSION.get(name.slice(dot).toLowerCase()) : undefined;
}

/**
 * The language a fenced block in a transcript is coloured as, by the name
 * its fence gives: a language's own name or one of the aliases its grammar
 * declares (`ts`, `py`, `sh`), and none for a name no grammar here answers to.
 */
function languageOfFence(name: string): string | undefined {
  const lower = name.toLowerCase();
  return sharedHighlighter().getLoadedLanguages().includes(lower) ? lower : undefined;
}

/**
 * The part of a window the Code tab's card draws: the lines pointed at and a
 * few either side, or the window's head for a whole file. Note that lines
 * pointed at past the window, as past a file's end, draw the window's head
 * too, because the service answered real lines for them and a card with
 * none would drop them.
 */
export function codeExcerpt(code: ShownCode): ShownCode {
  const { startLine, endLine } = code.ref;
  const head = { ...code, lines: code.lines.slice(0, CODE_EXCERPT_LINES.HEAD) };
  if (startLine === undefined || endLine === undefined) return head;
  const lastLine = code.firstLine + code.lines.length - 1;
  const from = Math.max(code.firstLine, startLine - CODE_EXCERPT_LINES.CONTEXT);
  const to = Math.min(lastLine, endLine + CODE_EXCERPT_LINES.CONTEXT);
  if (from > to) return head;
  return {
    ...code,
    firstLine: from,
    lines: code.lines.slice(from - code.firstLine, to - code.firstLine + 1),
  };
}

/** A window of a whole file as the File tab draws it: the lines the service read from GitHub, coloured as the file's language. */
export function highlightFile(window: TaskFileWindow): TaskFileShown {
  return { ...window, lines: colouredLines(languageOfPath(window.path), window.lines) };
}

/** The code as the screen draws it: the lines the service sent, coloured, under the place, the repository, and the commit they came from, with Luke's note where he wrote one. */
export function highlightCode(code: ShownCode): TaskCode {
  return {
    ref: code.ref,
    repository: code.repository,
    ...(code.commit === undefined ? undefined : { commit: code.commit }),
    firstLine: code.firstLine,
    lineCount: code.lineCount,
    lines: colouredLines(languageOfPath(code.ref.path), code.lines),
    ...(code.note === undefined ? undefined : { note: code.note }),
  };
}

/**
 * A fenced block of a transcript's markdown as the window draws it: its code,
 * line by line, coloured as the language its fence names, as the Code tab's
 * lines are, and plain for a language the highlighter does not know.
 */
export function highlightSnippet(language: string, code: string): CodeToken[][] {
  return colouredLines(languageOfFence(language), code.split("\n"));
}
