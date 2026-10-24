import {
  CODING_AGENT_STATUS,
  type CodingAgentAttachment,
  type CodingAgentMessage,
} from "@luke/features/coding-agent-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Equal } from "effect";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import {
  DRAFT_PLACE,
  type EditPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { AgentComposer } from "./agent-composer.js";
import { type LineAttachment, LinePicturesWatch, useLineAttachments } from "./agent-pictures.js";
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
 * Its draft is its own, kept by agent and line (`composer-drafts.ts`), so
 * the foot's box keeps whatever it held, and a Cancel, an Escape, or a
 * switch away keeps what was written, which Edit opens on again; Send lets
 * it go, and so does writing the line back as it was. The line's files
 * join the box again as it opens on a draft, but for those it took off,
 * since a relaunch keeps a draft's words alone. Where messages follow the line, Send asks first, as Revert to here
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
  loss: CONFIRM_LOSS.IRREVERSIBLE,
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

/**
 * The line's files the box does not hold, each matched to a file of the
 * box's at most once, so where the line carries one file twice and the
 * box holds it once, one of the two is the one it does not.
 */
function unheld(
  line: readonly LineAttachment[],
  files: readonly CodingAgentAttachment[],
): readonly LineAttachment[] {
  const free = [...files];
  return line.filter((each) => {
    const at = free.findIndex((file) => Equal.equals(file, each.attachment));
    if (at === -1) return true;
    free.splice(at, 1);
    return false;
  });
}

/** The box's files with the line's joined after them, but for those already there and those it took off. */
function joined(
  files: readonly CodingAgentAttachment[],
  line: readonly LineAttachment[],
  dropped: readonly string[],
): readonly CodingAgentAttachment[] {
  const joining = unheld(
    line.filter((each) => !dropped.includes(each.key)),
    files,
  ).map((each) => each.attachment);
  return [...files, ...joining];
}

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
  const place: EditPlace = { kind: DRAFT_PLACE.EDIT, agentId: edit.agentId, messageId: message.id };
  const kept = useDraft(place).draft;
  const writer = useDraftWriter();
  // Note that a draft kept from an earlier Edit is what the box opens on, and the line's files
  // join it but for those it took off, since a relaunch keeps a draft's words and not its files.
  const [resumed] = useState(() => kept !== EMPTY_DRAFT);
  const [draft, setDraft] = useState(() => (resumed ? kept.text : words));
  const [attachments, setAttachments] = useState<readonly CodingAgentAttachment[]>(() =>
    resumed
      ? joined(kept.attachments, line.attachments, kept.dropped ?? [])
      : line.attachments.map((each) => each.attachment),
  );
  // What the box holds as last drawn, which a change landing before the next draw moves on from.
  const held = useRef({ text: draft, attachments, dropped: resumed ? (kept.dropped ?? []) : [] });
  held.current = { ...held.current, text: draft, attachments };
  // Note that each of the line's files joins the box once, as it opens or as its picture lands,
  // so one taken off stays off when a read lands after.
  const offered = useRef(new Set(line.attachments.map((each) => each.key)));
  // What the box holds is kept, the files of the line it took off named beside it, and let go where it holds the line as it stands.
  const keep = (text: string, files: readonly CodingAgentAttachment[]) => {
    const dropped = [
      ...held.current.dropped.filter((key) => !line.attachments.some((each) => each.key === key)),
      ...unheld(line.attachments, files)
        .filter((each) => offered.current.has(each.key))
        .map((each) => each.key),
    ];
    held.current = { text, attachments: files, dropped };
    const asLine =
      text === words &&
      dropped.length === 0 &&
      Equal.equals(
        files,
        line.attachments.map((each) => each.attachment),
      );
    writer.update(place, (was) =>
      asLine
        ? EMPTY_DRAFT
        : {
            ...was,
            text,
            attachments: files,
            dropped: dropped.length === 0 ? undefined : dropped,
          },
    );
  };
  // A picture that lands joins the box and its draft, as one there as it opened did.
  useEffect(() => {
    const landed = line.attachments.filter((each) => !offered.current.has(each.key));
    if (landed.length === 0) return;
    for (const each of landed) offered.current.add(each.key);
    const files = joined(held.current.attachments, landed, held.current.dropped);
    setAttachments(files);
    keep(held.current.text, files);
  });
  const send = () => {
    writer.update(place, () => EMPTY_DRAFT);
    edit.onSend(draft, attachments);
  };
  // Note that the send answers at once: the tab takes it in turn behind any send, and says there if it did not go.
  const confirm = useConfirmDialog({ subject: edit.cuts, surfaceOpen: true }, () => {
    send();
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
  const composer: AgentComposerControl = {
    draft,
    setDraft: (text) => {
      setDraft(text);
      keep(text, held.current.attachments);
    },
    attachments,
    setAttachments: (next) => {
      const files = next(held.current.attachments);
      setAttachments(files);
      keep(held.current.text, files);
    },
    sending: false,
    note: undefined,
    closed: undefined,
    // Note that the box sends nothing while one of the line's pictures is still read, which it would leave behind.
    send: () => {
      if (line.reading) return;
      if (edit.cuts) confirm.ask();
      else send();
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
        modelsFailed={false}
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
      <ConfirmDialog open confirm={confirm} question={SEND_QUESTION} />
    </>
  );
}
