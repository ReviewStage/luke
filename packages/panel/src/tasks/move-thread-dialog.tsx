import type { Channel, ChannelThread } from "@luke/features/channel-wire";
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

/**
 * move-thread-dialog.tsx -- Move to channel, from a post's ⋯ in a channel's stream: the workspace's other open channels, one picked, and the thread moved there.
 *
 * The dialog lists every open channel but the one the thread stands in,
 * each by its name and its purpose, as the sidebar lists them, the first
 * picked as it opens. It is the move's confirmation, so its act is the move
 * itself, at the foot of a `Dialog` that picks a channel rather than a
 * `ConfirmDialog`, which only asks yes or no. The question goes with its
 * thread and its surface (`useConfirmDialog`): a thread that leaves the
 * stream while it is asked, moved or gone by someone else's hand, takes the
 * question with it, so a stale card never moves it a second time; a move
 * landed puts it away and the stream reads its threads again, and a refused
 * one keeps it up saying why under the list.
 */

/** One thread's Move to channel as a stream holds it. */
interface MoveThreadDoor {
  /** The menu item's press, for the thread it moves; none where no other channel stands to move to. */
  readonly ask: ((thread: ChannelThread) => void) | undefined;
  /** The dialog, which stands while the move is asked, running, or refused. */
  readonly dialog: React.JSX.Element;
}

/**
 * Move to channel for every post of one channel's stream: `channels` are
 * the workspace's open channels, `from` the one the stream shows, and
 * `onMoved` is told once a move lands.
 */
export function useMoveThreadDialog({
  channels,
  from,
  threads,
  shown,
  onMove,
  onMoved,
}: {
  channels: readonly Channel[];
  from: string;
  /** The threads the stream holds now, which a thread asked about must stay among for its question to stand. */
  threads: readonly ChannelThread[];
  /** Whether the stream is in sight, which the question goes with. */
  shown: boolean;
  /** Moves a thread into another open channel; what refused it, or none where it moved. */
  onMove: (threadId: string, channelId: string) => Promise<string | undefined>;
  onMoved: () => void;
}): MoveThreadDoor {
  const [moving, setMoving] = useState<ChannelThread | undefined>(undefined);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const first = useRef<HTMLButtonElement | null>(null);
  const others = channels.filter((channel) => channel.id !== from);
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
        if (refused !== undefined)
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: refused };
        onMoved();
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      });
    },
  );
  const form = useFormDialog(confirm, chosen !== undefined);
  return {
    ask:
      others.length === 0
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
        <ErrorLine>{form.refusal}</ErrorLine>
      </Dialog>
    ),
  };
}
