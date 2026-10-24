import {
  CODING_AGENT_STATUS,
  type CodingAgentAttachment,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  ConfirmDialog,
  type DialogQuestion,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { AgentComposer } from "./agent-composer.js";
import { LinePicturesWatch, useLineAttachments } from "./agent-pictures.js";
import type { PublishedDoors } from "./agent-published.js";
import type { SkillSource } from "./skill-picker.js";
import type { AgentComposerControl } from "./use-agent-composer.js";

/**
 * edit-composer.tsx -- one of the developer's lines written again where it stands, in the agent's own message box.
 *
 * Edit opens the line as the box at the tab's foot is drawn, its "+",
 * Dictate, and `@` and `/` lists and all, holding the line's words and the
 * files it carried, which come off and on as a draft's do. A picture the
 * window is still reading joins the box as it lands, and the box sends
 * nothing until it has, since the send drops the line it would be lost with. What belongs to
 * the agent rather than to one line, its model, its servers, what it has
 * cost and what its context holds, stays on the foot's box alone. Cancel,
 * or Escape where no list or dictation takes it, closes it and sends
 * nothing; Send hands the words and files on to go in the line's place.
 * Its draft is its own and kept nowhere, so the foot's box keeps whatever
 * it held. Where messages follow the line, Send asks first, as Revert to here
 * does, since the send drops them and what it drops is gone.
 */

/** What the foot's Cancel says. */
const CANCEL_WORDS = "Cancel";

/** What Send asks before it drops the messages after the line. */
const SEND_QUESTION: DialogQuestion = {
  title: "Send the edited message?",
  body: "Everything after it will be removed from the conversation, and the agent stopped if it is working. Changes the agent made to its files stay as they are.",
  verb: "Send",
  running: "Sending",
};

/** What the box hands on as it sends, and the doors it is drawn with beside the tab's own box. */
export interface EditComposerDoors {
  readonly agentId: string;
  readonly doors: PublishedDoors;
  readonly keywords?: readonly string[] | undefined;
  readonly skills?: SkillSource | undefined;
  readonly dictates: boolean;
  /** Whether messages follow the line, which its send drops, so Send asks first. */
  readonly cuts: boolean;
  readonly onCancel: () => void;
  readonly onSend: (words: string, attachments: readonly CodingAgentAttachment[]) => void;
}

const noop = () => undefined;

export function EditComposer({
  message,
  words,
  edit,
}: {
  message: CodingAgentMessage;
  /** The line's words as its bubble shows them. */
  words: string;
  edit: EditComposerDoors;
}): ReactNode {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const line = useLineAttachments(message);
  const [draft, setDraft] = useState(words);
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>(() =>
    line.attachments.map((each) => each.attachment),
  );
  // Note that each of the line's files joins the box once, as it opens or as its picture lands,
  // so one taken off stays off when a read lands after.
  const offered = useRef(new Set(line.attachments.map((each) => each.key)));
  useEffect(() => {
    const landed = line.attachments.filter((each) => !offered.current.has(each.key));
    if (landed.length === 0) return;
    for (const each of landed) offered.current.add(each.key);
    setAttachments((held) => [...held, ...landed.map((each) => each.attachment)]);
  }, [line.attachments]);
  // Note that the send answers at once: the tab takes it in turn behind any send, and says there if it did not go.
  const confirm = useConfirmDialog({ subject: edit.cuts, surfaceOpen: true }, () => {
    edit.onSend(draft, attachments);
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
  const composer: AgentComposerControl = {
    draft,
    setDraft,
    attachments,
    setAttachments: (next) => setAttachments(next),
    sending: false,
    note: undefined,
    closed: undefined,
    // Note that the box sends nothing while one of the line's pictures is still read, which it would leave behind.
    send: () => {
      if (line.reading) return;
      if (edit.cuts) confirm.ask();
      else edit.onSend(draft, attachments);
    },
    retry: noop,
    sent: [],
  };
  return (
    <>
      <LinePicturesWatch message={message} onSettled={redraw} />
      <AgentComposer
        agentId={edit.agentId}
        // Note that the box's round button sends while it is open, whatever the agent is doing.
        status={CODING_AGENT_STATUS.COMPLETED}
        composer={composer}
        model={undefined}
        models={undefined}
        readModels={noop}
        usage={undefined}
        servers={undefined}
        published={undefined}
        doors={edit.doors}
        onStop={() => Promise.resolve()}
        followsUp
        keywords={edit.keywords}
        skills={edit.skills}
        dictates={edit.dictates}
        sendable={!line.reading}
        onLeave={edit.onCancel}
        beforeSend={() => (
          <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={edit.onCancel}>
            {CANCEL_WORDS}
          </Button>
        )}
      />
      <ConfirmDialog confirm={confirm} question={SEND_QUESTION} />
    </>
  );
}
