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

const PLAIN_LANGUAGE = "text";

const SUGGESTION = {
  LANGUAGE: "suggestion",
  LABEL: "Suggested change",
} as const;

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

const LANGUAGE_EXTENSION: Readonly<Record<string, string>> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  shell: "sh",
  ruby: "rb",
  markdown: "md",
};

const DIFF_LANGUAGE = "diff";

const DIFF_HEADER = /^(?:---|\+\+\+)(?:\s|$)/u;

interface Row {
  readonly kind: CodeRow;
  readonly text: string;
}

const LANGUAGE_CLASS = /(?:^|\s)language-(\S+)/u;

const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/u;

const QUOTE_MARKS = /^[\s>]*/u;

function coloringQueryOptions(language: string, code: string) {
  return queryOptions({
    queryKey: [QUERY_ROOT.CODE_COLORING, language, code],
    queryFn: (): Promise<CodeLines | null> =>
      askAct(ACT_KIND.TASKS_COLOR_CODE, { language, code }).catch(() => null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

const OpenFenceTail = createContext<string | undefined>(undefined);

function colorable(language: string, code: string): boolean {
  return (
    language !== "" &&
    language.length <= FENCE_LANGUAGE_MAX_CHARS &&
    code.trim() !== "" &&
    code.length <= COLORED_CODE_MAX_CHARS
  );
}

function closesFence(line: string, marker: string): boolean {
  const bare = line.replace(QUOTE_MARKS, "").trim();
  return bare.length >= marker.length && [...bare].every((character) => character === marker[0]);
}

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

function blockText(node: MarkdownNodeProps["node"]): string {
  return (node?.children ?? []).map((child) => (child.type === "text" ? child.value : "")).join("");
}

function useColoredLines(language: string, code: string, whole: boolean): CodeLines | undefined {
  const asking = whole && colorable(language, code);
  const coloring = useQuery({ ...coloringQueryOptions(language, code), enabled: asking });
  return asking ? (coloring.data ?? undefined) : undefined;
}

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

function addedText(rows: readonly Row[]): string {
  return rows
    .filter((row) => row.kind === CODE_ROW.ADDED)
    .map((row) => row.text)
    .join("\n");
}

function TranscriptCodeBlock({
  className,
  node,
}: ComponentProps<"code"> & MarkdownNodeProps): ReactNode {
  const openTail = useContext(OpenFenceTail);
  const language = LANGUAGE_CLASS.exec(className ?? "")?.[1] ?? "";
  const code = blockText(node).replace(/\n$/u, "");
  const whole = openTail === undefined || !openTail.endsWith(code.split("\n").at(-1) ?? "");
  const suggesting = language === SUGGESTION.LANGUAGE || language === SUGGESTED_CHANGE_LANGUAGE;
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
