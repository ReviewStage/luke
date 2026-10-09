import { extname } from "node:path";
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
import type { ShownCode } from "@sidecar/hosted/plan-wire";
import type { CodeToken, PlanCode } from "@sidecar/hosted/planning-view";
import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * plan-code.ts -- the code on screen during a planning call, coloured: the lines the service read from the plan's repository, as the window draws them.
 *
 * Luke names code by place through the planning model's `show_code`, and the
 * service reads the lines from the planning session's checkout and sends
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
 * The window's lines coloured as the file's language, and drawn plain for a
 * file of no language the highlighter knows. Note that the colouring starts
 * at the window's first line, which is what the service sent: a window
 * opened inside a comment or a string is coloured from there.
 */
function colouredLines(path: string, lines: readonly string[]): CodeToken[][] {
  const language = LANGUAGE_BY_EXTENSION.get(extname(path).toLowerCase());
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

/** The code as the screen draws it: the lines the service sent, coloured, under the place and the repository they came from. */
export function highlightCode(code: ShownCode): PlanCode {
  return {
    ref: code.ref,
    repository: code.repository,
    firstLine: code.firstLine,
    lineCount: code.lineCount,
    lines: colouredLines(code.ref.path, code.lines),
  };
}
