import {
  CODING_AGENT_SENDER,
  type CodingAgentAttachment,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import { andList, countWords, type Noun } from "@luke/features/words";
import { CONFIRM_LOSS, ConfirmDialog, type DialogQuestion, useConfirmDialog } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import { ACTION_RESULT_STATUS, MESSAGE_ROLE } from "@luke/wire";
import { createContext, type ReactNode, useContext } from "react";
import { MessageAction } from "../ai-elements/message.js";
import type { EditComposerDoors } from "./edit-composer.js";

/**
 * rewind-action.tsx -- a coding agent taken back to an earlier point of its transcript: a line of the developer's Edit, which writes it again where it stands, and a reply's Revert to here.
 *
 * An agent's tab hands its messages what a rewind takes (`RewindProvider`):
 * Edit opens a line for writing again in its own place, in the agent's own
 * message box (`edit-composer.tsx`), leaving the foot's box as it is, and its Send takes the agent
 * back to just before it, so the new words go in its place, asked first where
 * anything follows the line, since what it drops is gone; Revert to here, asked
 * first for the same reason, takes the agent back to just after a
 * reply, dropping the developer's next line and everything after it. Only a
 * line that opened a turn is written again, and a reply is reverted to only
 * where such a line follows it, since a line a turn took in while it ran sits
 * inside that turn's work. Only the conversation goes back: the agent's
 * checkout stays as it is. A worker's tab hands none.
 */

/** Which rewind a message offers: a line of the developer's its Edit, a reply its Revert to here. */
export const REWIND_ACTION = {
  EDIT: "edit",
  REVERT: "revert",
} as const;

export type RewindAction = (typeof REWIND_ACTION)[keyof typeof REWIND_ACTION];

/** What the actions say. */
const REWIND_WORDS = {
  EDIT: "Edit",
  REVERT: "Revert to here",
} as const;

/** What a rewind counts the dropped messages of another member's in. */
const MESSAGE: Noun = { one: "message", many: "messages" };

/**
 * What Revert to here asks before it drops anything. Where `takes` names
 * another member's messages among those dropped, the body says so.
 */
function revertQuestion(takes: string | undefined): DialogQuestion {
  return {
    title: "Revert to this message?",
    body: `Everything after it${takes === undefined ? "" : `, including ${takes},`} will be removed from the transcript, and the agent stopped if it is working. Changes the agent made to its files stay as they are.`,
    verb: "Revert",
    running: "Reverting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  };
}

/** What an agent's tab hands its messages: Edit of a line, and Revert to here of a reply. */
interface RewindDoors {
  /** The line open for writing again where it stands, by its message id; none while none is. */
  readonly editing: string | undefined;
  /** Opens one of the developer's lines for writing again where it stands. */
  readonly onEdit: (messageId: string) => void;
  /** Closes the line open for writing again, sending nothing. */
  readonly onCancelEdit: () => void;
  /** Sends the words and files in place of the line named. */
  readonly onSendEdit: (
    messageId: string,
    words: string,
    attachments: readonly CodingAgentAttachment[],
  ) => void;
  /** What the line's box is drawn with beside the tab's own box, read as it opens, so the doors stand as they were while the tab's props change. */
  readonly editor: () => Omit<EditComposerDoors, "cuts" | "onCancel" | "onSend">;
  /** Takes the agent back to just before the line named, sending nothing. */
  readonly onRevert: (lineId: string) => void;
  /** The line a reply's Revert to here drops from, by the reply's id: the developer's next line that opened a turn; none where none follows it. */
  readonly revertsAt: ReadonlyMap<string, string>;
  /** The lines Edit writes again, by their ids: the developer's lines that opened a turn. */
  readonly editable: ReadonlySet<string>;
  /** The messages something follows, by their ids, so the send of a line written again drops them and asks first. */
  readonly followed: ReadonlySet<string>;
  /** What a reply's Revert to here drops of other members' messages, by the reply's id, as "2 messages from Sam"; none where it drops none of theirs. */
  readonly revertTakes: ReadonlyMap<string, string>;
  /** What the send of a line written again drops of other members' messages, by the line's id, said as `revertTakes` does; none where it drops none of theirs. */
  readonly editTakes: ReadonlyMap<string, string>;
}

const RewindContext = createContext<RewindDoors | undefined>(undefined);

/** The kinds of sender whose lines are a person's: a member, and a member who has since left. */
const PERSON_SENDERS: ReadonlySet<string> = new Set([
  CODING_AGENT_SENDER.MEMBER,
  CODING_AGENT_SENDER.FORMER,
]);

/**
 * Whether a person wrote the line, the reader or a teammate, which Edit
 * writes again: no sender kept, as on a line from before senders were, or a
 * member's. Luke from a call, an automation, GitHub, and another agent write
 * lines no person said, which Revert to here still drops.
 */
function writtenByPerson(message: CodingAgentMessage): boolean {
  const sender = message.sentBy;
  if (sender === undefined) return true;
  return sender.agent !== true && (sender.kind === undefined || PERSON_SENDERS.has(sender.kind));
}

/** Another member's messages among those a rewind drops, counted by who sent them. */
type Takes = { userId: string | undefined; name: string; count: number }[];

/**
 * Whether another member than the reader wrote the line: a person's, with
 * the reader's own account left out as `lineSender` leaves it out. A member
 * with no account id still stands by their name.
 */
function writtenByOther(message: CodingAgentMessage, readerId: string | undefined): boolean {
  const sender = message.sentBy;
  if (sender === undefined || !writtenByPerson(message)) return false;
  return sender.userId === undefined || (readerId !== undefined && sender.userId !== readerId);
}

/** Counts one more of a member's messages in `takes`, a sender met later standing first because the transcript is read from its end. */
function tally(takes: Takes, sender: NonNullable<CodingAgentMessage["sentBy"]>): void {
  const found = takes.find((each) => each.userId === sender.userId && each.name === sender.name);
  if (found === undefined) takes.unshift({ userId: sender.userId, name: sender.name, count: 1 });
  else found.count += 1;
}

/** What `takes` says of whose messages go: "2 messages from Sam", or none where none are another member's. */
function takesWords(takes: Takes): string | undefined {
  if (takes.length === 0) return undefined;
  return andList(takes.map((each) => `${countWords(each.count, MESSAGE)} from ${each.name}`));
}

/**
 * Where a transcript's rewinds land: the lines a person wrote that opened a
 * turn, the first included, each one Edit may write again, and, for each
 * reply, the next line that opened a turn, whoever sent it, which its Revert
 * to here drops from. Note that a plan the agent was handed is drawn as its
 * card, which offers no Edit, so only a first line drawn as a bubble is
 * written again. Every message but the last is followed by one, which a
 * rewind to just before it drops, and so is the last while lines sent and not
 * yet read back (`pending`) stand after it, since the rewind drops those too.
 * Where a rewind drops messages another member than the reader (`readerId`)
 * wrote, the points say whose and how many, for the confirm to name.
 */
export function rewindPoints(
  messages: readonly CodingAgentMessage[],
  pending: boolean,
  readerId: string | undefined,
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
  // What a rewind to just before each line that opened a turn drops of other members' messages.
  const takenFrom = new Map<string, string>();
  const takes: Takes = [];
  let next: string | undefined;
  // Read from the end, so each reply finds the opening line nearest after it.
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
    // Note that an edit drops what follows the line, so its words are read before the line itself is counted.
    if (opens && writtenByPerson(message)) {
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
    next = message.id;
  }
  return { editable, revertsAt, followed, revertTakes, editTakes };
}

/** Hands an agent's messages what a rewind takes. */
export function RewindProvider({
  value,
  children,
}: {
  value: RewindDoors | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return <RewindContext.Provider value={value}>{children}</RewindContext.Provider>;
}

/** A line's Edit, after its Copy and Copy link; nothing where its tab offers no rewind, or the line opened no turn. */
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

/** A reply's Revert to here, asked first; nothing where its tab offers no rewind, or no line of the developer's follows it. */
export function RevertMessageAction({ messageId }: { messageId: string }): ReactNode {
  const doors = useContext(RewindContext);
  const lineId = doors?.revertsAt.get(messageId);
  // Note that the revert answers at once: the box takes it in turn behind any send, and says there if it did not go.
  const confirm = useConfirmDialog({ subject: lineId !== undefined, surfaceOpen: true }, () => {
    if (lineId !== undefined) doors?.onRevert(lineId);
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
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

/** What the line named is written again with, where it is open for writing; none while it is not open, or its tab offers no rewind. */
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
