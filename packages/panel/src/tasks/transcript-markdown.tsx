import type { CodeLines } from "@luke/features/tasks-view";
import { ACT_KIND, COLOURED_CODE_MAX_CHARS, FENCE_LANGUAGE_MAX_CHARS } from "@luke/host/acts";
import { CODE_CARD_TITLE, CODE_ROW, CodeCard, type CodeRow } from "@luke/ui";
import { SUGGESTED_CHANGE_LANGUAGE } from "@luke/ui/github-html";
import type { MarkdownComponents, MarkdownNodeProps } from "@luke/ui/markdown";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { type ActHandle, useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";

/**
 * transcript-markdown.tsx -- a transcript's code and tables: a fenced block drawn as the Code tab draws code, a table as a quiet grid, and an inline span on a subtle fill.
 *
 * Streamdown, the markdown renderer behind AI Elements' Response, draws a
 * fenced block and a table with components of its own: a bordered card on
 * the sidebar's fill with a second bordered box inside it, a language label,
 * and copy and download buttons, coloured by `@streamdown/code` where that
 * plugin is installed and drawn plain where, as here, it is not; a table
 * boxed twice with copy, download, and fullscreen buttons over it. Those
 * are replaced here through Streamdown's own `components`, so nothing of
 * theirs is drawn and no stylesheet fights their classes. A fenced block
 * is coloured by main, by the highlighter the Code and File tabs' lines
 * are coloured with (`ACT_KIND.TASKS_COLOUR_CODE`), so the colours and
 * the type are theirs; the window's content policy and its bundle size
 * keep that highlighter out of the window. Only a block that is whole is
 * asked for: one whose closing fence has not arrived is still streaming,
 * and is drawn plain until it does, so a long answer is coloured once
 * rather than once a word. What main answered is held by language and
 * code, so a block drawn again, or twice, asks once. A block stands in
 * `@luke/ui`'s `CodeCard`, as every block of code in the window does, so
 * its header, its one Copy, its cut at 40 lines, and the screen recording's
 * leaving its lines out are the card's.
 */

/** What a block whose fence names no language is labelled. */
const PLAIN_LANGUAGE = "text";

/** The language a suggestion is written in, and what a suggestion's block's header calls it. */
const SUGGESTION = {
  LANGUAGE: "suggestion",
  LABEL: "Suggested change",
} as const;

/** The language a diff is fenced in, whose rows are tinted by what they do. */
const DIFF_LANGUAGE = "diff";

/** A diff's file header, `--- a/path` or `+++ b/path`: three marks, then a space or nothing. */
const DIFF_HEADER = /^(?:---|\+\+\+)(?:\s|$)/u;

/** A row of a block drawn as rows: what it does, and the words it shows. */
interface Row {
  readonly kind: CodeRow;
  readonly text: string;
}

/** The language a fenced block's class names, as Streamdown hands it on. */
const LANGUAGE_CLASS = /(?:^|\s)language-(\S+)/u;

/** A fence's opening: up to three spaces, then three or more backticks or tildes. */
const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/u;

/** The quote marks a line inside a quote opens on. */
const QUOTE_MARKS = /^[\s>]*/u;

/** How many coloured blocks the window holds before forgetting the oldest. */
const COLOURINGS_HELD = 200;

/** One block's colouring: main's lines once they land, and the ask that brings them. */
interface Colouring {
  lines: CodeLines | undefined;
  readonly asked: Promise<CodeLines | undefined>;
}

/** The colourings asked for, by language and then by code, oldest first. */
const colourings = new Map<string, Map<string, Colouring>>();
let colouringCount = 0;

/**
 * The markdown a transcript's words were drawn from, which a block reads to
 * tell whether its closing fence has arrived; Streamdown hands a component
 * the block's place in it but not the words.
 */
const MarkdownSource = createContext("");

/** Forgets the oldest colouring, so a long session's window holds a bounded number. */
function forgetOldest(): void {
  const [language, blocks] = colourings.entries().next().value ?? [];
  const oldest = blocks?.keys().next().value;
  if (language === undefined || blocks === undefined || oldest === undefined) return;
  blocks.delete(oldest);
  if (blocks.size === 0) colourings.delete(language);
  colouringCount -= 1;
}

/** A block's colouring, asked of main the first time it is wanted and held after. */
function colouringOf(act: ActHandle["act"], language: string, code: string): Colouring {
  const held = colourings.get(language)?.get(code);
  if (held !== undefined) return held;
  if (colouringCount >= COLOURINGS_HELD) forgetOldest();
  const colouring: Colouring = {
    lines: undefined,
    // Note that a refusal draws the block plain and is held as one, so it is not asked again.
    asked: act(ACT_KIND.TASKS_COLOUR_CODE, { language, code }).then(
      (lines) => {
        colouring.lines = lines;
        return lines;
      },
      () => undefined,
    ),
  };
  const blocks = colourings.get(language) ?? new Map<string, Colouring>();
  blocks.set(code, colouring);
  colourings.set(language, blocks);
  colouringCount += 1;
  return colouring;
}

/** Whether main is asked to colour a block at all: a named language, and code within the bound. */
function colourable(language: string, code: string): boolean {
  return (
    language !== "" &&
    language.length <= FENCE_LANGUAGE_MAX_CHARS &&
    code.trim() !== "" &&
    code.length <= COLOURED_CODE_MAX_CHARS
  );
}

/**
 * Whether a fenced block's markdown still waits for its closing fence: a
 * fence of the opening's character at least as long, alone on the last
 * line but for the quote marks of a block inside a quote. An indented
 * block has no fence to wait for.
 */
function fenceStillOpen(markdown: string): boolean {
  const marker = FENCE_OPENING.exec(markdown)?.[1];
  if (marker === undefined) return false;
  const lines = markdown.trimEnd().split("\n");
  const last = lines.length > 1 ? lines.at(-1)?.replace(QUOTE_MARKS, "").trim() : undefined;
  if (last === undefined || last.length < marker.length) return true;
  return [...last].some((character) => character !== marker[0]);
}

/** A fenced block's code: the text its element holds, as the markdown wrote it. */
function blockText(node: MarkdownNodeProps["node"]): string {
  return (node?.children ?? []).map((child) => (child.type === "text" ? child.value : "")).join("");
}

/**
 * A block's lines as main coloured them, or none while they are asked for,
 * while the block streams, or for a block not coloured at all.
 */
function useColouredLines(language: string, code: string, whole: boolean): CodeLines | undefined {
  const { act } = useAct();
  const asking = whole && colourable(language, code);
  const [answered, setAnswered] = useState<{ language: string; code: string; lines: CodeLines }>();
  useEffect(() => {
    if (!asking) return undefined;
    let shown = true;
    void colouringOf(act, language, code).asked.then((lines) => {
      if (shown && lines !== undefined) setAnswered({ language, code, lines });
    });
    return () => {
      shown = false;
    };
  }, [act, asking, language, code]);
  if (!asking) return undefined;
  const held = colourings.get(language)?.get(code)?.lines;
  if (held !== undefined) return held;
  return answered?.language === language && answered.code === code ? answered.lines : undefined;
}

/**
 * A block's lines as rows tinted by what each does, or none for a block of
 * plain lines. A suggestion as written holds the new lines alone, every one
 * added; a suggested change GitHub rendered marks each line `-` or `+`
 * (`@luke/ui/github-html`), which the row stands for in its mark's place, as
 * GitHub draws one; a diff's lines keep their marks, and its other lines
 * stand untinted.
 */
function rowsOf(language: string, code: string): readonly Row[] | undefined {
  const lines = code.split("\n");
  if (language === SUGGESTION.LANGUAGE) {
    return lines.map((text) => ({ kind: CODE_ROW.ADDED, text }));
  }
  if (language === SUGGESTED_CHANGE_LANGUAGE) {
    return lines.map((line) => ({
      kind: line.startsWith("-") ? CODE_ROW.REMOVED : CODE_ROW.ADDED,
      text: line.slice(1),
    }));
  }
  if (language !== DIFF_LANGUAGE) return undefined;
  return lines.map((text) => ({
    kind: DIFF_HEADER.test(text)
      ? CODE_ROW.CONTEXT
      : text.startsWith("-")
        ? CODE_ROW.REMOVED
        : text.startsWith("+")
          ? CODE_ROW.ADDED
          : CODE_ROW.CONTEXT,
    text,
  }));
}

/** The words of the rows added, which is what a suggestion copies. */
function addedText(rows: readonly Row[]): string {
  return rows
    .filter((row) => row.kind === CODE_ROW.ADDED)
    .map((row) => row.text)
    .join("\n");
}

/**
 * A fenced block as a `CodeCard`: its language in the header, which is
 * "text" for a fence that names none, over its lines, which keep whole and
 * scroll sideways inside the card rather than widening the transcript. A
 * ```suggestion block, a change suggested to the lines a review comment is
 * on, is headed as GitHub heads one, its lines drawn as rows on the added
 * lines' tint, and a suggested change GitHub rendered its removed lines over
 * its added ones on the removed lines' tint; its copy is the new lines
 * alone, which is the suggestion. A diff's rows are tinted the same way
 * (`rowsOf`).
 */
function TranscriptCodeBlock({
  className,
  node,
}: ComponentProps<"code"> & MarkdownNodeProps): ReactNode {
  const markdown = useContext(MarkdownSource);
  const language = LANGUAGE_CLASS.exec(className ?? "")?.[1] ?? "";
  const code = blockText(node).replace(/\n$/u, "");
  const start = node?.position?.start.offset;
  const end = node?.position?.end.offset;
  const whole =
    start === undefined || end === undefined || !fenceStillOpen(markdown.slice(start, end));
  const suggesting = language === SUGGESTION.LANGUAGE || language === SUGGESTED_CHANGE_LANGUAGE;
  // Note that a suggestion names no language of its own to colour it in.
  const lines = useColouredLines(language, code, whole && !suggesting);
  const rows = rowsOf(language, code);
  return (
    <CodeCard
      title={
        suggesting ? SUGGESTION.LABEL : language === "" ? PLAIN_LANGUAGE : language.toLowerCase()
      }
      titleIs={suggesting ? CODE_CARD_TITLE.WORDS : CODE_CARD_TITLE.NAME}
      code={rows === undefined ? code : rows.map((row) => row.text).join("\n")}
      lines={lines}
      rows={rows?.map((row) => row.kind)}
      copied={suggesting ? addedText(rows ?? []) : code}
      copy={copyThroughShell}
    />
  );
}

/**
 * How a transcript's markdown draws code and tables. A table scrolls
 * sideways inside its own box where it is wider than the column, and a
 * cell keeps the alignment its column's rule gave it, which Streamdown
 * hands on as the cell's style.
 */
export const TRANSCRIPT_CODE_AND_TABLE_COMPONENTS: MarkdownComponents = {
  code: TranscriptCodeBlock,
  inlineCode: ({ children }) => <code className="transcript-inline-code">{children}</code>,
  table: ({ children }) => (
    <div className="transcript-table">
      <table>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children, style }) => <th style={style}>{children}</th>,
  td: ({ children, style }) => <td style={style}>{children}</td>,
};

/** The markdown a transcript's words are drawn from, handed to the blocks inside them. */
export function TranscriptMarkdownSource({
  markdown,
  children,
}: {
  markdown: string;
  children: ReactNode;
}): ReactNode {
  return <MarkdownSource.Provider value={markdown}>{children}</MarkdownSource.Provider>;
}
