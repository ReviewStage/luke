import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import {
  ConfirmDialog,
  type DialogQuestion,
  IconButton,
  Tooltip,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS, MESSAGE_ROLE } from "@luke/wire";
import { PencilIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";
import { MessageAction } from "../ai-elements/message.js";

/**
 * rewind-action.tsx -- a coding agent taken back to an earlier point of its transcript: a line of the developer's Edit, which writes it again in the box, a reply's Revert to here, and the box's chip naming the line its words go in place of.
 *
 * An agent's tab hands its messages what a rewind takes (`RewindProvider`):
 * Edit puts a line back in the box, and the send takes the agent back to
 * just before it, so the new words go in its place; Revert to here, asked
 * first since what it drops is gone, takes the agent back to just after a
 * reply, dropping the developer's next line and everything after it. Only a
 * line that opened a turn is written again, and a reply is reverted to only
 * where such a line follows it, since a line a turn took in while it ran sits
 * inside that turn's work. Only the conversation goes back: the agent's
 * checkout stays as it is. A worker's tab and the Call tab hand none.
 */

/** Which rewind a message offers: a line of the developer's its Edit, a reply its Revert to here. */
export const REWIND_ACTION = {
  EDIT: "edit",
  REVERT: "revert",
} as const;

export type RewindAction = (typeof REWIND_ACTION)[keyof typeof REWIND_ACTION];

/** What the actions and the chip say. */
export const REWIND_WORDS = {
  EDIT: "Edit",
  REVERT: "Revert to here",
  EDITING: "Editing your message",
  DROP_EDIT: "Cancel edit",
} as const;

/** What Revert to here asks before it drops anything. */
const REVERT_QUESTION: DialogQuestion = {
  title: "Revert to this message?",
  body: "Everything after it will be removed from the conversation, and the agent stopped if it is working. Changes the agent made to its files stay as they are.",
  verb: "Revert",
  running: "Reverting",
};

/** What an agent's tab hands its messages: Edit of a line, and Revert to here of a reply. */
interface RewindDoors {
  /** Puts one of the developer's lines in the box, its words to go in its place. */
  readonly onEdit: (messageId: string, words: string) => void;
  /** Takes the agent back to just before the line named, sending nothing. */
  readonly onRevert: (lineId: string) => void;
  /** The line a reply's Revert to here drops from, by the reply's id: the developer's next line that opened a turn; none where none follows it. */
  readonly revertsAt: ReadonlyMap<string, string>;
  /** The lines Edit writes again, by their ids: the developer's lines that opened a turn. */
  readonly editable: ReadonlySet<string>;
}

const RewindContext = createContext<RewindDoors | undefined>(undefined);

/**
 * Where a transcript's rewinds land: the developer's lines that opened a
 * turn, each one Edit may write again, and, for each reply, the next such
 * line, which its Revert to here drops from. Note that the plan the agent was
 * handed opens the transcript and is never written again here.
 */
export function rewindPoints(messages: readonly CodingAgentMessage[]): {
  readonly editable: ReadonlySet<string>;
  readonly revertsAt: ReadonlyMap<string, string>;
} {
  const editable = new Set<string>();
  const revertsAt = new Map<string, string>();
  let next: string | undefined;
  // Read from the end, so each reply finds the opening line nearest after it.
  for (let at = messages.length - 1; at > 0; at -= 1) {
    const message = messages[at];
    if (message === undefined) continue;
    if (message.role === MESSAGE_ROLE.USER) {
      if (message.arrivedIn !== undefined) continue;
      editable.add(message.id);
      next = message.id;
    } else if (next !== undefined) {
      revertsAt.set(message.id, next);
    }
  }
  return { editable, revertsAt };
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
export function EditMessageAction({
  messageId,
  words,
}: {
  messageId: string;
  words: string;
}): ReactNode {
  const doors = useContext(RewindContext);
  if (doors === undefined || !doors.editable.has(messageId)) return null;
  return (
    <MessageAction
      label={REWIND_WORDS.EDIT}
      tooltip={REWIND_WORDS.EDIT}
      onClick={() => doors.onEdit(messageId, words)}
    >
      <PencilIcon />
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
        <RotateCcwIcon />
      </MessageAction>
      <ConfirmDialog confirm={confirm} question={REVERT_QUESTION} />
    </>
  );
}

/** The chip over the box while its words go in place of one of the developer's lines, with the × that lets the edit go. */
export function EditChip({ onDrop }: { onDrop: () => void }): React.JSX.Element {
  return (
    <div className="draft-fork-dock">
      <div className="draft-fork-chip" data-edit-chip="">
        <PencilIcon className="draft-fork-glyph" aria-hidden="true" />
        <span className="draft-fork-lead">{REWIND_WORDS.EDITING}</span>
        <span className="draft-fork-drop">
          <Tooltip label={REWIND_WORDS.DROP_EDIT}>
            <IconButton icon={<XIcon />} label={REWIND_WORDS.DROP_EDIT} onClick={onDrop} />
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
