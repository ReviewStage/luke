import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { type SelectionGlyphAct, STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useRef } from "react";
import { firstRefusal, type Kept } from "../act.js";
import { COMMAND_PLACE, commandWords, PANEL_COMMAND } from "../command-items.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { type InboxResolver, RESOLVE } from "./inbox-close.js";
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
 * resolves the open items without an answer as the row's own does, at once,
 * with one toast whose Undo takes them all back before any agent is told
 * (`inbox-close.tsx`). Each act lets the selection go.
 */

/** Marks one listed item read or unread, answering whether the service took it, with what refused it where it did not. */
export type InboxListMark = (
  listed: InboxListed,
  unread: boolean,
  saying?: MarkSaying,
) => Promise<Kept>;

/** What the Inbox offers for the items chosen in its list. */
export interface InboxSelection {
  readonly acts: readonly SelectionGlyphAct[];
}

/** The acts on the items `listed`, chosen in the Inbox's list; none while none is. */
export function useInboxSelection({
  listed,
  onClear,
  onMark,
  onClose,
  onRemindMany,
  onPick,
}: {
  /** The items chosen, in the order the list draws them. */
  listed: readonly InboxListed[];
  onClear: () => void;
  /** Marks one item read or unread, answering whether the service took it; none where the list offers no mark. */
  onMark?: InboxListMark | undefined;
  /** Resolves open items without an answer; none where the list offers no resolve. */
  onClose?: InboxResolver | undefined;
  /** Sets or clears the reminder of several items; none where the list offers no reminder. */
  onRemindMany?: InboxRemindMany | undefined;
  /** Opens the date picker by the items chosen for a time of the reader's own, handing it to `onAt`. */
  onPick?: ((items: readonly InboxItem[], onAt: (at: number) => void) => void) | undefined;
}): InboxSelection {
  const toast = useToast();
  // The items chosen as of the latest draw, which a time picked after the picker opened is set on.
  const chosenNow = useRef(listed);
  chosenNow.current = listed;
  const open = listed.filter(({ item }) => item.status === INBOX_STATUS.OPEN);

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
            icon: <GLYPH.RESOLVED />,
            onAct: acted(() => onClose(open.map(({ item }) => item))),
          },
        ]),
  ];
  return { acts };
}
