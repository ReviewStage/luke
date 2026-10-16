import { DIFF_ROW, type DiffRow } from "./changes-model";
import { BLANK_LINE_TEXT, CodeLineNumber } from "./code-pane";

/**
 * diff-rows.tsx -- a unified diff's rows in a File tab's lines: Files changed draws a file's hunks in them (`agent-changes-tab.tsx`), and a review thread on the overview previews the lines it is on in them (`agent-pull-request-tab.tsx`).
 *
 * Each row keeps a File tab's gutter, selection, settings, and type,
 * numbered on both sides; what is a diff's alone is the tint of a line
 * added or removed, a hunk's header, and git's note on a line (tasks.css).
 */

/** What the row holding a hunk's header is, beside the kinds of row the hunk holds. */
export const DIFF_HUNK = "hunk";

type DiffLineKind = (typeof DIFF_ROW)[keyof typeof DIFF_ROW] | typeof DIFF_HUNK;

/** One row of the diff in a File tab's line: the old side's number, the new side's, and its text, tinted by what it is. */
export function DiffLine({
  kind,
  oldLine,
  newLine,
  children,
}: {
  kind: DiffLineKind;
  oldLine: number | undefined;
  newLine: number | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="code-line" data-diff={kind}>
      <CodeLineNumber line={oldLine} />
      <CodeLineNumber line={newLine} />
      <code className="code-line-text">{children}</code>
    </div>
  );
}

/** One row of a hunk in its line, git's note trimmed and a blank line held open. */
export function DiffRowLine({ row }: { row: DiffRow }): React.JSX.Element {
  return (
    <DiffLine kind={row.kind} oldLine={row.oldLine} newLine={row.newLine}>
      {row.kind === DIFF_ROW.NOTE ? row.text.trim() : row.text === "" ? BLANK_LINE_TEXT : row.text}
    </DiffLine>
  );
}
