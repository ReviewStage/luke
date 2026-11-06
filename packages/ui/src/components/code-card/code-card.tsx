import type { CodeLines, CodeToken } from "@repo/features/tasks-view";
import { Fragment, type ReactNode, useId, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { useUntilFound } from "../../use-until-found.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { OneLine } from "../one-line/one-line.js";
import { TextButton } from "../text-button/text-button.js";
import { wholeWordsHint } from "../tooltip/hint.js";

const CODE_CARD_CUT_LINES = 40;

const CUT_LABEL = {
  CUT: "Show all",
  WHOLE: "Show less",
} as const;

const COPY_WHAT = "code";

export const CODE_ROW = {
  ADDED: "added",
  REMOVED: "removed",
  CONTEXT: "context",
} as const;

export type CodeRow = (typeof CODE_ROW)[keyof typeof CODE_ROW];

export const CODE_CARD_TITLE = {
  NAME: "name",
  WORDS: "words",
} as const;

export type CodeCardTitle = (typeof CODE_CARD_TITLE)[keyof typeof CODE_CARD_TITLE];

const ROW_CLASS = {
  [CODE_ROW.ADDED]: "ui-code-card-row block px-list-inset bg-code-added",
  [CODE_ROW.REMOVED]: "ui-code-card-row block px-list-inset bg-code-removed",
  [CODE_ROW.CONTEXT]: "ui-code-card-row block px-list-inset",
} as const satisfies Record<CodeRow, string>;

const TITLE_CLASS = {
  [CODE_CARD_TITLE.NAME]: "ui-code-card-title flex min-w-0 items-center font-mono",
  [CODE_CARD_TITLE.WORDS]:
    "ui-code-card-title flex min-w-0 items-center font-label text-foreground",
} as const satisfies Record<CodeCardTitle, string>;

const GLYPH = "ui-code-card-glyph mr-icon-gap inline-flex flex-none [&>svg]:size-icon-16";

const BODY =
  "ui-code-card-body m-0 overflow-x-auto overscroll-x-contain py-row-inset font-mono text-caption leading-reading wrap-normal whitespace-pre text-code [tab-size:2] [&_span]:text-code-run [&>code]:[font:inherit]";

const BODY_LINES = `${BODY} px-list-inset`;
const BODY_ROWS = `${BODY} px-0 [&>code]:block [&>code]:min-w-fit`;

function runColors({ color, lightColor }: CodeToken): React.CSSProperties | undefined {
  if (color === undefined && lightColor === undefined) return undefined;
  const colors: Record<string, string> = {};
  if (color !== undefined) colors["--ui-code-run-dark"] = color;
  if (lightColor !== undefined) colors["--ui-code-run-light"] = lightColor;
  return cssCustomProperties(colors);
}

function lineRuns(tokens: CodeLines[number]): ReactNode {
  return tokens.map((token, at) => (
    <span key={at} style={runColors(token)}>
      {token.text}
    </span>
  ));
}

function CodeRows({
  text,
  lines,
  rows,
}: {
  text: readonly string[];
  lines: CodeLines | undefined;
  rows: readonly CodeRow[];
}): ReactNode {
  return text.map((words, at) => {
    const tokens = lines?.[at];
    return (
      <span
        key={at}
        className={ROW_CLASS[rows[at] ?? CODE_ROW.CONTEXT]}
        data-row={rows[at] ?? CODE_ROW.CONTEXT}
      >
        {words === "" ? "\n" : tokens === undefined ? words : lineRuns(tokens)}
      </span>
    );
  });
}

function CodeRuns({
  text,
  lines,
}: {
  text: readonly string[];
  lines: CodeLines | undefined;
}): ReactNode {
  if (lines === undefined) return text.join("\n");
  return lines.map((tokens, line) => (
    <Fragment key={line}>
      {line > 0 ? "\n" : null}
      {lineRuns(tokens)}
    </Fragment>
  ));
}

type CodeCardLines =
  | {
      code: string;
      body?: never;
    }
  | {
      body: ReactNode;
      code?: never;
    };

export function CodeCard({
  glyph,
  title,
  titleIs = CODE_CARD_TITLE.NAME,
  code,
  body,
  lines,
  rows,
  copied = code,
  actions,
  label,
  data,
  copy,
}: CodeCardLines & {
  glyph?: ReactNode;
  title: ReactNode;
  titleIs?: CodeCardTitle;
  lines?: CodeLines | undefined;
  rows?: readonly CodeRow[] | undefined;
  copied?: string | undefined;
  actions?: ReactNode;
  label?: string | undefined;
  data?: Readonly<Record<`data-${string}`, string>> | undefined;
  copy: (text: string) => Promise<void>;
}): React.JSX.Element {
  const bodyId = useId();
  const [whole, setWhole] = useState(false);
  const text = (rows === undefined ? (code ?? "").replace(/\n$/u, "") : (code ?? "")).split("\n");
  const cut = code !== undefined && text.length > CODE_CARD_CUT_LINES;
  const rest = useUntilFound<HTMLSpanElement>(cut && !whole, () => setWhole(true));
  const lead = cut ? CODE_CARD_CUT_LINES : text.length;
  const drawLines = (from: number, to: number): ReactNode =>
    rows === undefined ? (
      <CodeRuns text={text.slice(from, to)} lines={lines?.slice(from, to)} />
    ) : (
      <CodeRows
        text={text.slice(from, to)}
        lines={lines?.slice(from, to)}
        rows={rows.slice(from)}
      />
    );
  return (
    <Card
      as={CARD_ELEMENT.FIGURE}
      look={CARD_LOOK.CODE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="ui-code-card ph-no-capture m-0"
      aria-label={label}
      {...data}
    >
      <figcaption className="ui-code-card-header flex min-w-0 items-center justify-between gap-control-gap border-b border-border bg-muted pl-list-inset text-caption text-muted-foreground">
        <span className={TITLE_CLASS[titleIs]} data-title={titleIs}>
          {glyph === undefined ? null : <span className={GLYPH}>{glyph}</span>}
          {typeof title === "string" ? (
            <OneLine hint={wholeWordsHint(title)}>{title}</OneLine>
          ) : (
            title
          )}
        </span>
        <span className="ui-code-card-actions ml-auto flex flex-none">
          {actions}
          {copied === undefined ? null : <CopyButton text={copied} what={COPY_WHAT} copy={copy} />}
        </span>
      </figcaption>
      {code === undefined ? (
        body
      ) : (
        <pre
          id={bodyId}
          className={rows === undefined ? BODY_LINES : BODY_ROWS}
          data-rows={rows === undefined ? undefined : true}
        >
          <code>
            {drawLines(0, lead)}
            {cut ? (
              <>
                {rows === undefined ? "\n" : null}
                <span ref={rest} className="ui-code-card-rest block">
                  {drawLines(lead, text.length)}
                </span>
              </>
            ) : null}
          </code>
        </pre>
      )}
      {cut ? (
        <div className="ui-code-card-foot border-t border-border px-list-inset py-tight-gap text-caption text-muted-foreground">
          <TextButton
            aria-expanded={whole}
            aria-controls={bodyId}
            onClick={() => setWhole((was) => !was)}
          >
            {whole ? CUT_LABEL.WHOLE : CUT_LABEL.CUT}
          </TextButton>
        </div>
      ) : null}
    </Card>
  );
}
