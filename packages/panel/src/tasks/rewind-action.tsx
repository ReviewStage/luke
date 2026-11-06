import {
  AGENT_SENDER,
  type AgentAttachment,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { andList, countWords, type Noun } from "@repo/features/words";
import { CONFIRM_LOSS, ConfirmDialog, type DialogQuestion, useConfirmDialog } from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { MESSAGE_ROLE } from "@repo/wire";
import { createContext, type ReactNode, useContext } from "react";
import { MessageAction } from "../ai-elements/message.js";
import { confirmFailure } from "../failure-report.js";
import type { EditComposerDoors } from "./edit-composer.js";

export const REWIND_ACTION = {
  EDIT: "edit",
  REVERT: "revert",
} as const;

export type RewindAction = (typeof REWIND_ACTION)[keyof typeof REWIND_ACTION];

const REWIND_WORDS = {
  EDIT: "Edit",
  REVERT: "Revert to here",
} as const;

const MESSAGE: Noun = { one: "message", many: "messages" };

function revertQuestion(takes: string | undefined): DialogQuestion {
  return {
    title: "Revert to this message?",
    body: `Everything after it${takes === undefined ? "" : `, including ${takes},`} will be removed from the transcript, and the agent stopped if it is working. Changes the agent made to its files stay as they are.`,
    verb: "Revert to message",
    running: "Reverting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    bodyReplayMasked: takes !== undefined,
  };
}

interface RewindDoors {
  readonly editing: string | undefined;
  readonly onEdit: (messageId: string) => void;
  readonly onCancelEdit: () => void;
  readonly onSendEdit: (
    messageId: string,
    words: string,
    attachments: readonly AgentAttachment[],
  ) => void;
  readonly editor: () => Omit<EditComposerDoors, "cuts" | "onCancel" | "onSend">;
  readonly onRevert: (lineId: string) => void;
  readonly revertsAt: ReadonlyMap<string, string>;
  readonly editable: ReadonlySet<string>;
  readonly followed: ReadonlySet<string>;
  readonly revertTakes: ReadonlyMap<string, string>;
  readonly editTakes: ReadonlyMap<string, string>;
}

const RewindContext = createContext<RewindDoors | undefined>(undefined);

const PERSON_SENDERS: ReadonlySet<string> = new Set([AGENT_SENDER.MEMBER, AGENT_SENDER.FORMER]);

function writtenByPerson(message: AgentTranscriptMessage): boolean {
  const sender = message.sentBy;
  if (sender === undefined) return true;
  return sender.agent !== true && (sender.kind === undefined || PERSON_SENDERS.has(sender.kind));
}

type Takes = { userId: string | undefined; name: string; count: number }[];

function writtenByOther(message: AgentTranscriptMessage, readerId: string | undefined): boolean {
  const sender = message.sentBy;
  if (sender === undefined || !writtenByPerson(message)) return false;
  return sender.userId === undefined || (readerId !== undefined && sender.userId !== readerId);
}

function tally(takes: Takes, sender: NonNullable<AgentTranscriptMessage["sentBy"]>): void {
  const found = takes.find((each) => each.userId === sender.userId && each.name === sender.name);
  if (found === undefined) takes.unshift({ userId: sender.userId, name: sender.name, count: 1 });
  else found.count += 1;
}

function takesWords(takes: Takes): string | undefined {
  if (takes.length === 0) return undefined;
  return andList(takes.map((each) => `${countWords(each.count, MESSAGE)} from ${each.name}`));
}

export function rewindPoints(
  messages: readonly AgentTranscriptMessage[],
  pending: boolean,
  readerId: string | undefined,
  going: ReadonlySet<string> = new Set(),
): {
  readonly editable: ReadonlySet<string>;
  readonly revertsAt: ReadonlyMap<string, string>;
  readonly followed: ReadonlySet<string>;
  readonly revertTakes: ReadonlyMap<string, string>;
  readonly editTakes: ReadonlyMap<string, string>;
} {
  const editable = new Set<string>();
  const revertsAt = new Map<string, string>();
  const revertTakes = new Map<string, string>();
  const editTakes = new Map<string, string>();
  const followed = new Set(
    (pending ? messages : messages.slice(0, -1)).map((message) => message.id),
  );
  const takenFrom = new Map<string, string>();
  const takes: Takes = [];
  let next: string | undefined;
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at];
    if (message === undefined) continue;
    if (message.role !== MESSAGE_ROLE.USER) {
      if (next === undefined) continue;
      revertsAt.set(message.id, next);
      const dropped = takenFrom.get(next);
      if (dropped !== undefined) revertTakes.set(message.id, dropped);
      continue;
    }
    const opens = message.arrivedIn === undefined;
    const answered = message.clientId === undefined || !going.has(message.clientId);
    if (opens && answered && writtenByPerson(message)) {
      editable.add(message.id);
      const after = takesWords(takes);
      if (after !== undefined) editTakes.set(message.id, after);
    }
    if (message.sentBy !== undefined && writtenByOther(message, readerId)) {
      tally(takes, message.sentBy);
    }
    if (!opens) continue;
    const from = takesWords(takes);
    if (from !== undefined) takenFrom.set(message.id, from);
    next = answered ? message.id : undefined;
  }
  return { editable, revertsAt, followed, revertTakes, editTakes };
}

export function RewindProvider({
  value,
  children,
}: {
  value: RewindDoors | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return <RewindContext.Provider value={value}>{children}</RewindContext.Provider>;
}

export function EditMessageAction({ messageId }: { messageId: string }): ReactNode {
  const doors = useContext(RewindContext);
  if (doors === undefined || !doors.editable.has(messageId)) return null;
  return (
    <MessageAction
      label={REWIND_WORDS.EDIT}
      tooltip={REWIND_WORDS.EDIT}
      onClick={() => doors.onEdit(messageId)}
    >
      <GLYPH.RENAME />
    </MessageAction>
  );
}

export function RevertMessageAction({ messageId }: { messageId: string }): ReactNode {
  const doors = useContext(RewindContext);
  const lineId = doors?.revertsAt.get(messageId);
  const confirm = useConfirmDialog(
    { subject: lineId !== undefined, surfaceOpen: true },
    neverBusyAct(() => {
      if (lineId !== undefined) doors?.onRevert(lineId);
    }),
    confirmFailure(FAILURE_SURFACE.AGENT_REWIND),
  );
  if (doors === undefined || lineId === undefined) return null;
  return (
    <>
      <MessageAction
        label={REWIND_WORDS.REVERT}
        tooltip={REWIND_WORDS.REVERT}
        onClick={confirm.ask}
      >
        <GLYPH.GO_BACK />
      </MessageAction>
      <ConfirmDialog
        open
        confirm={confirm}
        question={revertQuestion(doors?.revertTakes.get(messageId))}
      />
    </>
  );
}

export function useMessageEdit(messageId: string): EditComposerDoors | undefined {
  const doors = useContext(RewindContext);
  if (doors === undefined || doors.editing !== messageId) return undefined;
  return {
    ...doors.editor(),
    onCancel: doors.onCancelEdit,
    cuts: doors.followed.has(messageId),
    takes: doors.editTakes.get(messageId),
    onSend: (words, attachments) => doors.onSendEdit(messageId, words, attachments),
  };
}
