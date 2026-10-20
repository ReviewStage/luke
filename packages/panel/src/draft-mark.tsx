/**
 * draft-mark.tsx -- the small muted pencil a sidebar task's row wears while a draft waits in one of its boxes and another task is open, the open task's agent's, draft agent's, or Inbox tab while its box holds one and another tab is chosen, an Inbox item's row while its box holds one and another item is chosen, and the sidebar's New task row while its words wait in the workspace and neither its card nor Home shows them (`composer-drafts.ts`).
 *
 * Slack marks a channel holding an unsent message with a pencil, and a
 * draft here wears the same, in a row's marks before its time, in the muted
 * ink beside the row's other marks. As Slack marks no channel the developer
 * is in, the task open wears none on its row. Its tabs say which of its
 * boxes holds the words instead: a tab holding a draft wears the pencil at
 * its end, in its ×'s place, as an editor's tab wears its unsaved dot, while
 * another tab is chosen, and none while it is the one chosen, whose box
 * shows its words. So too the Inbox item chosen, whose box shows its words
 * beside the list. It is named Draft to a reader, a fixed word, so nothing
 * of the words waiting rides it.
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
