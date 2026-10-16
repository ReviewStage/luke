/**
 * draft-mark.tsx -- the small muted pencil a sidebar task's row and a tab wear while a draft waits in a box of theirs out of sight (`composer-drafts.ts`).
 *
 * Slack marks a channel holding an unsent message with a pencil, and an
 * editor marks a file's tab with unsaved changes by a dot in its ×'s place;
 * a draft here wears the one and stands where the other does: in a row's
 * marks before its time, in the muted ink beside the row's other marks, and
 * at a tab's end, giving way to the × under the pointer. As Slack marks
 * no channel the developer is in, the chosen tab wears none, its box
 * showing the words itself, and the open task's row marks only a draft
 * behind none of its open tabs, which mark their own. It is named Draft
 * to a reader, a fixed word, so nothing of the words waiting rides it.
 */

import { PencilLineIcon } from "lucide-react";

/** What the mark is called. */
export const DRAFT_WORD = "Draft";

export function DraftMark(): React.JSX.Element {
  return (
    <span className="draft-mark" role="img" aria-label={DRAFT_WORD}>
      <PencilLineIcon aria-hidden="true" />
    </span>
  );
}
