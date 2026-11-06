import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ConfirmDialog, type SelectionGlyphAct, STATUS_TONE, useConfirmDialog } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useRef, useState } from "react";
import { firstRefusal, type Kept } from "../act.js";
import { COMMAND_PLACE, commandWords, PANEL_COMMAND } from "../command-items.js";
import { confirmFailure } from "../failure-report.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { closeAllQuestion, closedNote, type InboxCloser } from "./inbox-close.js";
import { type InboxListed, isUnread } from "./inbox-model.js";
import { type InboxRemindMany, REMIND_ME, remindManyGroups } from "./inbox-remind.js";
import { type MarkSaying, markedNote } from "./use-inbox-read-marks.js";

/**
 * inbox-selection.tsx -- what the Inbox offers for the items chosen in its list, at once: Mark as read or unread, Remind me, and Resolve, which its head draws as glyphs and a chosen row's menu as items.
 *
 * The list chooses its rows as a Mac's list does (`@repo/ui`'s
 * `list-selection.ts`), and while any is chosen its head says how many in
 * the list's name's place, with these acts beside (`SelectionToolbar`), and
 * a right-click on a chosen row offers the same acts under the count
 * (`selectionMenu`). An act stands only where it would change one of the
 * items chosen, and takes only those, as a Mac's menus hide what would do
 * nothing: Mark as read while one is unread, else Mark as unread, one item
 * whose words turn as Mail's do; Remind me always, its times set on every
 * item, with Clear reminders where one holds a reminder
 * (`inbox-remind.tsx`); and Resolve while one is open. Each mark goes as the
 * row's own does, one item at a time (`use-inbox-read-marks.ts`), and
 * answers with one toast once the service did, whose Undo puts each item
 * it took back as it stood, and which names how many it refused. Resolve
 * closes the open items without an answer as the row's own close does
 * (`inbox-close.tsx`): since only an item's agent can open it again, and
 * each agent is told, it asks once for them all first, in red, and no Undo
 * follows; a toast names how many the service refused. Each act lets the
 * selection go.
 */

/** What the bar's Resolve says. */
const RESOLVE = "Resolve";

/** Marks one listed item read or unread, answering whether the service took it, with what refused it where it did not. */
export type InboxListMark = (
  listed: InboxListed,
  unread: boolean,
  saying?: MarkSaying,
) => Promise<Kept>;

/** What the Inbox offers for the items chosen in its list: the acts, and the question Resolve asks, which its owner draws. */
export interface InboxSelection {
  readonly acts: readonly SelectionGlyphAct[];
  readonly dialog: React.ReactNode;
}

/** The acts on the items `listed`, chosen in the Inbox's list; none while none is. */
export function useInboxSelection({
  listed,
  shown,
  onClear,
  onMark,
  onClose,
  onRemindMany,
  onPick,
}: {
  /** The items chosen, in the order the list draws them. */
  listed: readonly InboxListed[];
  /** Whether the list is on screen, for Resolve's question not to outlive it. */
  shown: boolean;
  onClear: () => void;
  /** Marks one item read or unread, answering whether the service took it; none where the list offers no mark. */
  onMark?: InboxListMark | undefined;
  /** Closes one open item without an answer; none where the list offers no close. */
  onClose?: InboxCloser | undefined;
  /** Sets or clears the reminder of several items; none where the list offers no reminder. */
  onRemindMany?: InboxRemindMany | undefined;
  /** Opens the date picker by the items chosen for a time of the reader's own, handing it to `onAt`. */
  onPick?: ((items: readonly InboxItem[], onAt: (at: number) => void) => void) | undefined;
}): InboxSelection {
  const toast = useToast();
  // The items chosen as of the latest draw, which a time picked after the picker opened is set on.
  const chosenNow = useRef(listed);
  chosenNow.current = listed;
  // The open items Resolve asked about, at the revisions it asked on.
  const [resolving, setResolving] = useState<readonly InboxListed[]>([]);
  const open = listed.filter(({ item }) => item.status === INBOX_STATUS.OPEN);
  // Note that the question stands only while every item it asked about is still chosen and open at the revision asked on, so an agent's change or an item let go withdraws it whole rather than resolving what the reader never saw.
  const unchanged = resolving.every(({ item }) =>
    open.some((each) => each.item.id === item.id && each.item.revision === item.revision),
  );
  const asked = unchanged ? resolving : [];
  const confirm = useConfirmDialog(
    { subject: asked.length > 0, surfaceOpen: shown },
    () => {
      const closing = asked;
      if (onClose !== undefined) {
        void Promise.all(closing.map(({ item }) => onClose(item, { quiet: true }))).then(
          (taken) => {
            const refused = taken.filter((each) => !each.kept).length;
            if (refused === 0) return;
            toast({
              replayUnmasked: true,
              words: closedNote(taken.length - refused, refused),
              tone: STATUS_TONE.DANGER,
              hold: TOAST_HOLD.FAILED,
              failure: { surface: FAILURE_SURFACE.INBOX_CLOSE, cause: firstRefusal(taken) },
            });
          },
        );
      }
      onClear();
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    confirmFailure(FAILURE_SURFACE.INBOX_CLOSE),
  );

  // Note that each item's mark goes on its own, there being no act marking several, and one toast answers them all once each did.
  const markAll = (marking: readonly InboxListed[], unread: boolean, undoable: boolean) => {
    if (onMark === undefined || marking.length === 0) return;
    void Promise.all(marking.map((entry) => onMark(entry, unread, { quiet: true }))).then(
      (taken) => {
        const landed = marking.filter((_, at) => taken[at]?.kept === true);
        const refused = marking.length - landed.length;
        if (undoable && landed.length > 0) {
          const note = markedNote(unread, landed.length, refused);
          toast({
            ...undoToast(note, () => markAll(landed, !unread, false)),
            replayUnmasked: true,
          });
          return;
        }
        if (refused === 0) return;
        toast({
          replayUnmasked: true,
          words: markedNote(unread, landed.length, refused),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.INBOX_MARK, cause: firstRefusal(taken) },
        });
      },
    );
  };

  const unread = listed.filter(({ item }) => isUnread(item));
  const read = listed.filter(({ item }) => !isUnread(item));
  const items = listed.map(({ item }) => item);
  const acted = (act: () => void) => () => {
    act();
    onClear();
  };
  // Note that one mark stands, turned as Mail's is: read while any item chosen is unread, else unread.
  const mark = unread.length > 0 ? PANEL_COMMAND.MARK_READ : PANEL_COMMAND.MARK_UNREAD;
  const first = items[0];
  const acts: SelectionGlyphAct[] = [
    ...(onMark === undefined || listed.length === 0
      ? []
      : [
          {
            label: commandWords(mark, COMMAND_PLACE.MENU),
            icon: mark.icon,
            onAct: acted(() =>
              unread.length > 0 ? markAll(unread, false, true) : markAll(read, true, true),
            ),
          },
        ]),
    ...(onRemindMany === undefined || first === undefined
      ? []
      : [
          {
            label: REMIND_ME,
            icon: <GLYPH.TIME />,
            replayUnmasked: true,
            menu: remindManyGroups(
              items,
              (chosen, until) => {
                onRemindMany(chosen, until);
                onClear();
              },
              onPick === undefined
                ? undefined
                : () =>
                    onPick(items, (at) => {
                      // Note that only the items still chosen as the time is picked take it, since one may have left the list while the picker stood.
                      const still = items.filter((item) =>
                        chosenNow.current.some((each) => each.item.id === item.id),
                      );
                      onRemindMany(still, at);
                      onClear();
                    }),
            ),
          },
        ]),
    ...(onClose === undefined || open.length === 0
      ? []
      : [
          {
            label: RESOLVE,
            icon: <GLYPH.DISMISSED />,
            // Note that only an item's agent can open it again, so a chosen row's menu draws it red, last and alone.
            danger: true,
            onAct: () => {
              setResolving(open);
              confirm.ask();
            },
          },
        ]),
  ];
  const dialog = (
    <ConfirmDialog
      open
      confirm={confirm}
      question={closeAllQuestion(asked.map(({ item }) => item))}
    />
  );
  return { acts, dialog };
}
