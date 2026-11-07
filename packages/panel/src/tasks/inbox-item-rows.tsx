import { List } from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { type RefObject, useState } from "react";
import { useInboxRowDrafts } from "../composer-drafts.js";
import { useSteadyDoor } from "../steady-door.js";
import { useInboxResolver } from "./inbox-close.js";
import { useInboxRowPresses } from "./inbox-columns.js";
import { InboxItemRow, inboxRowDraft } from "./inbox-list.js";
import type { InboxListed } from "./inbox-model.js";
import { useInboxRowActs } from "./inbox-row-acts.js";
import { choiceOf } from "./use-inbox-listing.js";
import { useInboxReadMarks } from "./use-inbox-read-marks.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * inbox-item-rows.tsx -- Inbox items listed outside the Inbox, as Home and a person's page list what waits: the Inbox's own rows, acting as its list's do.
 *
 * Each row is the Inbox's (`InboxItemRow`), its press opening the Inbox on
 * its item, and its menu the one the Inbox's list offers, over the same
 * doors (`useInboxRowActs`): Copy link where the page hands down a workspace
 * to write it under, Mark as read or unread, Remind me, and Resolve, at
 * once with Undo. No row here is chosen, so U, H, and E, which act on the
 * chosen item, are the Inbox's alone. The rows stay masked in a screen recording
 * but for the words a row unmasks itself.
 */

/** The listed workspace's items `listed` as the Inbox's rows, in a list named `label` that joins the page's walk or moves its rows where said. */
export function InboxItemRows({
  label,
  listed,
  tasks,
  needsYouShown = false,
  joinsWalk = false,
  moves = false,
}: {
  label: string;
  listed: readonly InboxListed[];
  tasks: TasksControl;
  /** Whether the rows stand under a name that already says Needs you. */
  needsYouShown?: boolean;
  /** Whether the rows join the walk of a `useRovingKeys` box around the list. */
  joinsWalk?: boolean;
  /** Whether the rows move as they arrive, leave, and change places. */
  moves?: boolean;
}): React.JSX.Element {
  const drafts = useInboxRowDrafts();
  const rows = useInboxRowPresses();
  // Note that the picker opens beside a row, so the rows themselves are the room it needs standing, there being no box of the list's own.
  const [room] = useState(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        return rows.first() ?? null;
      },
    }),
  );
  const marks = useInboxReadMarks({ workspaceId: tasks.workspace?.id });
  const resolve = useInboxResolver();
  const acts = useInboxRowActs({
    doors: {
      onMark: (each, unread, saying) => marks.onMark(each.item, unread, saying),
      onResolve: resolve,
      onRemind: marks.onRemind,
    },
    room,
    rowOf: rows.find,
    chosen: undefined,
    shown: tasks.shown,
  });
  // Note that the press stands across draws, as the acts' doors do, so a row is drawn again only where its item moves.
  const open = useSteadyDoor((each: InboxListed) => tasks.inboxView.onOpenItem(choiceOf(each)));
  return (
    <>
      <ReplayMask>
        <List label={label} joinsWalk={joinsWalk} moves={moves}>
          {listed.map((each) => (
            <InboxItemRow
              key={each.item.id}
              ref={rows.hold(each.item.id)}
              listed={each}
              chosen={false}
              {...inboxRowDraft(drafts.get(each.item.id), each.item, false)}
              models={tasks.agents.models}
              readerId={tasks.me}
              needsYouShown={needsYouShown}
              onChoose={open}
              {...acts.row}
            />
          ))}
        </List>
      </ReplayMask>
      {acts.layers}
    </>
  );
}
