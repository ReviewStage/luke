import type { ShownCode, TaskFileWindow } from "@luke/features/task-wire";
import type { CodeToken, TaskCode, TaskFileShown } from "@luke/features/tasks-view";
import { catchAllButInterrupt } from "@luke/runtime/effect";
import { Clock, Duration, Effect } from "effect";
import type { HighlighterCore } from "shiki/core";

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

/**
 * How long a highlighter that could not be loaded is not asked for again:
 * code coloured in that time is drawn plain without trying the load again or
 * warning of it again, so a chunk that failed to download costs one try and
 * one warning a minute rather than one for every colouring.
 */
const LOAD_RETRY_AFTER = Duration.minutes(1);

/** The highlighter as a colouring asks for it: the one built, or none where it could not be loaded. */
type SharedHighlighter = Effect.Effect<HighlighterCore | undefined>;

/**
 * The one highlighter `load` builds, loaded the first time code is coloured,
 * since most launches show none, and kept for the life of the process; or
 * none where it could not be loaded or built, as where a browser's chunk
 * fails to download, so the code is drawn plain rather than not at all; a
 * caller's interruption still ends it. A failure is kept for
 * `LOAD_RETRY_AFTER` on the `Clock`, and the first colouring after that
 * tries again. Note that two colourings racing a load may each build one,
 * which is harmless: the module loads once, and the later build is the one
 * kept.
 */
function sharedHighlighterOf(load: Effect.Effect<HighlighterCore, unknown>): SharedHighlighter {
  let highlighter: HighlighterCore | undefined;
  let failedAt: number | undefined;
  return Effect.suspend(() => {
    if (highlighter !== undefined) return Effect.succeed(highlighter);
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      failedAt !== undefined && now - failedAt < Duration.toMillis(LOAD_RETRY_AFTER)
        ? Effect.succeed(undefined)
        : catchAllButInterrupt(
            Effect.tap(load, (built) =>
              Effect.sync(() => {
                highlighter = built;
                failedAt = undefined;
              }),
            ),
            (cause) =>
              Effect.as(
                Effect.andThen(
                  Effect.sync(() => {
                    failedAt = now;
                  }),
                  Effect.logWarning(
                    "Code is drawn plain: the highlighter could not be loaded",
                    cause,
                  ),
                ),
                undefined,
              ),
          ),
    );
  });
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
 * for none and where the highlighter could not be loaded. Note that the colouring starts at the first line given, which is
 * what the service sent: a window opened inside a comment or a string is
 * coloured from there.
 */
function colouredLines(
  sharedHighlighter: SharedHighlighter,
  language: string | undefined,
  lines: readonly string[],
): Effect.Effect<CodeToken[][]> {
  const plain = () => lines.map((text) => (text === "" ? [] : [{ text }]));
  if (language === undefined) return Effect.succeed(plain());
  return Effect.map(sharedHighlighter, (core) => {
    if (core === undefined) return plain();
    const foreground = {
      dark: core.getTheme(THEME.DARK).fg.toLowerCase(),
      light: core.getTheme(THEME.LIGHT).fg.toLowerCase(),
    };
    const tokens = core.codeToTokensWithThemes(lines.join("\n"), {
      lang: language,
      themes: { [THEME.DARK]: THEME.DARK, [THEME.LIGHT]: THEME.LIGHT },
    });
    return tokens.slice(0, lines.length).map((line) => compactLine(line, foreground));
  });
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
function languageOfFence(
  sharedHighlighter: SharedHighlighter,
  name: string,
): Effect.Effect<string | undefined> {
  const lower = name.toLowerCase();
  return Effect.map(sharedHighlighter, (core) =>
    core?.getLoadedLanguages().includes(lower) === true ? lower : undefined,
  );
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

/** The three colourings the window asks for, each over one shared highlighter. */
export interface TaskCodeColouring {
  /** A window of a whole file as the File tab draws it: the lines the service read from GitHub, coloured as the file's language. */
  readonly highlightFile: (window: TaskFileWindow) => Effect.Effect<TaskFileShown>;
  /** The code as the screen draws it: the lines the service sent, coloured, under the place, the repository, and the commit they came from, with Luke's note where he wrote one. */
  readonly highlightCode: (code: ShownCode) => Effect.Effect<TaskCode>;
  /**
   * A fenced block of a transcript's markdown as the window draws it: its code,
   * line by line, coloured as the language its fence names, as the Code tab's
   * lines are, and plain for a language the highlighter does not know.
   */
  readonly highlightSnippet: (language: string, code: string) => Effect.Effect<CodeToken[][]>;
}

/**
 * The colourings over the highlighter `load` builds: this process's own
 * below, over Shiki's chunk, and a test's over a load it scripts.
 */
export function taskCodeColouring(
  load: Effect.Effect<HighlighterCore, unknown>,
): TaskCodeColouring {
  const sharedHighlighter = sharedHighlighterOf(load);
  return {
    highlightFile: (window) =>
      Effect.map(
        colouredLines(sharedHighlighter, languageOfPath(window.path), window.lines),
        (lines) => ({ ...window, lines }),
      ),
    highlightCode: (code) =>
      Effect.map(
        colouredLines(sharedHighlighter, languageOfPath(code.ref.path), code.lines),
        (lines) => ({
          ref: code.ref,
          repository: code.repository,
          ...(code.commit === undefined ? undefined : { commit: code.commit }),
          firstLine: code.firstLine,
          lineCount: code.lineCount,
          lines,
          ...(code.note === undefined ? undefined : { note: code.note }),
        }),
      ),
    highlightSnippet: (language, code) =>
      Effect.flatMap(languageOfFence(sharedHighlighter, language), (fenced) =>
        colouredLines(sharedHighlighter, fenced, code.split("\n")),
      ),
  };
}

/** This process's colourings, over Shiki loaded through one dynamic `import()` the first time code is coloured. */
export const { highlightFile, highlightCode, highlightSnippet } = taskCodeColouring(
  Effect.map(
    Effect.tryPromise(() => import("./task-code-highlighter.js")),
    (module) => module.createTaskCodeHighlighter(),
  ),
);
