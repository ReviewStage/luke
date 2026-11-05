/**
 * draft-mark.tsx -- the small muted pencil, or the failed mark where a message did not go, a sidebar task's row wears while a draft waits in one of its boxes and another task is open, the open task's agent's, draft agent's, or Inbox tab while its box holds one and another tab is chosen, an Inbox item's row while its box holds one and another item is chosen, and the sidebar's New task row while its words wait in the workspace and neither its card nor Home shows them (`composer-drafts.ts`).
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
 *
 * A message that was sent and did not go is no draft, so the place it went
 * wears the failed mark in the pencil's place while it waits on Retry, Edit,
 * or Delete (`tasks/failed-lines.ts`): the task's row and the agent's row
 * while another is open, and the agent's tab while another is chosen, as a
 * chat app marks a conversation holding a message not delivered.
 */

import { ROW_MARK, RowMark } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { PencilLineIcon } from "lucide-react";

/** What the mark is called. */
export const DRAFT_WORD = "Draft";

export function DraftMark(): React.JSX.Element {
  return (
    <RowMark
      kind={ROW_MARK.DRAFT}
      label={DRAFT_WORD}
      glyph={<PencilLineIcon aria-hidden="true" />}
    />
  );
}

/** What the failed mark is called. */
const NOT_DELIVERED_WORD = "Not delivered";

/** The failed mark a row or tab wears in the pencil's place while a message sent there was not delivered. */
export function NotDeliveredMark(): React.JSX.Element {
  return <RowMark kind={ROW_MARK.FAILED} label={NOT_DELIVERED_WORD} glyph={<GLYPH.FAILED />} />;
}

/** The mark a place wears for what was left in it: the failed mark where a message was not delivered, else the pencil where a draft waits, else none. */
export function leftMark(failed: boolean, drafted: boolean): React.JSX.Element | null {
  if (failed) return <NotDeliveredMark />;
  return drafted ? <DraftMark /> : null;
}
