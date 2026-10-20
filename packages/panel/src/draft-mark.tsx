/**
 * draft-mark.tsx -- the small muted pencil a sidebar task's row wears while a draft waits in one of its boxes and another task is open, an Inbox item's row while its box holds one and another item is chosen, and the sidebar's New task row while its words wait in the workspace and neither its card nor Home shows them (`composer-drafts.ts`).
 *
 * Slack marks a channel holding an unsent message with a pencil, and a
 * draft here wears the same, in a row's marks before its time, in the muted
 * ink beside the row's other marks. As Slack marks no channel the developer
 * is in, the task open wears none, its row nor any of its tabs: its drafts
 * are a tab away, so the pencil says something only once the developer has
 * gone to another task. So too the Inbox item chosen, whose box shows its
 * words beside the list. It is named Draft to a reader, a fixed word, so
 * nothing of the words waiting rides it.
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
