import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { INBOX_STATUS, type InboxItem, type InboxStatus } from "@repo/features/inbox-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  STATUS_TONE,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { useMutation } from "@tanstack/react-query";
import { Equal } from "effect";
import { useCallback, useRef, useState } from "react";
import { KEPT, type Kept, notKept, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { DRAFT_PLACE, EMPTY_DRAFT, useDraftWriter, withoutPicks } from "../composer-drafts.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { messageFailureWords } from "./agent-model.js";
import { cardTitle } from "./tool-call-model.js";

const unreached = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

const CLOSE_ITEM_LABEL = "Resolve without answering";

const NOT_TAKEN = {
  [INBOX_STATUS.OPEN]: "The agent changed this item before you resolved it.",
  [INBOX_STATUS.ANSWERED]: "This item was already answered.",
  [INBOX_STATUS.CLOSED]: "This item was already resolved.",
} as const satisfies Record<InboxStatus, string>;

interface CloseSaying {
  readonly quiet?: boolean | undefined;
}

export interface CloseNote {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
}

export type InboxCloser = (
  item: InboxItem,
  saying?: CloseSaying,
  note?: CloseNote,
) => Promise<Kept>;

interface Attempt {
  readonly key: string;
  readonly revision: number;
  readonly words: string;
}

export function useInboxCloser(): InboxCloser {
  const { mutateAsync: sendClose } = useMutation(actMutation(ACT_KIND.AGENTS_INBOX_CLOSE));
  const writer = useDraftWriter();
  const toast = useToast();
  const attempts = useRef(new Map<string, Attempt>());
  const out = useRef(new Set<string>());
  return useCallback(
    (item: InboxItem, saying?: CloseSaying, note?: CloseNote) => {
      if (out.current.has(item.id)) return Promise.resolve(KEPT);
      if (item.status !== INBOX_STATUS.OPEN) {
        return Promise.resolve(notKept(FAILURE_CONDITION.GONE));
      }
      const text = note?.text.trim() ?? "";
      const attachments = note?.attachments ?? [];
      const words = JSON.stringify([text, attachments]);
      const was = attempts.current.get(item.id);
      const key =
        was?.revision === item.revision && was.words === words ? was.key : crypto.randomUUID();
      attempts.current.set(item.id, { key, revision: item.revision, words });
      out.current.add(item.id);
      const pressed = writer.heldAt(
        (place) => place.kind === DRAFT_PLACE.INBOX && place.itemId === item.id,
      );
      const say = (words: string, cause: unknown) => {
        if (saying?.quiet !== true) {
          toast({
            replayUnmasked: true,
            words,
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: {
              surface: FAILURE_SURFACE.INBOX_CLOSE,
              cause,
              about: { inboxItemId: item.id, agentId: item.agentId },
            },
          });
        }
        return notKept(cause);
      };
      return sendClose({
        itemId: item.id,
        revision: item.revision,
        clientKey: key,
        ...(text === "" ? undefined : { text }),
        ...(attachments.length === 0 ? undefined : { attachments }),
      })
        .catch(unreached)
        .then((answer) => {
          out.current.delete(item.id);
          if ("failure" in answer) return say(messageFailureWords(answer.failure), answer);
          attempts.current.delete(item.id);
          if (!answer.taken) {
            return say(NOT_TAKEN[answer.item.status], { failure: answer.item.status });
          }
          if (pressed !== undefined) {
            writer.update(pressed.place, (now) =>
              now.text === pressed.text && Equal.equals(now.attachments, pressed.attachments)
                ? EMPTY_DRAFT
                : withoutPicks(now),
            );
          }
          return KEPT;
        });
    },
    [sendClose, toast, writer],
  );
}

function closeQuestion(item: InboxItem): DialogQuestion {
  return {
    title: `Resolve “${cardTitle(item.title)}” without answering?`,
    body: item.needsReply
      ? "The agent is told you resolved it. Only the agent can open it again."
      : "The agent reads that you resolved it the next time it reads its inbox. Only the agent can open it again.",
    verb: `Resolve ${TERM.INBOX_ITEM.one}`,
    running: "Resolving",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    titleReplayMasked: true,
  };
}

export function closeAllQuestion(items: readonly InboxItem[]): DialogQuestion {
  const [only] = items;
  if (items.length === 1 && only !== undefined) return closeQuestion(only);
  return {
    title: `Resolve ${countWords(items.length, TERM.INBOX_ITEM)} without answering?`,
    body: "Their agents are told. Only an item's agent can open it again.",
    verb: `Resolve ${TERM.INBOX_ITEM.many}`,
    running: "Resolving",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
  };
}

export function closedNote(landed: number, refused: number): string {
  return landed === 0
    ? `Could not resolve ${countWords(refused, TERM.INBOX_ITEM)}`
    : `${countWords(landed, TERM.INBOX_ITEM)} resolved, ${refused} could not be`;
}

interface InboxCloseAsk {
  readonly ask: (item: InboxItem) => void;
  readonly dialog: React.JSX.Element;
}

export function useInboxCloseAsk(
  closer: InboxCloser | undefined,
  surfaceOpen: boolean,
  current: (itemId: string) => InboxItem | undefined,
): InboxCloseAsk {
  const [asked, setAsked] = useState<InboxItem | undefined>(undefined);
  const now = asked === undefined ? undefined : current(asked.id);
  const standing =
    now !== undefined && now.status === INBOX_STATUS.OPEN && now.revision === asked?.revision;
  const confirm = useConfirmDialog(
    { subject: standing, surfaceOpen },
    neverBusyAct(() => {
      if (now !== undefined) void closer?.(now);
    }),
    confirmFailure(FAILURE_SURFACE.INBOX_CLOSE),
  );
  const { ask: confirmAsk } = confirm;
  const ask = useCallback(
    (item: InboxItem) => {
      setAsked(item);
      confirmAsk();
    },
    [confirmAsk],
  );
  return {
    ask,
    dialog: (
      <ConfirmDialog
        open
        confirm={confirm}
        question={closeAllQuestion(asked === undefined ? [] : [asked])}
        restoreTo={nextRowOrHead}
      />
    ),
  };
}

export function closeAction(
  item: InboxItem,
  ask: ((item: InboxItem) => void) | undefined,
): MenuAction | undefined {
  return ask === undefined || item.status !== INBOX_STATUS.OPEN
    ? undefined
    : { label: CLOSE_ITEM_LABEL, icon: <GLYPH.CLOSE />, onSelect: () => ask(item) };
}

export interface InboxClose {
  readonly action: MenuAction | undefined;
  readonly ask: ((item: InboxItem) => void) | undefined;
  readonly dialog: React.JSX.Element;
}

export function useInboxClose(
  item: InboxItem,
  closer: InboxCloser | undefined,
  surfaceOpen: boolean,
): InboxClose {
  const { ask, dialog } = useInboxCloseAsk(closer, surfaceOpen, (itemId) =>
    itemId === item.id ? item : undefined,
  );
  const handed = closer === undefined ? undefined : ask;
  return { action: closeAction(item, handed), ask: handed, dialog };
}
