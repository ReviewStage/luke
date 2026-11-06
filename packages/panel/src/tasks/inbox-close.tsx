import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
} from "@repo/features/agent-view";
import { INBOX_STATUS, type InboxItem, type InboxStatus } from "@repo/features/inbox-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { TOAST_HOLD, undoToast, useToast } from "../toast.js";
import { messageFailureWords } from "./agent-model.js";
import { cardTitle } from "./tool-call-model.js";

/**
 * inbox-close.tsx -- open Inbox items resolved without an answer, at once and with Undo, from every place that offers it: an item's menus, its question card, the list's head, a chosen row's menu, and E.
 *
 * Resolve is one act wherever it is pressed: it asks nothing, the items
 * read resolved at once in every read the window draws, and one toast
 * offers Undo for its hold (`packages/panel/AGENTS.md`'s Confirms). Its
 * agent must not hear of a resolve the reader takes back, so each close
 * goes to the host held (`AGENTS_INBOX_CLOSE`'s `held`): the host draws it
 * and keeps it from the service until the toast is gone, when it is let
 * go as sent, or until Undo, when it is let go as taken back and the item
 * stands again as it was (`AGENTS_INBOX_CLOSE_RELEASE`). A window leaving
 * while its toast stands lets its resolves go as sent, so a resolve the
 * reader left standing is never dropped; the host sends any it still holds
 * once it quits, or once a while passes with no word from its window.
 *
 * Each close goes under a key of its own, at the revision the item was
 * pressed on, so an agent's change since is never resolved unseen: the
 * service does not take it, the item lands as the service answered it, and
 * a toast says why. One the service did not answer is taken back.
 */

/** What a close the act channel refused hears, as the service not answering, with the error beneath. */
const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/**
 * What the act is called wherever it is offered. Note that it is not called
 * Close, because the bar of a side panel or a window standing it full screen
 * already holds a Close that only puts the panel away, and its mark is never
 * Close's ×.
 */
export const RESOLVE = "Resolve";

/** What a toast says of a close the service did not take, by what had become of the item: still open, the agent having changed it; answered; or resolved. */
const NOT_TAKEN = {
  [INBOX_STATUS.OPEN]: "The agent changed this item before you resolved it.",
  [INBOX_STATUS.ANSWERED]: "This item was already answered.",
  [INBOX_STATUS.CLOSED]: "This item was already resolved.",
} as const satisfies Record<InboxStatus, string>;

/** What a toast says of an Undo that came after its host had sent a resolve on, as one held past the host's bound is. */
const TOO_LATE = "Too late to undo: the agent was already told.";

/** What a toast says of an Undo that did not reach the host, which may still hold the resolve, and what its action that asks again is called. */
const UNDO_UNREACHED = {
  WORDS: "Could not undo resolving. The agent is told in a minute unless you try again.",
  RETRY: "Try again",
} as const;

/** How one held close answered being let go: still held, and let go now; sent on already; or not reached, so it may still be held. */
const RELEASED = {
  HELD: "held",
  LATE: "late",
  UNREACHED: "unreached",
} as const;

type Released = (typeof RELEASED)[keyof typeof RELEASED];

/** What the Undo toast says: the one item by its title, or how many. */
function resolvedNote(items: readonly InboxItem[]): string {
  const [only] = items;
  return items.length === 1 && only !== undefined
    ? `Resolved “${cardTitle(only.title)}”`
    : `${countWords(items.length, TERM.INBOX_ITEM)} resolved`;
}

/** What one toast says of a resolve of several items the service refused some of: how many it took, and how many not. */
export function closedNote(landed: number, refused: number): string {
  return landed === 0
    ? `Could not resolve ${countWords(refused, TERM.INBOX_ITEM)}`
    : `${countWords(landed, TERM.INBOX_ITEM)} resolved, ${refused} could not be`;
}

/** Why the service did not take one close, in a toast's words, or none where it took it. */
function refusalWords(
  answer: AgentInboxAnsweredView | { readonly failure: AgentCallFailure },
): string | undefined {
  if ("failure" in answer) return messageFailureWords(answer.failure);
  return answer.taken ? undefined : NOT_TAKEN[answer.item.status];
}

/** Resolves the open items given without an answer, at once, with Undo; one already on its way, or no longer open, is passed over. */
export type InboxResolver = (items: readonly InboxItem[]) => void;

/** Lets each resolve this window still holds for its Undo go as sent; each lets itself out of the set as it goes. */
const heldHere = new Set<() => void>();

/** Whether the window's leaving is heard yet, which is heard once for the window's life. */
let leavingHeard = false;

/**
 * Lets every resolve the window holds go as sent once it leaves, heard once
 * for the window's life rather than the Inbox's, since an Undo toast outlives
 * the Inbox it was pressed in. Note that a page kept in the back-forward
 * cache has not left, because it may come back with its toast and its Undo
 * still standing.
 */
function hearLeaving(): void {
  if (leavingHeard) return;
  leavingHeard = true;
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    for (const letGo of [...heldHere]) letGo();
  });
}

/** The Inbox's resolves, each held by the host until its Undo toast is gone. */
export function useInboxResolver(): InboxResolver {
  const { mutateAsync: sendClose } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_CLOSE));
  const { mutateAsync: release } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_CLOSE_RELEASE));
  const toast = useToast();
  const out = useRef(new Set<string>());
  // Note that a window leaving takes its toasts with it, so whatever they still held goes as sent rather than standing open again.
  useEffect(hearLeaving, []);
  return useCallback(
    (items: readonly InboxItem[]) => {
      const open = items.filter(
        (item) => item.status === INBOX_STATUS.OPEN && !out.current.has(item.id),
      );
      if (open.length === 0) return;
      const keys = open.map(() => crypto.randomUUID());
      for (const item of open) out.current.add(item.id);
      const answered = Promise.all(
        open.map((item, at) =>
          sendClose({
            itemId: item.id,
            revision: item.revision,
            clientKey: keys[at] ?? "",
            held: true,
          }).catch(unreached),
        ),
      );
      const releaseAll = (send: boolean, among: readonly string[] = keys) =>
        Promise.all(
          among.map((clientKey) =>
            release({ clientKey, send }).then(
              (found): Released => (found.held ? RELEASED.HELD : RELEASED.LATE),
              (): Released => RELEASED.UNREACHED,
            ),
          ),
        );
      let undone = false;
      const letGo = () => {
        if (!heldHere.delete(letGo)) return;
        void releaseAll(true);
      };
      heldHere.add(letGo);
      // Note that an Undo the host did not hear may still be held there, so its toast asks again for those alone; one the host had sent on already says so.
      const takeBack = (among: readonly string[]) =>
        void releaseAll(false, among).then((released) => {
          const unreached = among.filter((_, at) => released[at] === RELEASED.UNREACHED);
          if (unreached.length > 0) {
            toast({
              replayUnmasked: true,
              words: UNDO_UNREACHED.WORDS,
              tone: STATUS_TONE.DANGER,
              failure: { surface: FAILURE_SURFACE.INBOX_CLOSE, cause: UNDO_UNREACHED.WORDS },
              action: {
                label: UNDO_UNREACHED.RETRY,
                replayUnmasked: true,
                onPress: () => takeBack(unreached),
              },
              hold: TOAST_HOLD.FAILED,
            });
            return;
          }
          if (!released.includes(RELEASED.LATE)) return;
          toast({
            replayUnmasked: true,
            words: TOO_LATE,
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: { surface: FAILURE_SURFACE.INBOX_CLOSE, cause: TOO_LATE, refused: true },
          });
        });
      const undo = () => {
        if (!heldHere.delete(letGo)) return;
        undone = true;
        takeBack(keys);
      };
      toast({
        ...undoToast(resolvedNote(open), undo),
        glyph: () => <GLYPH.RESOLVED />,
        // Note that one item's toast quotes its title, which a screen recording masks.
        replayUnmasked: open.length > 1,
        onGone: letGo,
      });
      void answered.then((answers) => {
        for (const item of open) out.current.delete(item.id);
        // Note that a resolve taken back answers nothing worth saying, since the reader undid it.
        if (undone) return;
        const refused = answers.flatMap((answer, at) => {
          const words = refusalWords(answer);
          const item = open[at];
          return words === undefined || item === undefined ? [] : [{ words, answer, item }];
        });
        const [first] = refused;
        if (first === undefined) return;
        toast({
          replayUnmasked: true,
          words:
            open.length === 1
              ? first.words
              : closedNote(open.length - refused.length, refused.length),
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: {
            surface: FAILURE_SURFACE.INBOX_CLOSE,
            cause: first.answer,
            about: { inboxItemId: first.item.id, agentId: first.item.agentId },
          },
        });
      });
    },
    [sendClose, release, toast],
  );
}

/**
 * The items' resolve as a menu offers it: while one of them is open and the
 * surface hands a resolver, which one that answers nothing, an archived
 * task's say, hands none of. Where `keyed`, it names E, which resolves the
 * chosen items there.
 */
export function resolveAction(
  items: readonly InboxItem[],
  onResolve: InboxResolver | undefined,
  keyed = false,
): MenuAction | undefined {
  return onResolve === undefined || !items.some((item) => item.status === INBOX_STATUS.OPEN)
    ? undefined
    : {
        label: RESOLVE,
        icon: <GLYPH.RESOLVED />,
        onSelect: () => onResolve(items),
        ...(keyed ? { command: APP_COMMAND.RESOLVE } : undefined),
      };
}
