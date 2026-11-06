import type { CodeLines } from "@repo/features/tasks-view";
import { ACT_KIND, COLORED_CODE_MAX_CHARS, FENCE_LANGUAGE_MAX_CHARS } from "@repo/host/acts";
import { CODE_CARD_TITLE, CODE_ROW, CodeCard, type CodeRow } from "@repo/ui";
import { SUGGESTED_CHANGE_LANGUAGE } from "@repo/ui/github-html";
import type { MarkdownComponents, MarkdownNodeProps } from "@repo/ui/markdown";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { type ComponentProps, createContext, type ReactNode, useContext, useMemo } from "react";
import { askAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { QUERY_ROOT } from "../query-keys.js";
import { FileTypeIcon } from "./file-type-icon.js";

/**
 * transcript-markdown.tsx -- a transcript's code and tables: a fenced block drawn in the window's one code card, a table as a quiet grid, and an inline span on a subtle fill.
 *
 * Streamdown, the markdown renderer behind AI Elements' Response, draws a
 * fenced block and a table with components of its own: a bordered card on
 * the sidebar's fill with a second bordered box inside it, a language label,
 * and copy and download buttons, colored by `@streamdown/code` where that
 * plugin is installed and drawn plain where, as here, it is not; a table
 * boxed twice with copy, download, and fullscreen buttons over it. Those
 * are replaced here through Streamdown's own `components`, so nothing of
 * theirs is drawn and no stylesheet fights their classes. A fenced block
 * is colored by main, by the highlighter the Code and File tabs' lines
 * are colored with (`ACT_KIND.TASKS_COLOR_CODE`), so the colors and
 * the type are theirs; the window's content policy and its bundle size
 * keep that highlighter out of the window. Only a block that is whole is
 * asked for: one whose closing fence has not arrived is still streaming,
 * and is drawn plain until it does, so a long answer is colored once
 * rather than once a word. What main answered is held by language and
 * code, so a block drawn again, or twice, asks once. A block stands in
 * `@repo/ui`'s `CodeCard`, as every block of code in the window does, so
 * its header, its one Copy, its cut at 40 lines, and the screen recording's
 * leaving its lines out are the card's.
 */

/** What a block whose fence names no language is labeled. */
const PLAIN_LANGUAGE = "text";

/** The language a suggestion is written in, and what a suggestion's block's header calls it. */
const SUGGESTION = {
  LANGUAGE: "suggestion",
  LABEL: "Suggested change",
} as const;

/** A language's name as a reader says it, by the extension its files are written with. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  rb: "Ruby",
  rs: "Rust",
  go: "Go",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  css: "CSS",
  html: "HTML",
  sql: "SQL",
  md: "Markdown",
  diff: "Diff",
};

/** The extension a language named in full is written with, which its name and file icon are found by. */
const LANGUAGE_EXTENSION: Readonly<Record<string, string>> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  shell: "sh",
  ruby: "rb",
  markdown: "md",
};

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

/**
 * A block's coloring, asked of main the first time it is wanted and held for
 * the window's life while drawn, since a block's colors never change; one let
 * go of no longer drawn is forgotten after Query's garbage-collection time.
 * Note that a refusal draws the block plain and is held as one, so it is not
 * asked again.
 */
function coloringQueryOptions(language: string, code: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.CODE_COLORING, language, code],
    queryFn: (): Promise<CodeLines | null> =>
      askAct(ACT_KIND.TASKS_COLOR_CODE, { language, code }).catch(() => null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * The last line written inside a fenced block of a transcript's words still
 * waiting for its closing fence, or none where every fence closed, which a
 * block reads to tell whether it is the one still streaming. Note that it
 * is a line rather than the words, because Streamdown hands a component its
 * place in its own block alone, and because a value that stands still while
 * the words after the last block stream draws no block again.
 */
const OpenFenceTail = createContext<string | undefined>(undefined);

/** Whether main is asked to color a block at all: a named language, and code within the bound. */
function colorable(language: string, code: string): boolean {
  return (
    language !== "" &&
    language.length <= FENCE_LANGUAGE_MAX_CHARS &&
    code.trim() !== "" &&
    code.length <= COLORED_CODE_MAX_CHARS
  );
}

/** Whether `line` closes a fence opened with `marker`: the opening's character at least as long, alone but for the quote marks of a block inside a quote. */
function closesFence(line: string, marker: string): boolean {
  const bare = line.replace(QUOTE_MARKS, "").trim();
  return bare.length >= marker.length && [...bare].every((character) => character === marker[0]);
}

/**
 * The last line written inside a fenced block that still waits for its
 * closing fence at the end of `markdown`, empty for one with no line yet, or
 * none where every fence closed. Only the last block can still be open,
 * since a fence left open runs to the end of the words.
 */
function openFenceTail(markdown: string): string | undefined {
  let marker: string | undefined;
  let last: string | undefined;
  for (const line of markdown.trimEnd().split("\n")) {
    if (marker === undefined) {
      marker = FENCE_OPENING.exec(line.replace(QUOTE_MARKS, ""))?.[1];
      last = "";
    } else if (closesFence(line, marker)) {
      marker = undefined;
    } else {
      last = line;
    }
  }
  return marker === undefined ? undefined : last;
}

/** A fenced block's code: the text its element holds, as the markdown wrote it. */
function blockText(node: MarkdownNodeProps["node"]): string {
  return (node?.children ?? []).map((child) => (child.type === "text" ? child.value : "")).join("");
}

/**
 * A block's lines as main colored them, or none while they are asked for,
 * while the block streams, or for a block not colored at all.
 */
function useColoredLines(language: string, code: string, whole: boolean): CodeLines | undefined {
  const asking = whole && colorable(language, code);
  const coloring = useQuery({ ...coloringQueryOptions(language, code), enabled: asking });
  return asking ? (coloring.data ?? undefined) : undefined;
}

/**
 * A block's lines as rows tinted by what each does, or none for a block of
 * plain lines. A suggestion as written holds the new lines alone, every one
 * added; a suggested change GitHub rendered marks each line `-` or `+`
 * (`@repo/ui/github-html`), which the row stands for in its mark's place, as
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
 * A fenced block as a `CodeCard`: its language in the header, by the name
 * a reader says it by after its file icon ("TypeScript"), its id where it
 * is one this file has no name for, and "text" for a fence that names
 * none, over its lines, which keep whole and
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
  const openTail = useContext(OpenFenceTail);
  const language = LANGUAGE_CLASS.exec(className ?? "")?.[1] ?? "";
  const code = blockText(node).replace(/\n$/u, "");
  // Note that the block still open is the one the words end on, so its last line ends them.
  const whole = openTail === undefined || !openTail.endsWith(code.split("\n").at(-1) ?? "");
  const suggesting = language === SUGGESTION.LANGUAGE || language === SUGGESTED_CHANGE_LANGUAGE;
  // Note that a suggestion names no language of its own to color it in.
  const lines = useColoredLines(language, code, whole && !suggesting);
  const rows = rowsOf(language, code);
  const id = language.toLowerCase();
  const extension = LANGUAGE_EXTENSION[id] ?? id;
  const name = suggesting ? undefined : LANGUAGE_NAMES[extension];
  return (
    <CodeCard
      glyph={name === undefined ? undefined : <FileTypeIcon name={`code.${extension}`} />}
      title={suggesting ? SUGGESTION.LABEL : (name ?? (id === "" ? PLAIN_LANGUAGE : id))}
      titleIs={suggesting || name !== undefined ? CODE_CARD_TITLE.WORDS : CODE_CARD_TITLE.NAME}
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

/** The markdown a transcript's words are drawn from, read for the block still waiting for its closing fence and handed to the blocks inside them. */
export function TranscriptMarkdownSource({
  markdown,
  children,
}: {
  markdown: string;
  children: ReactNode;
}): ReactNode {
  const openTail = useMemo(() => openFenceTail(markdown), [markdown]);
  return <OpenFenceTail.Provider value={openTail}>{children}</OpenFenceTail.Provider>;
}
