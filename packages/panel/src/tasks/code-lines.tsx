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
import { type CSSProperties, Fragment, type ReactNode, type Ref } from "react";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { useFileViewSettings } from "./file-view-settings.js";

/**
 * code-lines.tsx -- numbered code lines: a Code card's, and filling their place and scrolling there, a File tab's file, a page's source, a text file opened over the window.
 *
 * Each line is numbered from where it sits in its file, its runs coloured
 * in both appearances, the lines pointed at lit; a Code card draws its rows
 * alone (`CodeLineRows`), and every other place draws them filling it and
 * scrolling in a `ScrollArea` of `@luke/ui` (`CodeLinesView`), never an
 * `overflow` of its own. Wrapped, they scroll up and down alone.
 * Unwrapped, they scroll on both axes together, each line as wide as itself
 * or the place, whichever is wider, so the lit lines' ground runs under the
 * whole of what is read; the gutter's numbers may be gone. Whether they wrap and number is the caller's: a File tab's and a
 * page's source follow the File tabs' settings (`useLinesLook`), a text
 * file opened over the window always wraps and numbers. What stands above
 * and below the lines, a File tab's rows reading more of its file, stands
 * in the scroll with them.
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

/** Lines of a file, numbered from where they sit in it, the lines `pointed` names lit: a card's, and a File tab's, which draws its notes before the lines they begin on. */
export function CodeLineRows({
  firstLine,
  lines,
  pointed,
  before,
}: {
  firstLine: number;
  lines: CodeLines;
  pointed: CodeRef;
  /** What stands before a line, by its number; nothing where absent. */
  before?: ((line: number) => ReactNode) | undefined;
}): React.JSX.Element {
  return (
    <>
      {lines.map((tokens, index) => {
        const line = firstLine + index;
        return (
          // Note that a line's place in the file is its identity: the lines never reorder.
          <Fragment key={line}>
            {before?.(line)}
            <div className="code-line" data-pointed={String(isPointed(pointed, line))}>
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
          </Fragment>
        );
      })}
    </>
  );
}

/** How a run of lines is drawn: its numbers shown or not, wrapped or not. */
export interface LinesLook {
  readonly lineNumbers: boolean;
  readonly wrap: boolean;
}

/** The look every File tab's lines, and a page's source, are drawn in: the File tabs' settings (`file-view-settings.ts`). */
export function useLinesLook(): LinesLook {
  const { settings } = useFileViewSettings();
  return { lineNumbers: settings.lineNumbers, wrap: settings.wordWrap };
}

/** Lines numbered from `firstLine`, those `pointed` names lit, scrolling in the place they fill as `look` says. */
export function CodeLinesView({
  look,
  firstLine,
  lines,
  pointed,
  before,
  above,
  below,
  fade = SCROLL_FADE.NONE,
  scrollerRef,
}: {
  look: LinesLook;
  firstLine: number;
  lines: CodeLines;
  pointed: CodeRef;
  /** What stands before a line, by its number; nothing where absent. */
  before?: ((line: number) => ReactNode) | undefined;
  /** What stands over the first line, in the scroll; nothing where absent. */
  above?: ReactNode;
  /** What stands under the last line, in the scroll; nothing where absent. */
  below?: ReactNode;
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
      <div
        className="code-lines"
        data-line-numbers={String(look.lineNumbers)}
        data-wrap={String(look.wrap)}
      >
        {above}
        <CodeLineRows firstLine={firstLine} lines={lines} pointed={pointed} before={before} />
        {below}
      </div>
    </ScrollArea>
  );
}
