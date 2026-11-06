import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import type { InboxItem } from "@repo/features/inbox-wire";
import { FAILURE_SURFACE, type FailureAbout } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { STATUS_TONE } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { firstRefusal, KEPT, type Kept, notKept, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { afterPaint } from "../after-paint.js";
import { useAppCommand } from "../app-commands.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { acknowledgedOnOpen, type InboxListed, isUnread } from "./inbox-model.js";
import { type InboxReminder, type RemindSaying, remindWords } from "./inbox-remind.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

export interface MarkSaying {
  readonly quiet?: boolean | undefined;
}

export interface InboxReadMarks {
  readonly onMark: (item: InboxItem, unread: boolean, saying?: MarkSaying) => Promise<Kept>;
  readonly onMarkAll: (items: readonly InboxItem[]) => void;
  readonly onMarkEach: (items: readonly InboxItem[]) => void;
  readonly onRemind: InboxReminder;
}

export function markedNote(unread: boolean, landed: number, refused: number): string {
  const state = unread ? "unread" : "read";
  if (landed === 0) return `Could not mark ${countWords(refused, TERM.INBOX_ITEM)} ${state}`;
  const kept = `${countWords(landed, TERM.INBOX_ITEM)} marked ${state}`;
  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

const REMIND_REFUSED = {
  SET: "Could not set the reminder",
  CANCEL: "Could not cancel the reminder",
} as const;

const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

export function useInboxReadMarks({
  workspaceId,
}: {
  workspaceId: string | undefined;
}): InboxReadMarks {
  const toast = useToast();
  const { mutateAsync: sendReadState } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_READ_STATE));
  const { mutateAsync: sendReadAll } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_READ_ALL));
  const { mutateAsync: sendRemind } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_REMIND));
  const refused = useCallback(
    (words: string, cause: unknown, about: FailureAbout) =>
      toast({
        replayUnmasked: true,
        words,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.INBOX_MARK, cause, about },
      }),
    [toast],
  );
  const onMark = useCallback(
    (item: InboxItem, unread: boolean, saying?: MarkSaying): Promise<Kept> =>
      sendReadState({ itemId: item.id, unread })
        .catch(unreached)
        .then((answer) => {
          if (!("failure" in answer)) return KEPT;
          if (saying?.quiet !== true) {
            refused(markedNote(unread, 0, 1), answer, { inboxItemId: item.id, workspaceId });
          }
          return notKept(answer);
        }),
    [sendReadState, workspaceId, refused],
  );
  const onMarkAll = useCallback(
    (items: readonly InboxItem[]) => {
      const itemIds = items.filter(isUnread).map((item) => item.id);
      if (itemIds.length === 0) return;
      sendReadAll({
        ...(workspaceId === undefined ? undefined : { workspaceId }),
        itemIds,
      })
        .catch(unreached)
        .then((answer) => {
          if ("failure" in answer)
            refused(markedNote(false, 0, itemIds.length), answer, { workspaceId });
        });
    },
    [sendReadAll, workspaceId, refused],
  );
  const onMarkEach = useCallback(
    (items: readonly InboxItem[]) => {
      const marking = items.filter(isUnread);
      if (marking.length === 0) return;
      void Promise.all(marking.map((item) => onMark(item, false, { quiet: true }))).then(
        (taken) => {
          const landed = taken.filter((each) => each.kept).length;
          if (landed === marking.length) return;
          refused(markedNote(false, landed, marking.length - landed), firstRefusal(taken), {
            workspaceId,
          });
        },
      );
    },
    [onMark, workspaceId, refused],
  );
  const onRemind = useCallback(
    (item: InboxItem, until: number | null, saying?: RemindSaying): void => {
      void sendRemind({ itemId: item.id, until })
        .catch(unreached)
        .then((answer) => {
          if ("failure" in answer) {
            refused(until === null ? REMIND_REFUSED.CANCEL : REMIND_REFUSED.SET, answer, {
              inboxItemId: item.id,
              workspaceId,
            });
            return;
          }
          if (until !== null && saying?.quiet !== true) {
            toast({
              ...undoToast(`Reminder set for ${remindWords(until, Date.now())}`, () =>
                onRemind(item, null),
              ),
              replayUnmasked: true,
            });
          }
        });
    },
    [sendRemind, workspaceId, refused, toast],
  );
  return useMemo(
    () => ({ onMark, onMarkAll, onMarkEach, onRemind }),
    [onMark, onMarkAll, onMarkEach, onRemind],
  );
}

export function useReadOnOpen({
  shown,
  chosen,
  active,
  onMark,
}: {
  shown: InboxItem | undefined;
  chosen: InboxItem | undefined;
  active: boolean;
  onMark: (item: InboxItem, unread: boolean) => void;
}): void {
  const readOn = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (shown === undefined) {
      readOn.current = undefined;
      return;
    }
    if (readOn.current === shown.id) return;
    readOn.current = shown.id;
    if (isUnread(shown)) afterPaint(() => onMark(shown, false));
  }, [shown, onMark]);
  useAppCommand(
    APP_COMMAND.TOGGLE_READ,
    active && chosen !== undefined ? () => onMark(chosen, !isUnread(chosen)) : undefined,
  );
}

export function useNodOnOpen({
  shown,
  readerId,
  control,
}: {
  shown: InboxListed | undefined;
  readerId: string | undefined;
  control: Pick<TaskInboxControl, "drawn" | "failed" | "draftOf" | "onAcknowledge">;
}): void {
  const nodded = useRef<{ readonly id: string; readonly revision: number } | undefined>(undefined);
  const { drawn, failed, draftOf, onAcknowledge } = control;
  useEffect(() => {
    if (shown === undefined) {
      nodded.current = undefined;
      return;
    }
    if (!drawn || failed || readerId === undefined) return;
    const { item } = shown;
    const was = nodded.current;
    if (was !== undefined && was.id === item.id && was.revision === item.revision) return;
    nodded.current = { id: item.id, revision: item.revision };
    if (!acknowledgedOnOpen(item, readerId)) return;
    const draft = draftOf(item);
    if (draft.note.trim() !== "" || draft.attachments.length > 0) return;
    afterPaint(() => onAcknowledge(item));
  }, [shown, readerId, drawn, failed, draftOf, onAcknowledge]);
}
