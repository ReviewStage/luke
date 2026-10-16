import { DIFF_ROW, type DiffRow } from "./changes-model";
import { BLANK_LINE_TEXT, CodeLineNumber } from "./code-pane";

/**
 * diff-rows.tsx -- a review thread's preview on the overview (`agent-pull-request-tab.tsx`): the rows of the hunk it is on in a File tab's lines.
 *
 * Each row keeps a File tab's gutter, selection, settings, and type,
 * numbered on both sides; what is a diff's alone is the tint of a line
 * added or removed and git's note on a line (tasks.css), on the diff
 * colours Files changed draws in.
 */

/** One row of a hunk in a File tab's line: the old side's number, the new side's, and its text, tinted by what it is, git's note trimmed and a blank line held open. */
export function DiffRowLine({ row }: { row: DiffRow }): React.JSX.Element {
  return (
    <div className="code-line" data-diff={row.kind}>
      <CodeLineNumber line={row.oldLine} />
      <CodeLineNumber line={row.newLine} />
      <code className="code-line-text">
        {row.kind === DIFF_ROW.NOTE
          ? row.text.trim()
          : row.text === ""
            ? BLANK_LINE_TEXT
            : row.text}
      </code>
    </div>
  );
}
