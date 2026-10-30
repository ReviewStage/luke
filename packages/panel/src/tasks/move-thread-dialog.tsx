import type { Channel } from "@luke/features/channel-wire";
import type { InboxItem } from "@luke/features/inbox-wire";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import {
  ChoiceList,
  DIALOG_SIZE,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  ErrorLine,
  SCROLL_SIZE,
  ScrollArea,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { useRef, useState } from "react";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import type { MoveRefused } from "./use-channels.js";

/**
 * move-thread-dialog.tsx -- Move to channel, from an Inbox row's ⋯ with Channels on: the workspace's other open channels, one picked, and the thread moved there.
 *
 * The dialog lists every open channel but the one the thread stands in,
 * each by its name and its purpose, as the sidebar lists them, the first
 * picked as it opens. It is the move's confirmation, so its act is the move
 * itself, at the foot of a `Dialog` that picks a channel rather than a
 * `ConfirmDialog`, which only asks yes or no. The question goes with its
 * thread and its surface (`useConfirmDialog`): a thread that leaves the
 * Inbox while it is asked, moved or gone by someone else's hand, takes the
 * question with it, so a stale card never moves it a second time; a move
 * landed puts it away and the Inbox reads its channels again, and a refused
 * one keeps it up saying why under the list.
 */

/** A thread as Move to channel names it: its id, its title, and the channel it stands in, none from a service that names none. */
type MovedThread = Pick<InboxItem, "id" | "title" | "channelId">;

/** One thread's Move to channel as the Inbox holds it. */
interface MoveThreadDoor {
  /** The menu item's press, for the thread it moves; none where no other channel stands to move to. */
  readonly ask: ((thread: MovedThread) => void) | undefined;
  /** The dialog, which stands while the move is asked, running, or refused. */
  readonly dialog: React.JSX.Element;
}

/**
 * Move to channel for every row of the Inbox: `channels` are the
 * workspace's open channels, each offered but the one the thread stands
 * in, and `onMoved` is told once a move lands.
 */
export function useMoveThreadDialog({
  channels,
  threads,
  shown,
  onMove,
  onMoved,
}: {
  channels: readonly Channel[];
  /** The threads the Inbox holds now, which a thread asked about must stay among for its question to stand. */
  threads: readonly MovedThread[];
  /** Whether the Inbox is in sight, which the question goes with. */
  shown: boolean;
  /** Moves a thread into another open channel; what refused it, or none where it moved. */
  onMove: (threadId: string, channelId: string) => Promise<MoveRefused | undefined>;
  onMoved: () => void;
}): MoveThreadDoor {
  const [moving, setMoving] = useState<MovedThread | undefined>(undefined);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const first = useRef<HTMLButtonElement | null>(null);
  const others = channels.filter((channel) => channel.id !== moving?.channelId);
  const chosen = others.find((channel) => channel.id === picked) ?? others[0];
  const confirm = useConfirmDialog(
    {
      subject:
        moving !== undefined &&
        chosen !== undefined &&
        threads.some((thread) => thread.id === moving.id),
      surfaceOpen: shown,
    },
    () => {
      if (moving === undefined || chosen === undefined) {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
      }
      return onMove(moving.id, chosen.id).then((refused) => {
        if (refused !== undefined) {
          return {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: refused.words,
            cause: refused.cause,
          };
        }
        onMoved();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      });
    },
    confirmFailure(FAILURE_SURFACE.CHANNEL_MOVE),
  );
  const form = useFormDialog(confirm, chosen !== undefined);
  return {
    ask:
      channels.length < 2
        ? undefined
        : (thread) => {
            setMoving(thread);
            setPicked(undefined);
            confirm.ask();
          },
    dialog: (
      <Dialog
        open={form.open}
        size={DIALOG_SIZE.CONFIRM}
        title={`Move “${moving?.title ?? ""}” to another channel`}
        busy={form.settling}
        refused={form.refusal !== undefined}
        initialFocus={first}
        onDismiss={form.dismiss}
        actions={
          <DialogActions
            onCancel={form.dismiss}
            act={{
              verb: chosen === undefined ? "Move" : `Move to #${chosen.name}`,
              tone: DIALOG_TONE.PRIMARY,
              running: "Moving",
              ...form.act,
            }}
          />
        }
      >
        <ScrollArea size={SCROLL_SIZE.CONTENT}>
          <ChoiceList
            legend="Channel"
            options={others.map((channel) => ({
              value: channel.id,
              label: `#${channel.name}`,
              detail: channel.purpose,
            }))}
            value={chosen === undefined ? [] : [chosen.id]}
            disabled={form.settling}
            focusRef={first}
            onChange={([channelId]) => {
              if (channelId !== undefined) setPicked(channelId);
              if (confirm.rejection !== undefined) confirm.ask();
            }}
          />
        </ScrollArea>
        <ErrorLine error={form.refusal} />
      </Dialog>
    ),
  };
}
