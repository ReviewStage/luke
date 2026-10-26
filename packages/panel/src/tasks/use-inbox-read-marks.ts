import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { InboxItem } from "@luke/features/inbox-wire";
import { countWords, TERM } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { STATUS_TONE } from "@luke/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ActHandle } from "../act.js";
import { useAppCommand } from "../app-commands.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { acknowledgedOnOpen, type InboxListed, isUnread } from "./inbox-model.js";
import { type InboxReadMark, useInboxSettler } from "./inbox-settling.js";
import type { TaskInboxControl } from "./use-task-inbox.js";

/**
 * use-inbox-read-marks.ts -- the Inbox's read and unread marks as one control: an item marked read or unread, its dot flipping at once.
 *
 * A mark goes to the service as an act, and is laid over every read the
 * window draws (`@luke/panel`'s `inbox-settling.ts`, through its
 * `withReadMark`) so the dot flips the moment it is pressed, and stands
 * there until a read holds the item changed since, or a held read that
 * held it as marked holds it otherwise, another window's mark among them,
 * whose word the row then draws. Note that a mark moves nothing main hears
 * of, so a list's read of the item's plan is never read again on its
 * account, and the mark stands over it for as long as that read stands. The acts go one at a time, in the order the marks
 * were made, so a quick read, unread, read reaches the service as the last.
 * A mark the service did not take
 * is let go, the dot stands as the reads hold it, and a toast says so, unless
 * the caller asks for quiet because it says the refusal itself, as the
 * selection bar does for the items it marked together. An item waiting on
 * the developer keeps waiting, since the dots are all a mark clears.
 *
 * Opening an item marks it read, once each time it is shown
 * (`useReadOnOpen`), so an item the reader marks unread while it is shown
 * stays unread until they open it again, as a mail app keeps it; and a
 * plain U marks the chosen item read or unread, as its row's menu says.
 * Opening the reader's own notice acknowledges it too (`useNodOnOpen`),
 * once each time it is shown, so an update counts as seen once it is opened.
 */

/** How a mark is told: `quiet` where the caller says a refusal itself, so it is never toasted twice. */
export interface MarkSaying {
  readonly quiet?: boolean | undefined;
}

/** What the Inbox's read marks offer: the presses that mark. */
export interface InboxReadMarks {
  /** Marks one item read or unread; answers, once the mark went, whether the service took it, as a batch of marks counts what it refused. A refusal is toasted unless `saying` is quiet. */
  readonly onMark: (item: InboxItem, unread: boolean, saying?: MarkSaying) => Promise<boolean>;
}

/** The mark an item takes: what it says, of the item as it was marked. */
function markOf(item: InboxItem, unread: boolean): InboxReadMark {
  return { unread, updatedAt: item.updatedAt };
}

/** What one toast says of read marks given to several items: how many the service took, and how many not. */
export function markedNote(unread: boolean, landed: number, refused: number): string {
  const state = unread ? "unread" : "read";
  if (landed === 0) return `Could not mark ${countWords(refused, TERM.INBOX_ITEM)} ${state}`;
  const kept = `${countWords(landed, TERM.INBOX_ITEM)} marked ${state}`;
  return refused === 0 ? kept : `${kept}, ${refused} could not be`;
}

/** What a mark the act channel refused hears, as the service not answering. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** An item's latest mark still to go: what it says, and the press it was made by. */
interface Wanted {
  readonly made: symbol;
  readonly unread: boolean;
}

/**
 * The Inbox's read marks, sent through `act`. Nothing reads the Inbox again
 * once the service took a mark: the followed inboxes are pushed each item's
 * read state as it moves.
 *
 * A mark stands over every read the window draws (`inbox-settling.ts`)
 * until a read holds the item changed since, or a held read holds a later
 * mark, another window's included, which the row then draws. The marks go to
 * the service one at a time, in the order they were made, an item's later
 * mark standing for any of its own still waiting to go, so a quick read,
 * unread, read reaches it as the last.
 */
export function useInboxReadMarks({ act }: { act: ActHandle["act"] }): InboxReadMarks {
  const settler = useInboxSettler();
  const toast = useToast();
  const refused = useCallback(
    (words: string) => toast({ words, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED }),
    [toast],
  );
  // The writes, one after another, and each item's latest mark still to go, which its queued write sends.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const wanted = useRef(new Map<string, Wanted>());
  // Note that a mark a later one stood for before it went answers as taken, since the write that sent the later one answers its own press.
  const onMark = useCallback(
    (item: InboxItem, unread: boolean, saying?: MarkSaying): Promise<boolean> => {
      const made = settler.mark(new Map([[item.id, markOf(item, unread)]]));
      wanted.current.set(item.id, { made, unread });
      const sent = queue.current.then(() => {
        const latest = wanted.current.get(item.id);
        if (latest === undefined) return true;
        wanted.current.delete(item.id);
        return act(ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, {
          itemId: item.id,
          unread: latest.unread,
        })
          .catch(() => UNANSWERED)
          .then((answer) => {
            // Note that a mark is let go only where it still stands as it was made, so a later mark on the same item outlives an earlier one's refusal.
            if (!("failure" in answer)) {
              settler.marked(latest.made);
              return true;
            }
            settler.unmark(latest.made);
            if (saying?.quiet !== true) refused(markedNote(latest.unread, 0, 1));
            return false;
          });
      });
      queue.current = sent.then(() => undefined);
      return sent;
    },
    [act, settler, refused],
  );
  return useMemo(() => ({ onMark }), [onMark]);
}

/**
 * Marks the item an Inbox shows read as it is opened, once each time it is
 * shown, and offers U, which marks the chosen item read or unread, while
 * the Inbox stands. `shown` is the item the pane draws, none while the
 * Inbox is hidden or shows its list alone.
 */
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
    if (isUnread(shown)) onMark(shown, false);
  }, [shown, onMark]);
  useAppCommand(
    APP_COMMAND.TOGGLE_INBOX_ITEM_READ,
    active && chosen !== undefined ? () => onMark(chosen, !isUnread(chosen)) : undefined,
  );
}

/**
 * Acknowledges the notice an Inbox shows as it is opened, as Got it did,
 * once for each revision each time it is shown, where opening it settles it
 * (`inbox-model.ts`'s `acknowledgedOnOpen`): the reader's own, messaging
 * nobody, and its box holding no words or files, which stay a reply to send. `shown` is the item the pane
 * draws, none while the Inbox is hidden or shows its list alone; `control`
 * is the held read of its holder, which the item is waited on until it
 * holds, so the answer names the revision the service holds rather than an
 * older list's. An item opened while it cannot be acknowledged is left as
 * it is until it is opened again, so a box emptied of its draft does not
 * settle it under the reader's hands.
 */
export function useNodOnOpen({
  shown,
  readerId,
  control,
}: {
  shown: InboxListed | undefined;
  readerId: string | undefined;
  control: Pick<TaskInboxControl, "read" | "failed" | "draftOf" | "onAcknowledge">;
}): void {
  const nodded = useRef<{ readonly id: string; readonly revision: number } | undefined>(undefined);
  const { read, failed, draftOf, onAcknowledge } = control;
  useEffect(() => {
    if (shown === undefined) {
      nodded.current = undefined;
      return;
    }
    // Note that nothing is settled until the holder's held read and the reader's id stand, so neither an older revision nor a teammate's notice is acknowledged.
    if (!read || failed || readerId === undefined) return;
    const { item } = shown;
    const was = nodded.current;
    if (was !== undefined && was.id === item.id && was.revision === item.revision) return;
    nodded.current = { id: item.id, revision: item.revision };
    if (!acknowledgedOnOpen(item, readerId)) return;
    const draft = draftOf(item);
    if (draft.note.trim() !== "" || draft.attachments.length > 0) return;
    onAcknowledge(item);
  }, [shown, readerId, read, failed, draftOf, onAcknowledge]);
}
