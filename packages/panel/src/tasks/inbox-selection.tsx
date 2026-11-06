import { INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ConfirmDialog, type SelectionGlyphAct, STATUS_TONE, useConfirmDialog } from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { useRef, useState } from "react";
import { firstRefusal, type Kept } from "../act.js";
import { COMMAND_PLACE, commandWords, PANEL_COMMAND } from "../command-items.js";
import { confirmFailure } from "../failure-report.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { closeAllQuestion, closedNote, type InboxCloser } from "./inbox-close.js";
import { type InboxListed, isUnread } from "./inbox-model.js";
import { type InboxRemindMany, REMIND_ME, remindManyGroups } from "./inbox-remind.js";
import { type MarkSaying, markedNote } from "./use-inbox-read-marks.js";

const RESOLVE = "Resolve";

export type InboxListMark = (
  listed: InboxListed,
  unread: boolean,
  saying?: MarkSaying,
) => Promise<Kept>;

export interface InboxSelection {
  readonly acts: readonly SelectionGlyphAct[];
  readonly dialog: React.ReactNode;
}

export function useInboxSelection({
  listed,
  shown,
  onClear,
  onMark,
  onClose,
  onRemindMany,
  onPick,
}: {
  listed: readonly InboxListed[];
  shown: boolean;
  onClear: () => void;
  onMark?: InboxListMark | undefined;
  onClose?: InboxCloser | undefined;
  onRemindMany?: InboxRemindMany | undefined;
  onPick?: ((items: readonly InboxItem[], onAt: (at: number) => void) => void) | undefined;
}): InboxSelection {
  const toast = useToast();
  const chosenNow = useRef(listed);
  chosenNow.current = listed;
  const [resolving, setResolving] = useState<readonly InboxListed[]>([]);
  const open = listed.filter(({ item }) => item.status === INBOX_STATUS.OPEN);
  const unchanged = resolving.every(({ item }) =>
    open.some((each) => each.item.id === item.id && each.item.revision === item.revision),
  );
  const asked = unchanged ? resolving : [];
  const confirm = useConfirmDialog(
    { subject: asked.length > 0, surfaceOpen: shown },
    neverBusyAct(() => {
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
    }),
    confirmFailure(FAILURE_SURFACE.INBOX_CLOSE),
  );

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
