import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import {
  type AgentAttachment,
  type AgentPayer,
  type AgentTranscriptMessage,
  hasWordsOrFiles,
} from "@repo/features/agent-wire";
import { type Failure, remedyLabel } from "@repo/features/failure-remedy";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { sentLineId } from "@repo/wire/host-ids";
import { useEffect, useRef, useState } from "react";
import type { AgentActAnswer } from "../act.js";
import { DRAFT_PLACE, type Draft, EMPTY_DRAFT, useDraft } from "../composer-drafts.js";
import { useSendQueue } from "../send-queue.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import {
  closesComposer,
  heldSentLines,
  messageFailureNote,
  type RefusedCall,
  SENT_LINE_STATE,
  type SentLine,
  unreadSentLines,
} from "./agent-model.js";
import { type FailedLine, failedLinesAtom, failedLinesOf } from "./failed-lines.js";

export type MessageSender = (
  agentId: string,
  text: string,
  clientKey: string,
  attachments: readonly AgentAttachment[],
) => Promise<AgentActAnswer>;

export type MessageRewinder = (agentId: string, messageId: string) => Promise<AgentActAnswer>;

export type ComposerNote = Failure & { readonly cause?: unknown };

export interface AgentComposerControl {
  draft: string;
  setDraft: (text: string) => void;
  attachments: readonly AgentAttachment[];
  setAttachments: (next: (held: readonly AgentAttachment[]) => readonly AgentAttachment[]) => void;
  sending: boolean;
  note: ComposerNote | undefined;
  closed: string | undefined;
  send: () => void;
  retry: () => void;
  sent: readonly SentLine[];
}

interface Held {
  agentId: string;
  editing: string | undefined;
  reverting: string | undefined;
  rewoundAt: number | undefined;
  cut: ReadonlySet<string> | undefined;
  remedied: { readonly lineId: string; readonly note: ComposerNote } | undefined;
  revertFailed: { readonly messageId: string; readonly note: ComposerNote } | undefined;
  closed: string | undefined;
  behind: Draft;
  sent: readonly SentLine[];
}

function fresh(agentId: string, failed: readonly FailedLine[]): Held {
  return {
    agentId,
    editing: undefined,
    reverting: undefined,
    rewoundAt: undefined,
    cut: undefined,
    remedied: undefined,
    revertFailed: undefined,
    closed: undefined,
    behind: EMPTY_DRAFT,
    sent: failed.map((each) => each.line),
  };
}

function cutFrom(
  messages: readonly AgentTranscriptMessage[],
  messageId: string,
): ReadonlySet<string> | undefined {
  const at = messages.findIndex((message) => message.id === messageId);
  return at === -1 ? undefined : new Set(messages.slice(at).map((message) => message.id));
}

function carried(sent: readonly SentLine[], behind: Draft): Draft {
  const lines = sent.filter((line) => line.state !== SENT_LINE_STATE.PENDING);
  return {
    ...EMPTY_DRAFT,
    text: [...lines.map((line) => line.text), behind.text]
      .filter((text) => text !== "")
      .join("\n\n"),
    attachments: [...lines.flatMap((line) => line.attachments), ...behind.attachments],
  };
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

const NOT_DELIVERED_TOAST = "Message not delivered";
const OPEN_WORD = "Open";

function marked(
  sent: readonly SentLine[],
  id: string,
  state: SentLine["state"],
): readonly SentLine[] {
  return sent.map((each) => (each.id === id ? { ...each, state } : each));
}

function settled(sent: readonly SentLine[], id: string): readonly SentLine[] {
  return marked(sent, id, SENT_LINE_STATE.UNDELIVERED).map((each) =>
    each.state === SENT_LINE_STATE.FAILED ? { ...each, state: SENT_LINE_STATE.UNDELIVERED } : each,
  );
}

export interface HeldComposer extends AgentComposerControl {
  readonly unsent: {
    readonly words: string;
    readonly attachments: readonly AgentAttachment[];
  };
  readonly retryLine: (id: string) => void;
  readonly dropLine: (id: string) => void;
  readonly takeBackLine: (id: string) => void;
  readonly failedNotes: ReadonlyMap<string, ComposerNote>;
  readonly sendWords: (text: string) => void;
  readonly editing: string | undefined;
  readonly edit: (messageId: string) => void;
  readonly dropEdit: () => void;
  readonly sendEdit: (
    messageId: string,
    words: string,
    attachments: readonly AgentAttachment[],
  ) => void;
  readonly rewindOut: boolean;
  readonly rewinding: boolean;
  readonly rewoundAt: number | undefined;
  readonly revert: (messageId: string) => void;
  readonly cut: ReadonlySet<string> | undefined;
  readonly going: ReadonlySet<string>;
  readonly sendsSettled: () => Promise<void>;
}

export function useAgentComposer(input: {
  agentId: string;
  taskId: string | null;
  messages: readonly AgentTranscriptMessage[];
  running?: boolean | undefined;
  send: MessageSender;
  rewind?: MessageRewinder | undefined;
  payer?: AgentPayer | undefined;
  starter?: string | undefined;
  shown?: boolean | undefined;
  onOpen?: (() => void) | undefined;
}): HeldComposer {
  const { agentId, messages } = input;
  const kept = useDraft({ kind: DRAFT_PLACE.AGENT, planId: input.taskId, agentId });
  const failedLines = useAtomValue(failedLinesAtom);
  const keepFailed = useAtomSet(failedLinesAtom);
  const [held, setHeld] = useState<Held>(() => fresh(agentId, failedLinesOf(failedLines, agentId)));
  if (held.agentId !== agentId) setHeld(fresh(agentId, failedLinesOf(failedLines, agentId)));
  const heldNow = useRef(held);
  heldNow.current = held;
  const latest = useRef(input);
  latest.current = input;
  const queue = useSendQueue();
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const sent = unreadSentLines(held.sent, messages);
  const standing = heldSentLines(held.sent, messages);
  useEffect(() => {
    if (standing.length === held.sent.length) return;
    setHeld((was) => ({ ...was, sent: heldSentLines(was.sent, latest.current.messages) }));
  }, [standing.length, held.sent.length]);

  const cutStands = held.cut !== undefined && messages.some((message) => held.cut?.has(message.id));
  useEffect(() => {
    if (held.cut === undefined || cutStands) return;
    setHeld((was) => ({ ...was, cut: undefined }));
  }, [held.cut, cutStands]);

  const ours = (change: (was: Held) => Held) =>
    setHeld((was) => (was.agentId === agentId ? change(was) : was));

  const { update } = kept;
  const rewindTo = (agentId: string, messageId: string): Promise<AgentActAnswer> =>
    (latest.current.rewind?.(agentId, messageId) ?? Promise.resolve(UNANSWERED)).catch(
      (): AgentActAnswer => UNANSWERED,
    );
  const deliver = (line: SentLine) => {
    const { taskId } = latest.current;
    queue.after(agentId, async () => {
      const now = heldNow.current;
      if (now.agentId === agentId && now.closed !== undefined) {
        const sent = marked(now.sent, line.id, SENT_LINE_STATE.UNDELIVERED);
        update(() => carried(sent, now.behind));
        ours((was) => ({ ...was, sent: marked(was.sent, line.id, SENT_LINE_STATE.UNDELIVERED) }));
        return;
      }
      const rewinds = line.rewound === true ? undefined : line.rewinds;
      if (rewinds !== undefined) ours((was) => ({ ...was, reverting: rewinds }));
      const rewound = rewinds === undefined ? undefined : await rewindTo(agentId, rewinds);
      if (rewinds !== undefined) ours((was) => ({ ...was, reverting: undefined }));
      const answer =
        rewound !== undefined && "failure" in rewound
          ? rewound
          : await latest.current
              .send(agentId, line.text, line.clientKey, line.attachments)
              .catch((): AgentAgentAnswer => UNANSWERED);
      if ("failure" in answer && !closesComposer(answer.failure)) {
        keepFailedLine(line, answer, rewound !== undefined && !("failure" in rewound), taskId);
      }
      if ("failure" in answer) sayWhereAway(answer);
      if (latest.current.agentId !== agentId) return;
      if (rewound !== undefined && "failure" in rewound)
        ours((was) => ({ ...was, cut: undefined }));
      if (!("failure" in answer)) {
        ours((was) => ({
          ...was,
          sent: heldSentLines(
            was.sent.map((each) => (each.id === line.id ? { ...each, taken: true } : each)),
            latest.current.messages,
          ),
        }));
        return;
      }
      if (!closesComposer(answer.failure)) return;
      if (!heldNow.current.sent.some((each) => each.id === line.id)) return;
      const note: ComposerNote = {
        ...messageFailureNote(
          answer,
          latest.current.taskId,
          latest.current.payer,
          latest.current.starter,
        ),
        cause: answer,
      };
      const sent = settled(heldNow.current.sent, line.id);
      let behind: Draft = EMPTY_DRAFT;
      update((draft) => {
        behind = draft;
        return carried(sent, draft);
      });
      keepFailed((all) => all.filter((failed) => failed.agentId !== agentId));
      ours((was) => ({
        ...was,
        closed: note.text,
        behind,
        sent: settled(was.sent, line.id),
      }));
    });
  };

  const keepFailedLine = (
    line: SentLine,
    answer: RefusedCall,
    rewoundNow: boolean,
    taskId: string | null,
  ) => {
    const at = latest.current;
    const note: ComposerNote = {
      ...messageFailureNote(answer, taskId, at.payer, at.starter),
      cause: answer,
    };
    const failed: SentLine = {
      ...line,
      state: SENT_LINE_STATE.FAILED,
      ...(rewoundNow ? { rewound: true } : {}),
    };
    keepFailed((all) => [
      ...all.filter((each) => each.line.id !== line.id),
      { agentId, taskId, line: failed, note },
    ]);
    const remedied = remedyLabel(note) === undefined ? undefined : { lineId: line.id, note };
    ours((was) => ({
      ...was,
      remedied: remedied ?? (was.remedied?.lineId === line.id ? undefined : was.remedied),
      sent: was.sent.some((each) => each.id === line.id)
        ? was.sent.map((each) => (each.id === line.id ? failed : each))
        : [...was.sent, failed],
    }));
  };

  const sayWhereAway = (answer: RefusedCall) => {
    const at = latest.current;
    if (mounted.current && at.agentId === agentId && at.shown !== false) return;
    const { onOpen } = at;
    toast({
      replayUnmasked: true,
      words: NOT_DELIVERED_TOAST,
      tone: STATUS_TONE.DANGER,
      failure: { surface: FAILURE_SURFACE.AGENT_SEND, cause: answer, about: { agentId } },
      ...(onOpen === undefined
        ? { hold: TOAST_HOLD.FAILED }
        : { action: { label: OPEN_WORD, onPress: onOpen, replayUnmasked: true } }),
    });
  };

  const sendLine = (text: string, attachments: readonly AgentAttachment[], clientKey: string) => {
    const line: SentLine = {
      id: sentLineId(clientKey),
      clientKey,
      text,
      attachments,
      steers: input.running === true,
      sentAt: Date.now(),
      state: SENT_LINE_STATE.PENDING,
    };
    setHeld((was) => ({ ...was, sent: [...was.sent, line] }));
    deliver(line);
  };

  const sendDraft = (clientKey: string = crypto.randomUUID()) => {
    const text = kept.draft.text.trim();
    const { attachments } = kept.draft;
    if (!hasWordsOrFiles(text, attachments) || held.closed !== undefined) return;
    update(() => EMPTY_DRAFT);
    sendLine(text, attachments, clientKey);
  };

  const sendEdit = (messageId: string, words: string, attachments: readonly AgentAttachment[]) => {
    const text = words.trim();
    if (!hasWordsOrFiles(text, attachments) || held.closed !== undefined) return;
    const clientKey = crypto.randomUUID();
    const rewoundAt = Date.now();
    const line: SentLine = {
      id: sentLineId(clientKey),
      clientKey,
      text,
      attachments,
      steers: false,
      sentAt: rewoundAt,
      state: SENT_LINE_STATE.PENDING,
      rewinds: messageId,
    };
    setHeld((was) => ({
      ...was,
      revertFailed: undefined,
      editing: undefined,
      rewoundAt,
      cut: cutFrom(messages, messageId),
      sent: [...was.sent, line],
    }));
    deliver(line);
  };

  const revert = (messageId: string) => {
    const rewoundAt = Date.now();
    setHeld((was) => ({
      ...was,
      revertFailed: undefined,
      editing: undefined,
      reverting: messageId,
      rewoundAt,
      cut: cutFrom(messages, messageId),
    }));
    queue.after(agentId, async () => {
      const answer = await rewindTo(agentId, messageId);
      if (latest.current.agentId !== agentId) return;
      if (!("failure" in answer)) {
        ours((was) => ({ ...was, reverting: undefined }));
        return;
      }
      const note: ComposerNote = {
        ...messageFailureNote(answer, latest.current.taskId, latest.current.payer),
        cause: answer,
      };
      ours((was) => ({
        ...was,
        cut: undefined,
        reverting: undefined,
        revertFailed: { messageId, note },
      }));
    });
  };

  const takeFailed = (id: string): SentLine | undefined => {
    const line = held.sent.find((each) => each.id === id);
    if (line?.state !== SENT_LINE_STATE.FAILED || held.closed !== undefined) return undefined;
    keepFailed((all) => all.filter((failed) => failed.line.id !== id));
    setHeld((was) => (was.remedied?.lineId === id ? { ...was, remedied: undefined } : was));
    return line;
  };

  const resend = (id: string) => {
    const line = takeFailed(id);
    if (line === undefined) return;
    const again = { ...line, sentAt: Date.now(), state: SENT_LINE_STATE.PENDING };
    setHeld((was) => ({ ...was, sent: [...was.sent.filter((each) => each.id !== id), again] }));
    deliver(again);
  };

  const dropLine = (id: string) => {
    if (takeFailed(id) === undefined) return;
    setHeld((was) => ({ ...was, sent: was.sent.filter((each) => each.id !== id) }));
  };

  const takeBackLine = (id: string) => {
    const line = takeFailed(id);
    if (line === undefined) return;
    setHeld((was) => ({ ...was, sent: was.sent.filter((each) => each.id !== id) }));
    kept.update((draft) => ({
      ...draft,
      text: [line.text, draft.text].filter((text) => text !== "").join("\n\n"),
      attachments: [...line.attachments, ...draft.attachments],
    }));
  };

  const shown = held.closed === undefined ? kept.draft : EMPTY_DRAFT;
  return {
    draft: shown.text,
    setDraft: (text) => kept.update((was) => ({ ...was, text })),
    attachments: shown.attachments,
    setAttachments: (next) =>
      kept.update((was) => ({ ...was, attachments: next(was.attachments) })),
    sending: false,
    note: held.closed === undefined ? (held.revertFailed?.note ?? held.remedied?.note) : undefined,
    closed: held.closed,
    send: () => sendDraft(),
    retry: () => {
      const { revertFailed, remedied } = held;
      if (revertFailed !== undefined) return revert(revertFailed.messageId);
      if (remedied !== undefined) resend(remedied.lineId);
    },
    retryLine: resend,
    dropLine,
    takeBackLine,
    failedNotes: new Map(
      failedLinesOf(failedLines, agentId).map((failed) => [failed.line.id, failed.note]),
    ),
    sendWords: (text) => {
      if (text.trim() === "" || held.closed !== undefined) return;
      sendLine(text.trim(), [], crypto.randomUUID());
    },
    sent,
    unsent: { words: kept.draft.text, attachments: kept.draft.attachments },
    editing: held.editing,
    edit: (messageId) => setHeld((was) => ({ ...was, editing: messageId })),
    dropEdit: () => setHeld((was) => ({ ...was, editing: undefined })),
    sendEdit,
    rewindOut: held.reverting !== undefined,
    rewoundAt: held.rewoundAt,
    rewinding:
      held.reverting !== undefined ||
      held.sent.some(
        (line) => line.rewinds !== undefined && line.state === SENT_LINE_STATE.PENDING,
      ),
    revert,
    cut: held.cut,
    going: new Set(held.sent.filter((line) => line.taken !== true).map((line) => line.id)),
    sendsSettled: () => queue.settled(latest.current.agentId),
  };
}
