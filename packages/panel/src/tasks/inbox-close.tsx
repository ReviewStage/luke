import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import { INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ConfirmDialog, type DialogQuestion, useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { CircleSlashIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ActHandle } from "../act.js";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { messageFailureWords } from "./coding-agent-model.js";
import { useInboxSettler } from "./inbox-settling.js";
import { cardTitle } from "./tool-call-model.js";

/**
 * inbox-close.tsx -- an open Inbox item closed without an answer, from its row's menu and hover icon or its pane's ⋯ menu, asked first.
 *
 * A close goes to the service as an act, under a key kept for the item at
 * the revision it was pressed on, so a press again after a lost reply is
 * the same close. It is laid over every read the window draws the moment
 * it is confirmed (`inbox-settling.ts`), so the item leaves what needs the
 * developer at once. A close taken lets go of the item's draft, wherever
 * its task stands; one the service did not take lays the item as the
 * service answered it, the agent's newer word or another member's
 * settling, over every read behind it, and a toast says why; one that did
 * not reach the service is let go, the item standing again. Only the agent
 * can open an item again, by posting under its key, so every way to close
 * asks first (`packages/panel/AGENTS.md`'s Confirms), the question going
 * with the surface it was asked on, with the item once it is no longer
 * open, and with the revision it was asked on once the agent changes it.
 */

/** What a close the act channel refused hears, as the service not answering. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/**
 * What the close is called in a menu and on a row's icon, which is its
 * tooltip too. Note that it is not called Close, because the bar of a side
 * panel or a window standing it full screen already holds a Close that only
 * puts the panel away.
 */
const CLOSE_ITEM_LABEL = "Resolve without answering";

/** What a toast says of a close the service did not take, by what had become of the item. */
const NOT_TAKEN = {
  CHANGED: "The agent changed this item before you resolved it.",
  SETTLED: "This item was already settled.",
} as const;

/** Closes an open item without an answer; nothing where a close of it is on its way. */
export type InboxCloser = (item: InboxItem) => void;

/** A close's key and the revision it was made for, kept so a press again on the same item goes under the same key. */
interface Attempt {
  readonly key: string;
  readonly revision: number;
}

/**
 * The Inbox's closes, sent through `act`; `onHeard` is told once a close
 * the agent hears was taken, since it may open the agent's turn.
 */
export function useInboxCloser({
  act,
  onHeard,
}: {
  act: ActHandle["act"];
  onHeard?: (() => void) | undefined;
}): InboxCloser {
  const settler = useInboxSettler();
  const writer = useDraftWriter();
  const toast = useToast();
  const attempts = useRef(new Map<string, Attempt>());
  const out = useRef(new Set<string>());
  const heard = useRef(onHeard);
  heard.current = onHeard;
  return useCallback(
    (item: InboxItem) => {
      if (item.status !== INBOX_STATUS.OPEN || out.current.has(item.id)) return;
      const was = attempts.current.get(item.id);
      const key = was?.revision === item.revision ? was.key : crypto.randomUUID();
      attempts.current.set(item.id, { key, revision: item.revision });
      out.current.add(item.id);
      const sent = settler.close(item);
      const say = (words: string) =>
        toast({ words, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
      void act(ACT_KIND.CODING_AGENTS_INBOX_CLOSE, {
        itemId: item.id,
        revision: item.revision,
        clientKey: key,
      })
        .catch(() => UNANSWERED)
        .then((answer) => {
          out.current.delete(item.id);
          if ("failure" in answer) {
            settler.refuse(sent);
            return say(messageFailureWords(answer.failure));
          }
          attempts.current.delete(item.id);
          // Note that the item as the service answered it stands over every read behind it, taken or not, so a read that lags shows neither the close undone nor the request the agent replaced.
          settler.take(sent, answer.item);
          if (!answer.taken) {
            return say(
              answer.item.status === INBOX_STATUS.OPEN ? NOT_TAKEN.CHANGED : NOT_TAKEN.SETTLED,
            );
          }
          // Note that only the answer drafted against the revision closed goes, since a message on the thread may have been begun while the close was out.
          writer.drop(
            (place) =>
              place.kind === DRAFT_PLACE.INBOX &&
              place.itemId === item.id &&
              place.revision === item.revision &&
              place.thread !== true,
          );
          if (item.needsReply) heard.current?.();
        });
    },
    [act, settler, toast, writer],
  );
}

/** What the close asks first: which item, and whether its agent is told now or reads it later. */
function closeQuestion(item: InboxItem): DialogQuestion {
  return {
    title: `Resolve “${cardTitle(item.title)}” without answering?`,
    body: item.needsReply
      ? "The agent is told you resolved it. Only the agent can open it again."
      : "The agent reads that you resolved it the next time it reads its inbox. Only the agent can open it again.",
    verb: "Resolve",
    running: "Resolving…",
  };
}

/** One item's close as a menu and an icon offer it, and the question it asks through, which the caller draws beside them. */
export interface InboxClose {
  /** The menu's item, and what the icon presses; none where the item cannot be closed. */
  readonly action: MenuAction | undefined;
  readonly dialog: React.JSX.Element;
}

/**
 * One item's close, asked first: offered while the item is open and a
 * closer is handed, which a surface that answers nothing, an archived
 * task's say, hands none of. The question goes once the surface is put
 * away or the item is open no longer.
 */
export function useInboxClose(
  item: InboxItem,
  closer: InboxCloser | undefined,
  surfaceOpen: boolean,
): InboxClose {
  const open = item.status === INBOX_STATUS.OPEN;
  // The revision the question was asked on, so the agent's change while it stands withdraws it rather than closing what the reader never saw.
  const [asked, setAsked] = useState(item.revision);
  const confirm = useConfirmDialog(
    { subject: open && item.revision === asked, surfaceOpen },
    () => {
      closer?.(item);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  );
  const ask = () => {
    setAsked(item.revision);
    confirm.ask();
  };
  return {
    action:
      closer === undefined || !open
        ? undefined
        : { label: CLOSE_ITEM_LABEL, icon: <CircleSlashIcon />, onSelect: ask },
    dialog: <ConfirmDialog confirm={confirm} question={closeQuestion(item)} />,
  };
}
