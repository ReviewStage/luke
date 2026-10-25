import type { CodeLines, CodeToken } from "@luke/features/tasks-view";
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_LOOK, CARD_PADDING, Card } from "../card/card.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { OneLine } from "../one-line/one-line.js";
import { TextButton } from "../text-button/text-button.js";
import { wholeWordsHint } from "../tooltip/hint.js";

/**
 * code-card.tsx -- the window's one card for a block of code: a header naming its language or file with the one Copy, its lines in the host's colours, and a cut at 40 lines.
 *
 * Every block of code the window draws (a reply's fenced block, the code an
 * agent showed, an Inbox item's) stands in this card,
 * so each reads the same: a quiet header in the caption's type naming what
 * the lines are, the language they are written in or the file they came
 * from, with the one Copy at its end (`CopyButton`, "Copy code"), over the
 * lines on the code's own ground. The lines keep whole and scroll sideways
 * inside the card rather than widening the column they stand in.
 *
 * The card colours nothing itself. Its lines are coloured by the one
 * highlighter the window has, the host's, which the Code and File tabs and
 * a reply's blocks are coloured by (`CodeLines`), handed in once they land;
 * until then, or where nothing colours them, the lines are drawn plain in
 * the code's own ink. A run keeps its colour in each appearance as custom
 * properties its runs pick between (`light-dark()`, the theme's
 * `code-run`), so the code follows the appearance
 * without being drawn again.
 *
 * A block longer than 40 lines shows its first 40 over a line offering the
 * rest ("Show all"), which then offers to cut it again ("Show less"), so a
 * long block never buries what comes after it. The rest is still drawn,
 * under `hidden="until-found"`, so a find over the page reaches it, the
 * browser's own and the window's alike (`find-matches.ts`), and the card
 * opens whole when a match lands there (`beforematch`), as a closed
 * `<details>` opens. Copy copies the whole block
 * whichever way it stands. Its lines are left out of the screen recording
 * (`ph-no-capture`), a second line behind the recording's text masking,
 * since their colours draw the code's shape.
 *
 * It is drawn in the Tailwind theme's utilities: the header on the hover
 * fill over a hairline, its title holding to one line and fading where the
 * header cuts it (`OneLine`), its controls and the Copy flush with its right
 * edge; the lines in mono at the caption's size and the reading leading,
 * tabs two wide; a block drawn as rows, a suggestion's or a diff's, its
 * rows as wide as the widest and inset as the lines are, so a tint runs
 * edge to edge.
 */

/** How many lines a block shows before the rest waits behind Show all. */
const CODE_CARD_CUT_LINES = 40;

/** The `hidden` a cut block's rest wears: drawn, and found by a find over the page, but not shown until a match lands in it. */
const UNTIL_FOUND = "until-found";

/** The event a find fires at what `UNTIL_FOUND` hides before it shows a match there. */
const BEFORE_MATCH = "beforematch";

/** What the line under a cut block says, cut and whole. */
const CUT_LABEL = {
  CUT: "Show all",
  WHOLE: "Show less",
} as const;

/** What a block's Copy copies, as "Copy code". */
const COPY_WHAT = "code";

/** What a line of a block drawn as rows does, which tints it: a line added, one removed, or one standing as it was. */
export const CODE_ROW = {
  ADDED: "added",
  REMOVED: "removed",
  CONTEXT: "context",
} as const;

export type CodeRow = (typeof CODE_ROW)[keyof typeof CODE_ROW];

/** What a header's title is: a name, set in mono (a language or a file), or words, set as the window's own (a suggestion's "Suggested change"). */
export const CODE_CARD_TITLE = {
  NAME: "name",
  WORDS: "words",
} as const;

export type CodeCardTitle = (typeof CODE_CARD_TITLE)[keyof typeof CODE_CARD_TITLE];

/** Each row's tint, by what it does. */
const ROW_CLASS = {
  [CODE_ROW.ADDED]: "luke-code-card-row block px-list-inset bg-code-added",
  [CODE_ROW.REMOVED]: "luke-code-card-row block px-list-inset bg-code-removed",
  [CODE_ROW.CONTEXT]: "luke-code-card-row block px-list-inset",
} as const satisfies Record<CodeRow, string>;

/** Each title's face: a name in mono, words in the label's weight and the text's ink. */
const TITLE_CLASS = {
  [CODE_CARD_TITLE.NAME]: "luke-code-card-title flex min-w-0 items-center font-mono",
  [CODE_CARD_TITLE.WORDS]:
    "luke-code-card-title flex min-w-0 items-center font-label text-foreground",
} as const satisfies Record<CodeCardTitle, string>;

/** The lines, whole and scrolling sideways, each run in its colour for the appearance it stands in. */
const BODY =
  "luke-code-card-body m-0 overflow-x-auto overscroll-x-contain py-row-inset font-mono text-caption leading-reading wrap-normal whitespace-pre text-code [tab-size:2] [&_span]:text-code-run [&>code]:[font:inherit]";

/** The lines of a block drawn plain, inset as the card is; and of one drawn as rows, each row inset itself. */
const BODY_LINES = `${BODY} px-list-inset`;
const BODY_ROWS = `${BODY} px-0 [&>code]:block [&>code]:min-w-fit`;

/** A run's colour in each appearance, as the properties the sheet picks between; nothing for the code's own ink. */
function runColours({ color, lightColor }: CodeToken): React.CSSProperties | undefined {
  if (color === undefined && lightColor === undefined) return undefined;
  const colours: Record<string, string> = {};
  if (color !== undefined) colours["--luke-code-run-dark"] = color;
  if (lightColor !== undefined) colours["--luke-code-run-light"] = lightColor;
  return cssCustomProperties(colours);
}

/** One line's runs, each in its colour where the host coloured them. */
function lineRuns(tokens: CodeLines[number]): ReactNode {
  return tokens.map((token, at) => (
    <span key={at} style={runColours(token)}>
      {token.text}
    </span>
  ));
}

/**
 * A block's lines as rows, each tinted by what it does and as wide as the
 * widest. Note that an empty row holds a newline, so it stands a line tall.
 */
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
      // Note that a row's place is its identity: a block's rows never reorder.
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

/** The block's lines, each run in its colour where the host coloured them. */
function CodeRuns({
  text,
  lines,
}: {
  text: readonly string[];
  lines: CodeLines | undefined;
}): ReactNode {
  if (lines === undefined) return text.join("\n");
  return lines.map((tokens, line) => (
    // Note that a line's place is its identity: the lines of one block never reorder.
    <Fragment key={line}>
      {line > 0 ? "\n" : null}
      {lineRuns(tokens)}
    </Fragment>
  ));
}

/**
 * The rest of a cut block, hidden until found while `hiding`, and `onFound`
 * called when a find lands in it. Note that the attribute is set here rather
 * than as a prop, because React draws `hidden` as a flag and would set it
 * to no value, which hides the rest from every find.
 */
function useRestUntilFound(
  hiding: boolean,
  onFound: () => void,
): RefObject<HTMLSpanElement | null> {
  const rest = useRef<HTMLSpanElement | null>(null);
  const [found] = useState(() => ({ current: onFound }));
  found.current = onFound;
  useLayoutEffect(() => {
    const element = rest.current;
    if (element === null) return;
    if (!hiding) {
      element.removeAttribute("hidden");
      return;
    }
    element.setAttribute("hidden", UNTIL_FOUND);
    const open = () => found.current();
    element.addEventListener(BEFORE_MATCH, open);
    return () => element.removeEventListener(BEFORE_MATCH, open);
  }, [hiding, found]);
  return rest;
}

/** What a block's own words are, or what a caller draws in their place. */
type CodeCardLines =
  | {
      /** The block's words, drawn as its lines and cut at 40; Copy copies them whole unless `copied` says otherwise. */
      code: string;
      body?: never;
    }
  | {
      /** The block as the caller draws it, in place of lines of words: never cut, and copied only as `copied` says. */
      body: ReactNode;
      code?: never;
    };

/** A block of code in its card: `title` and the Copy over its lines, cut at 40 until the rest is asked for. */
export function CodeCard({
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
  /** What the lines are: the language they are written in, or the file they came from or a chip naming it. */
  title: ReactNode;
  /** Whether a text title is a name, in mono, or words. */
  titleIs?: CodeCardTitle;
  /** The block's lines as the host coloured them; none while they are asked for, or for lines drawn plain. */
  lines?: CodeLines | undefined;
  /** What each line does, to tint it; none for lines that stand as they are. */
  rows?: readonly CodeRow[] | undefined;
  /** What Copy copies where it is not the block's words; none with no words, which draws no Copy. */
  copied?: string | undefined;
  /** Controls of the header's own, before its Copy. */
  actions?: ReactNode;
  /** The card's accessible name, where its header's words do not make one. */
  label?: string | undefined;
  /** Data attributes the caller finds the card by, as the call a card shows is. */
  data?: Readonly<Record<`data-${string}`, string>> | undefined;
  /** The caller's platform act that puts words on the clipboard (`CopyButton`). */
  copy: (text: string) => Promise<void>;
}): React.JSX.Element {
  const bodyId = useId();
  const [whole, setWhole] = useState(false);
  // Note that the newline a block ends on closes its last line rather than opening one more, but a block drawn as rows names each row itself, so an empty last row is a row.
  const text = (rows === undefined ? (code ?? "").replace(/\n$/u, "") : (code ?? "")).split("\n");
  const cut = code !== undefined && text.length > CODE_CARD_CUT_LINES;
  const rest = useRestUntilFound(cut && !whole, () => setWhole(true));
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
      className="luke-code-card ph-no-capture m-0"
      aria-label={label}
      {...data}
    >
      <figcaption className="luke-code-card-header flex min-w-0 items-center justify-between gap-control-gap border-b border-border bg-muted pl-list-inset text-caption text-muted-foreground">
        <span className={TITLE_CLASS[titleIs]} data-title={titleIs}>
          {typeof title === "string" ? (
            <OneLine hint={wholeWordsHint(title)}>{title}</OneLine>
          ) : (
            title
          )}
        </span>
        <span className="luke-code-card-actions ml-auto flex flex-none">
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
                {/* Note that the newline closes the lead's last line, so the rest's first is never read run on to it. */}
                {rows === undefined ? "\n" : null}
                <span ref={rest} className="luke-code-card-rest block">
                  {drawLines(lead, text.length)}
                </span>
              </>
            ) : null}
          </code>
        </pre>
      )}
      {cut ? (
        <div className="luke-code-card-foot border-t border-border px-list-inset py-tight-gap text-caption text-muted-foreground">
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
