import type { CodeLines, CodeToken } from "@luke/features/tasks-view";
import { Fragment, type ReactNode, useId, useState } from "react";
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
 * agent showed, an Inbox item's or a chat message's) stands in this card,
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
 * properties the sheet picks between, so the code follows the appearance
 * without being drawn again.
 *
 * A block longer than 40 lines shows its first 40 over a line offering the
 * rest ("Show all"), which then offers to cut it again ("Show less"), so a
 * long block never buries what comes after it. Copy copies the whole block
 * whichever way it stands. Its lines are left out of the screen recording
 * (`ph-no-capture`), a second line behind the recording's text masking,
 * since their colours draw the code's shape.
 */

/** How many lines a block shows before the rest waits behind Show all. */
const CODE_CARD_CUT_LINES = 40;

/** What the line under a cut block says, cut and whole. */
const CUT_LABEL = {
  CUT: "Show all",
  WHOLE: "Show less",
} as const;

/** What a block's Copy copies, as "Copy code". */
const COPY_WHAT = "code";

/** A run's colour in each appearance, as the properties the sheet picks between; nothing for the code's own ink. */
function runColours({ color, lightColor }: CodeToken): React.CSSProperties | undefined {
  if (color === undefined && lightColor === undefined) return undefined;
  const colours: Record<string, string> = {};
  if (color !== undefined) colours["--luke-code-run-dark"] = color;
  if (lightColor !== undefined) colours["--luke-code-run-light"] = lightColor;
  return cssCustomProperties(colours);
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
      {tokens.map((token, at) => (
        <span key={at} style={runColours(token)}>
          {token.text}
        </span>
      ))}
    </Fragment>
  ));
}

/** A block of code in its card: `title` and the Copy over its lines, cut at 40 until the rest is asked for. */
export function CodeCard({
  title,
  code,
  lines,
  copy,
}: {
  /** What the lines are: the language they are written in, or the file they came from or a chip naming it. */
  title: ReactNode;
  /** The block's words, which Copy copies whole. */
  code: string;
  /** The block's lines as the host coloured them; none while they are asked for, or for lines drawn plain. */
  lines?: CodeLines | undefined;
  /** The caller's platform act that puts words on the clipboard (`CopyButton`). */
  copy: (text: string) => Promise<void>;
}): React.JSX.Element {
  const body = useId();
  const [whole, setWhole] = useState(false);
  // Note that the newline a block ends on closes its last line rather than opening one more.
  const text = code.replace(/\n$/u, "").split("\n");
  const cut = text.length > CODE_CARD_CUT_LINES;
  const shown = cut && !whole ? CODE_CARD_CUT_LINES : text.length;
  return (
    <Card
      as={CARD_ELEMENT.FIGURE}
      look={CARD_LOOK.CODE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      className="luke-code-card ph-no-capture"
    >
      <figcaption className="luke-code-card-header">
        <span className="luke-code-card-title">
          {typeof title === "string" ? (
            <OneLine hint={wholeWordsHint(title)}>{title}</OneLine>
          ) : (
            title
          )}
        </span>
        <CopyButton text={code} what={COPY_WHAT} copy={copy} />
      </figcaption>
      <pre id={body} className="luke-code-card-body">
        <code>
          <CodeRuns text={text.slice(0, shown)} lines={lines?.slice(0, shown)} />
        </code>
      </pre>
      {cut ? (
        <div className="luke-code-card-foot">
          <TextButton
            aria-expanded={whole}
            aria-controls={body}
            onClick={() => setWhole((was) => !was)}
          >
            {whole ? CUT_LABEL.WHOLE : CUT_LABEL.CUT}
          </TextButton>
        </div>
      ) : null}
    </Card>
  );
}
