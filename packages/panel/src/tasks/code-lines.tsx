import type { CodeRef } from "@luke/features/task-wire";
import type { CodeLines, CodeToken } from "@luke/features/tasks-view";
import {
  cssCustomProperties,
  SCROLL_AXIS,
  SCROLL_FADE,
  ScrollArea,
  type ScrollFade,
} from "@luke/ui";
import { isPointed } from "@luke/voice/code-pane-model";
import { type CSSProperties, Fragment, memo, type ReactNode, type Ref } from "react";
import { type CodeType, FONT_STACK, LIGATURES, LINE_HEIGHT_RATIO } from "../code-type.js";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";

/**
 * code-lines.tsx -- numbered code lines filling their place and scrolling there: a text file opened over the window.
 *
 * Each line is numbered from where it sits in its file, its runs coloured
 * in both appearances, the lines pointed at lit, drawn filling the place and
 * scrolling in a `ScrollArea` of `@luke/ui` (`CodeLinesView`), never an
 * `overflow` of its own. Wrapped, they scroll up and down alone.
 * Unwrapped, they scroll on both axes together, every line as wide as the
 * longest or the place, whichever is wider, so the lit lines' ground runs
 * under the whole of what is read, while a note between them keeps to the
 * place's width in view; the gutter's numbers may be gone. Note that the
 * lines stand in a frame as wide as the place, which a note measures itself
 * by, because the lines themselves are as wide as the longest so a note can
 * stay stuck in view across the whole of them. Whether they wrap and number
 * is the caller's: a text file opened over the window always wraps and
 * numbers. A File tab's file and a page's source are drawn whole by
 * Pierre's diffs instead (`whole-file.tsx`), and a Code card's lines and
 * the lines Luke showed of a file a File tab cannot read as a snippet
 * (`code-snippet.tsx`).
 */

/**
 * A run's colour in each appearance, as the properties `tasks.css` picks
 * between, so the code follows the appearance without being drawn again;
 * nothing for a run in the theme's own foreground.
 */
export function runColours({ color, lightColor }: CodeToken): CSSProperties | undefined {
  if (color === undefined && lightColor === undefined) return undefined;
  const colours: Record<string, string> = {};
  if (color !== undefined) colours["--run-dark"] = color;
  if (lightColor !== undefined) colours["--run-light"] = lightColor;
  return cssCustomProperties(colours);
}

/**
 * What a blank line's text holds, here and in a diff. Note that it is a
 * newline rather than nothing, because the gutter's number is left out of a
 * selection, so a line holding no text would leave nothing to copy and the
 * copy would close up the blank lines between the code; drawn in `pre-wrap`,
 * a lone newline takes no more room than the line.
 */
const BLANK_LINE_TEXT = "\n";

/**
 * A line's number in the gutter, a File tab's, a card's, or either side of
 * a diff's: left out of a selection and of the find, so neither a copy nor
 * a search ever holds it; none draws the gutter empty.
 */
function CodeLineNumber({ line }: { line: number | undefined }): React.JSX.Element {
  return (
    <span className="code-line-number" {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
      {line}
    </span>
  );
}

/** Whether a line holds no text to copy. */
function isBlank(tokens: CodeLines[number]): boolean {
  return tokens.every((token) => token.text === "");
}

/**
 * One line, its number and its runs, drawn again only where its runs or its
 * lighting changed, so a window of lines coloured anew redraws that window
 * alone rather than every line held.
 */
const CodeLine = memo(function CodeLine({
  line,
  tokens,
  pointed,
}: {
  line: number;
  tokens: CodeLines[number];
  pointed: boolean;
}): React.JSX.Element {
  return (
    <div className="code-line" data-pointed={String(pointed)}>
      <CodeLineNumber line={line} />
      <code className="code-line-text">
        {isBlank(tokens) ? BLANK_LINE_TEXT : null}
        {tokens.map((token, at) => (
          <span key={at} style={runColours(token)}>
            {token.text}
          </span>
        ))}
      </code>
    </div>
  );
});

/** A run of a file's lines lit beside the ones pointed at, from its first line to its last. */
interface LitLines {
  readonly startLine: number;
  readonly endLine: number;
}

/** Lines of a file, numbered from where they sit in it, the lines `pointed` names lit and those `lit` names with them: a card's, and a File tab's, which draws its notes after the lines they end on. */
export function CodeLineRows({
  firstLine,
  lines,
  pointed,
  lit,
  after,
}: {
  firstLine: number;
  lines: CodeLines;
  pointed: CodeRef;
  /** Lines lit beside those pointed at, a note's while the pointer rests on it; none lights no more. */
  lit?: LitLines | undefined;
  /** What stands after a line, by its number; nothing where absent. */
  after?: ((line: number) => ReactNode) | undefined;
}): React.JSX.Element {
  return (
    <>
      {lines.map((tokens, index) => {
        const line = firstLine + index;
        const shone = lit !== undefined && line >= lit.startLine && line <= lit.endLine;
        return (
          // Note that a line's place in the file is its identity: the lines never reorder.
          <Fragment key={line}>
            <CodeLine line={line} tokens={tokens} pointed={shone || isPointed(pointed, line)} />
            {after?.(line)}
          </Fragment>
        );
      })}
    </>
  );
}

/** How a run of lines is drawn: its numbers shown or not, wrapped or not, and the type it is set in. */
export interface LinesLook {
  readonly lineNumbers: boolean;
  readonly wrap: boolean;
  /** The type the lines are set in, as View settings sets it; the window's code type where none is named. */
  readonly type?: CodeType | undefined;
}

/** A run's type as its box's custom properties, which the stylesheet sets its lines in (`.code-lines`); none for the window's own. */
function typeStyle(type: CodeType | undefined): CSSProperties | undefined {
  if (type === undefined) return undefined;
  return cssCustomProperties({
    "--code-font": FONT_STACK[type.font],
    "--code-font-size": `${type.fontSize}px`,
    "--code-line-height": LINE_HEIGHT_RATIO[type.lineHeight],
    "--code-font-features": type.ligatures ? LIGATURES.ON : LIGATURES.OFF,
  });
}

/** Lines numbered from `firstLine`, those `pointed` names lit, scrolling in the place they fill as `look` says. */
export function CodeLinesView({
  look,
  firstLine,
  lines,
  pointed,
  lit,
  after,
  fade = SCROLL_FADE.NONE,
  scrollerRef,
}: {
  look: LinesLook;
  firstLine: number;
  lines: CodeLines;
  pointed: CodeRef;
  /** Lines lit beside those pointed at; none lights no more. */
  lit?: LitLines | undefined;
  /** What stands after a line, by its number; nothing where absent. */
  after?: ((line: number) => ReactNode) | undefined;
  /** Which edges dissolve where the lines run past them; none where none is named. */
  fade?: ScrollFade | undefined;
  /** Handed the box that scrolls, which a caller centres a line within. */
  scrollerRef?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  return (
    <ScrollArea
      ref={scrollerRef}
      axis={look.wrap ? SCROLL_AXIS.VERTICAL : SCROLL_AXIS.BOTH}
      fade={fade}
    >
      <div className="code-lines-frame">
        <div
          className="code-lines"
          style={typeStyle(look.type)}
          data-line-numbers={String(look.lineNumbers)}
          data-wrap={String(look.wrap)}
        >
          <CodeLineRows
            firstLine={firstLine}
            lines={lines}
            pointed={pointed}
            lit={lit}
            after={after}
          />
        </div>
      </div>
    </ScrollArea>
  );
}
