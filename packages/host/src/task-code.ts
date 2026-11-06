import type { CodeToken } from "@repo/features/tasks-view";
import { catchAllButInterrupt } from "@repo/runtime/effect";
import { Clock, Duration, Effect } from "effect";
import type { HighlighterCore } from "shiki/core";
import { plainCodeLines } from "./task-code-remote.js";

const THEME = { DARK: "github-dark-default", LIGHT: "github-light-default" } as const;

const LOAD_RETRY_AFTER = Duration.minutes(1);

type SharedHighlighter = Effect.Effect<HighlighterCore | undefined>;

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

function runColor(color: string | undefined, foreground: string): string | undefined {
  const lower = color?.toLowerCase();
  return lower === foreground ? undefined : lower;
}

function compactLine(
  tokens: readonly { content: string; variants: Record<string, { color?: string | undefined }> }[],
  foreground: { readonly dark: string; readonly light: string },
): CodeToken[] {
  const line: CodeToken[] = [];
  for (const token of tokens) {
    const color = runColor(token.variants[THEME.DARK]?.color, foreground.dark);
    const lightColor = runColor(token.variants[THEME.LIGHT]?.color, foreground.light);
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

function coloredLines(
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

function languageOfFence(
  sharedHighlighter: SharedHighlighter,
  name: string,
): Effect.Effect<string | undefined> {
  const lower = name.toLowerCase();
  return Effect.map(sharedHighlighter, (core) =>
    core?.getLoadedLanguages().includes(lower) === true ? lower : undefined,
  );
}

export interface TaskCodeColoring {
  readonly highlightSnippet: (language: string, code: string) => Effect.Effect<CodeToken[][]>;
}

export function taskCodeColoring(load: Effect.Effect<HighlighterCore, unknown>): TaskCodeColoring {
  const sharedHighlighter = sharedHighlighterOf(load);
  return {
    highlightSnippet: (language, code) =>
      Effect.flatMap(languageOfFence(sharedHighlighter, language), (fenced) =>
        coloredLines(sharedHighlighter, fenced, code.split("\n")),
      ),
  };
}

export const { highlightSnippet } = taskCodeColoring(
  Effect.map(
    Effect.tryPromise(() => import("./task-code-highlighter.js")),
    (module) => module.createTaskCodeHighlighter(),
  ),
);
