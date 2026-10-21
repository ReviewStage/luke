import type { CodeToken } from "@luke/features/tasks-view";
import { catchAllButInterrupt } from "@luke/runtime/effect";
import { Clock, Duration, Effect } from "effect";
import type { HighlighterCore } from "shiki/core";
import { plainCodeLines } from "./task-code-remote.js";

/**
 * task-code.ts -- a transcript's fenced block coloured, in both of GitHub's themes, for the window to draw as spans.
 *
 * A fenced block is coloured outside the window, because the window's
 * content policy refuses WebAssembly and its bundle has a budget; Shiki's
 * JavaScript regex engine runs here and the window draws spans. The desktop
 * runs this in a process of its own (`task-code-remote.ts`), so it never
 * holds main's event loop, and the web in the tab's host. Every run carries
 * its colour in both of GitHub's themes, so the window follows the
 * appearance as it changes without asking for the code again.
 */

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
  const plain = () => plainCodeLines(lines.join("\n"));
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

/** The colouring the window asks for, over one shared highlighter. */
export interface TaskCodeColouring {
  /**
   * A fenced block of a transcript's markdown as the window draws it: its code,
   * line by line, coloured as the language its fence names, and plain for a
   * language the highlighter does not know.
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
    highlightSnippet: (language, code) =>
      Effect.flatMap(languageOfFence(sharedHighlighter, language), (fenced) =>
        colouredLines(sharedHighlighter, fenced, code.split("\n")),
      ),
  };
}

/** This process's colouring, over Shiki loaded through one dynamic `import()` the first time code is coloured. */
export const { highlightSnippet } = taskCodeColouring(
  Effect.map(
    Effect.tryPromise(() => import("./task-code-highlighter.js")),
    (module) => module.createTaskCodeHighlighter(),
  ),
);
