import {
  AGENT_STATUS,
  type AgentAttachment,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { Equal } from "effect";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DRAFT_PLACE,
  type EditPlace,
  EMPTY_DRAFT,
  useDraft,
  useDraftWriter,
} from "../composer-drafts.js";
import { confirmFailure } from "../failure-report.js";
import { AgentComposer } from "./agent-composer.js";
import { type LineAttachment, useLineAttachments } from "./agent-pictures.js";
import type { PublishedDoors } from "./agent-published.js";
import type { SkillSource } from "./skill-picker.js";
import type { AgentComposerControl } from "./use-agent-composer.js";

const CANCEL_WORDS = "Cancel";

function sendQuestion(takes: string | undefined): DialogQuestion {
  return {
    title: "Send the edited message?",
    body: `Everything after it${takes === undefined ? "" : `, including ${takes},`} will be removed from the conversation, and the agent stopped if it is working. Changes the agent made to its files stay as they are.`,
    verb: "Send message",
    running: "Sending",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    bodyReplayMasked: takes !== undefined,
  };
}

export interface EditComposerDoors {
  readonly agentId: string;
  readonly doors: PublishedDoors;
  readonly keywords?: readonly string[] | undefined;
  readonly skills?: SkillSource | undefined;
  readonly cuts: boolean;
  readonly takes?: string | undefined;
  readonly onCancel: () => void;
  readonly onSend: (words: string, attachments: readonly AgentAttachment[]) => void;
}

const noop = () => undefined;

function unheld(
  line: readonly LineAttachment[],
  files: readonly AgentAttachment[],
): readonly LineAttachment[] {
  const free = [...files];
  return line.filter((each) => {
    const at = free.findIndex((file) => Equal.equals(file, each.attachment));
    if (at === -1) return true;
    free.splice(at, 1);
    return false;
  });
}

function joined(
  files: readonly AgentAttachment[],
  line: readonly LineAttachment[],
  dropped: readonly string[],
): readonly AgentAttachment[] {
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
  message: AgentTranscriptMessage;
  words: string;
  edit: EditComposerDoors;
}): ReactNode {
  const line = useLineAttachments(message);
  const place: EditPlace = { kind: DRAFT_PLACE.EDIT, agentId: edit.agentId, messageId: message.id };
  const kept = useDraft(place).draft;
  const writer = useDraftWriter();
  const [resumed] = useState(() => kept !== EMPTY_DRAFT);
  const [draft, setDraft] = useState(() => (resumed ? kept.text : words));
  const [attachments, setAttachments] = useState<readonly AgentAttachment[]>(() =>
    resumed
      ? joined(kept.attachments, line.attachments, kept.dropped ?? [])
      : line.attachments.map((each) => each.attachment),
  );
  const held = useRef({ text: draft, attachments, dropped: resumed ? (kept.dropped ?? []) : [] });
  held.current = { ...held.current, text: draft, attachments };
  const offered = useRef(new Set(line.attachments.map((each) => each.key)));
  const keep = (text: string, files: readonly AgentAttachment[]) => {
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
  const confirm = useConfirmDialog(
    { subject: edit.cuts, surfaceOpen: true },
    neverBusyAct(send),
    confirmFailure(FAILURE_SURFACE.MESSAGE_EDIT),
  );
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
      <AgentComposer
        agentId={edit.agentId}
        status={AGENT_STATUS.COMPLETED}
        composer={composer}
        model={undefined}
        models={undefined}
        modelsFailed={false}
        readModels={noop}
        usage={undefined}
        servers={undefined}
        published={undefined}
        doors={edit.doors}
        onStop={() => Promise.resolve(false)}
        followsUp
        keywords={edit.keywords}
        skills={edit.skills}
        sendable={!line.reading}
        onLeave={edit.onCancel}
        beforeSend={() => (
          <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} onClick={edit.onCancel}>
            {CANCEL_WORDS}
          </Button>
        )}
      />
      <ConfirmDialog open confirm={confirm} question={sendQuestion(edit.takes)} />
    </>
  );
}
