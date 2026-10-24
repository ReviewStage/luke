import { INBOX_STATUS } from "@luke/features/inbox-wire";
import {
  ConfirmDialog,
  INSET,
  type SelectionAct,
  SelectionBar,
  STATUS_TONE,
  Stack,
  useConfirmDialog,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useState } from "react";
import { COMMAND_PLACE, commandWords, PANEL_COMMAND } from "../command-items.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { closeAllQuestion, closedNote, type InboxCloser } from "./inbox-close.js";
import { type InboxListed, isUnread } from "./inbox-model.js";
import { type MarkSaying, markedNote } from "./use-inbox-read-marks.js";

/**
 * inbox-selection.tsx -- the bar over the Inbox's list while items of it are chosen: Mark as read, Mark as unread, and Resolve, each for every item chosen at once.
 *
 * The list chooses its rows as a Mac's list does (`@luke/ui`'s
 * `list-selection.ts`), and this bar stands at its foot while any is
 * chosen, so choosing one moves no row under the pointer. Mark as read is
 * offered while an item chosen is unread, and marks those; Mark as unread
 * while one is read, and marks those; each mark goes as the row's own does,
 * one item at a time (`use-inbox-read-marks.ts`), and answers with one
 * toast once the service did, whose Undo puts each item it took back as it
 * stood, and which names how many it refused. Resolve is offered while an
 * item chosen is open, and closes those without an answer as the row's own
 * close does (`inbox-close.tsx`): since only an item's agent can open it
 * again, and each agent is told, it asks once for them all first, in red,
 * and no Undo follows; a toast names how many the service refused. Each act
 * lets the selection go.
 */

/** What the bar's Resolve says. */
const RESOLVE = "Resolve";

/** Marks one listed item read or unread, answering whether the service took it. */
export type InboxListMark = (
  listed: InboxListed,
  unread: boolean,
  saying?: MarkSaying,
) => Promise<boolean>;

/**
 * The bar over the Inbox's list holding the items `listed`, chosen there;
 * nothing while none is. `controls` is the id of the region its rows are
 * chosen in, which takes the focus once the bar goes.
 */
export function InboxSelectionBar({
  listed,
  controls,
  shown,
  onClear,
  onMark,
  onClose,
}: {
  /** The items chosen, in the order the list draws them. */
  listed: readonly InboxListed[];
  controls: string;
  /** Whether the list is on screen, for Resolve's question not to outlive it. */
  shown: boolean;
  onClear: () => void;
  /** Marks one item read or unread, answering whether the service took it; none where the list offers no mark. */
  onMark?: InboxListMark | undefined;
  /** Closes one open item without an answer; none where the list offers no close. */
  onClose?: InboxCloser | undefined;
}): React.JSX.Element {
  const toast = useToast();
  // The open items Resolve asked about, at the revisions it asked on.
  const [resolving, setResolving] = useState<readonly InboxListed[]>([]);
  const open = listed.filter(({ item }) => item.status === INBOX_STATUS.OPEN);
  // Note that the question stands only while every item it asked about is still chosen and open at the revision asked on, so an agent's change or an item let go withdraws it whole rather than resolving what the reader never saw.
  const unchanged = resolving.every(({ item }) =>
    open.some((each) => each.item.id === item.id && each.item.revision === item.revision),
  );
  const asked = unchanged ? resolving : [];
  const confirm = useConfirmDialog({ subject: asked.length > 0, surfaceOpen: shown }, () => {
    const closing = asked;
    if (onClose !== undefined) {
      void Promise.all(closing.map(({ item }) => onClose(item, { quiet: true }))).then((taken) => {
        const refused = taken.filter((each) => !each).length;
        if (refused === 0) return;
        toast({
          words: closedNote(taken.length - refused, refused),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
        });
      });
    }
    onClear();
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });

  // Note that each item's mark goes on its own, there being no act marking several, and one toast answers them all once each did.
  const markAll = (marking: readonly InboxListed[], unread: boolean, undoable: boolean) => {
    if (onMark === undefined || marking.length === 0) return;
    void Promise.all(marking.map((entry) => onMark(entry, unread, { quiet: true }))).then(
      (taken) => {
        const landed = marking.filter((_, at) => taken[at] === true);
        const refused = marking.length - landed.length;
        if (undoable && landed.length > 0) {
          const note = markedNote(unread, landed.length, refused);
          toast(undoToast(note, () => markAll(landed, !unread, false)));
          return;
        }
        if (refused === 0) return;
        toast({
          words: markedNote(unread, landed.length, refused),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
        });
      },
    );
  };

  const unread = listed.filter(({ item }) => isUnread(item));
  const read = listed.filter(({ item }) => !isUnread(item));
  const acted = (act: () => void) => () => {
    act();
    onClear();
  };
  const markRead = PANEL_COMMAND.MARK_READ;
  const markUnread = PANEL_COMMAND.MARK_UNREAD;
  const acts: SelectionAct[] = [
    ...(onMark === undefined || unread.length === 0
      ? []
      : [
          {
            label: commandWords(markRead, COMMAND_PLACE.MENU),
            icon: markRead.icon,
            onAct: acted(() => markAll(unread, false, true)),
          },
        ]),
    ...(onMark === undefined || read.length === 0
      ? []
      : [
          {
            label: commandWords(markUnread, COMMAND_PLACE.MENU),
            icon: markUnread.icon,
            onAct: acted(() => markAll(read, true, true)),
          },
        ]),
    ...(onClose === undefined || open.length === 0
      ? []
      : [
          {
            label: RESOLVE,
            icon: <GLYPH.DISMISSED />,
            onAct: () => {
              setResolving(open);
              confirm.ask();
            },
          },
        ]),
  ];
  return (
    <>
      {listed.length === 0 ? null : (
        <Stack inset={INSET.COLUMN}>
          <SelectionBar count={listed.length} acts={acts} onClear={onClear} controls={controls} />
        </Stack>
      )}
      <ConfirmDialog
        open
        confirm={confirm}
        question={closeAllQuestion(asked.map(({ item }) => item))}
      />
    </>
  );
}
