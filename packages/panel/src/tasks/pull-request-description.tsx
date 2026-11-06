import type { AgentOverviewPullRequest } from "@repo/features/agent-wire";
import { PULL_REQUEST_ACTION, PULL_REQUEST_REFUSAL } from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  ANNOUNCE,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  EDITABLE_BLOCK_KIND,
  EditableBlock,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePrefetchEditorBundle } from "../bundle-loader.js";
import { type DescriptionEditorPlacement, PLACEMENT_END } from "../description-editor/contract.js";
import { confirmFailure } from "../failure-report.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { clickPlacement, documentWordsAt } from "./description-document-editor.js";
import { EDITOR_NOTE_CLASS, MarkdownEditor } from "./markdown-editor.js";
import {
  PullRequestWriteNote,
  type ReadAgain,
  usePullRequestWrites,
  WRITE_NOTE,
  type WriteNote,
  type WriteOutcome,
} from "./pull-request-writes.js";

const DESCRIPTION_WORDS = {
  LABEL: "Description",
  ROOM: "Editing the description",
  PLACEHOLDER: "Describe the change",
  CHANGED: "The description changed on GitHub since you opened it.",
  RELOAD: "Reload",
} as const;

const RELOAD_QUESTION: DialogQuestion = {
  title: "Reload the description?",
  body: `Your changes are discarded. ${IRREVERSIBLE_WORDS}`,
  verb: "Reload description",
  running: "Reloading",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

const EDITING = {
  CLOSED: "closed",
  OPEN: "open",
  RELOADING: "reloading",
} as const;

type Editing =
  | { readonly kind: typeof EDITING.CLOSED }
  | {
      readonly kind: typeof EDITING.OPEN;
      readonly opened: string;
      readonly base: string;
      readonly placement: DescriptionEditorPlacement | undefined;
      readonly generation: number;
      readonly written?: AgentOverviewPullRequest | undefined;
    }
  | {
      readonly kind: typeof EDITING.RELOADING;
      readonly read: AgentOverviewPullRequest;
      readonly landed: boolean;
      readonly generation: number;
    };

const CLOSED: Editing = { kind: EDITING.CLOSED };

interface HeldDraft {
  readonly draft: string;
  readonly base: string;
  readonly note: WriteNote | undefined;
}

const heldDrafts = new Map<string, Map<number, HeldDraft>>();

function heldDraft(agentId: string, number: number): HeldDraft | undefined {
  return heldDrafts.get(agentId)?.get(number);
}

function holdDraft(agentId: string, number: number, draft: HeldDraft | undefined): void {
  const kept = heldDrafts.get(agentId) ?? new Map<number, HeldDraft>();
  if (draft === undefined) kept.delete(number);
  else kept.set(number, draft);
  if (kept.size === 0) heldDrafts.delete(agentId);
  else heldDrafts.set(agentId, kept);
}

function sameWords(one: string, other: string): boolean {
  return one.replaceAll("\r\n", "\n") === other.replaceAll("\r\n", "\n");
}

interface WriteOut {
  readonly body: string;
  readonly base: string;
  readonly outcome: Promise<WriteOutcome>;
}

function DescriptionNote({
  note,
  onDismiss,
  onReload,
}: {
  note: WriteNote | undefined;
  onDismiss: () => void;
  onReload: () => void;
}): React.JSX.Element | null {
  const changed =
    note?.kind === WRITE_NOTE.WORDS && note.reason === PULL_REQUEST_REFUSAL.DESCRIPTION_CHANGED;
  useAnnounceShown(ANNOUNCE.ALERT, changed ? DESCRIPTION_WORDS.CHANGED : "");
  if (changed) {
    return (
      <div className={EDITOR_NOTE_CLASS}>
        <span>{DESCRIPTION_WORDS.CHANGED}</span>
        <Button onClick={onReload}>{DESCRIPTION_WORDS.RELOAD}</Button>
      </div>
    );
  }
  return (
    <PullRequestWriteNote
      writes={{ note, dismiss: onDismiss }}
      className="pull-request-description-note"
    />
  );
}

export function PullRequestDescription({
  agentId,
  pullRequest,
  body,
  drawn,
  onRead,
}: {
  agentId: string;
  pullRequest: AgentOverviewPullRequest;
  body: string;
  drawn: ReactNode | undefined;
  onRead: ReadAgain;
}): React.JSX.Element {
  const { number } = pullRequest;
  const writes = usePullRequestWrites(agentId, onRead);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  const block = useRef<HTMLDivElement>(null);
  const [held] = useState(() => heldDraft(agentId, number));
  const [heldNote, setHeldNote] = useState(held?.note);
  const [editing, setEditing] = useState<Editing>(() =>
    held === undefined
      ? CLOSED
      : {
          kind: EDITING.OPEN,
          opened: held.draft,
          base: held.base,
          placement: PLACEMENT_END,
          generation: 0,
        },
  );
  useEffect(() => {
    if (held !== undefined) holdDraft(agentId, number, undefined);
  }, []);
  const draft = useRef<string | undefined>(undefined);
  const refocus = useRef(false);
  const out = useRef<WriteOut | undefined>(undefined);
  const note = writes.note ?? heldNote;
  const dismiss = () => {
    writes.dismiss();
    setHeldNote(undefined);
  };
  const open = (placement: DescriptionEditorPlacement | undefined) => {
    draft.current = undefined;
    setEditing((was) => ({
      kind: EDITING.OPEN,
      opened: body,
      base: body,
      placement,
      generation: was.kind === EDITING.CLOSED ? 0 : was.generation + 1,
    }));
  };
  const close = () => {
    draft.current = undefined;
    dismiss();
    setEditing(CLOSED);
  };
  const finish = (byKeyboard: boolean) => {
    if (editing.kind !== EDITING.OPEN || writes.pending !== undefined) return;
    const words = draft.current ?? editing.opened;
    refocus.current = byKeyboard;
    if (sameWords(words, editing.base)) {
      close();
      return;
    }
    setHeldNote(undefined);
    const outcome = writes.write(
      { action: PULL_REQUEST_ACTION.EDIT_DESCRIPTION, body: words, expectedBody: editing.base },
      () =>
        setEditing((was) =>
          was.kind === EDITING.OPEN ? { ...was, base: words, written: pullRequest } : was,
        ),
    );
    const sent: WriteOut = { body: words, base: editing.base, outcome };
    out.current = sent;
    void outcome.then(() => {
      if (out.current === sent) out.current = undefined;
    });
  };
  useEffect(() => {
    if (editing.kind === EDITING.OPEN && editing.written !== undefined) {
      if (pullRequest === editing.written) return;
      if (sameWords(draft.current ?? editing.opened, editing.base)) close();
      else setEditing({ ...editing, written: undefined });
      return;
    }
    if (editing.kind !== EDITING.RELOADING) return;
    if (pullRequest === editing.read && !editing.landed) return;
    draft.current = undefined;
    setEditing({
      kind: EDITING.OPEN,
      opened: body,
      base: body,
      placement: PLACEMENT_END,
      generation: editing.generation + 1,
    });
  });
  useEffect(() => {
    if (editing.kind !== EDITING.CLOSED || !refocus.current) return;
    refocus.current = false;
    block.current?.focus();
  });
  const latest = useRef({ editing, write: writes.write });
  latest.current = { editing, write: writes.write };
  useEffect(
    () => () => {
      const { editing: was, write } = latest.current;
      if (was.kind !== EDITING.OPEN) return;
      const words = draft.current ?? was.opened;
      const sent = out.current;
      const base =
        sent === undefined
          ? Promise.resolve(was.base)
          : sent.outcome.then((outcome) => (outcome.done ? sent.body : sent.base));
      void base.then((expectedBody) => {
        if (sameWords(words, expectedBody)) return;
        void write({
          action: PULL_REQUEST_ACTION.EDIT_DESCRIPTION,
          body: words,
          expectedBody,
        }).then((outcome) => {
          if (outcome.done) return;
          holdDraft(agentId, number, { draft: words, base: expectedBody, note: outcome.note });
        });
      });
    },
    [],
  );
  const changed =
    note?.kind === WRITE_NOTE.WORDS && note.reason === PULL_REQUEST_REFUSAL.DESCRIPTION_CHANGED;
  const reload = useConfirmDialog(
    { subject: changed, surfaceOpen: editing.kind === EDITING.OPEN },
    neverBusyAct(() => {
      if (editing.kind === EDITING.OPEN) {
        draft.current = undefined;
        dismiss();
        const { generation } = editing;
        setEditing({ kind: EDITING.RELOADING, read: pullRequest, landed: false, generation });
        void Promise.resolve(onRead()).then(() =>
          setEditing((was) =>
            was.kind === EDITING.RELOADING && was.generation === generation
              ? { ...was, landed: true }
              : was,
          ),
        );
      }
    }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_DESCRIPTION),
  );
  const read = drawn ?? (
    <p className="pull-request-words m-0 min-w-0 select-text text-body-size leading-reading text-muted-foreground">
      {DESCRIPTION_WORDS.PLACEHOLDER}
    </p>
  );
  if (editing.kind !== EDITING.OPEN) {
    return (
      <EditableBlock
        ref={block}
        label={DESCRIPTION_WORDS.LABEL}
        kind={EDITABLE_BLOCK_KIND.TEXT}
        entry
        onPointerEnter={prefetchEditorBundle}
        onFocus={prefetchEditorBundle}
        onPress={({ target, x, y, block: pressed }) => {
          if (editing.kind !== EDITING.CLOSED) return;
          const placement = clickPlacement(target, x, y, (range) =>
            documentWordsAt(pressed, range),
          );
          if (placement !== undefined) open(placement);
        }}
        onOpen={() => {
          if (editing.kind === EDITING.CLOSED) open(PLACEMENT_END);
        }}
      >
        {read}
      </EditableBlock>
    );
  }
  return (
    <>
      <MarkdownEditor
        key={editing.generation}
        markdown={editing.opened}
        label={DESCRIPTION_WORDS.LABEL}
        roomLabel={DESCRIPTION_WORDS.ROOM}
        placeholder={DESCRIPTION_WORDS.PLACEHOLDER}
        className="transcript-markdown pull-request-description-text"
        roomClassName="pull-request-words pull-request-description min-w-0 select-text text-body-size leading-reading text-foreground"
        onDraft={(markdown) => {
          draft.current = markdown;
        }}
        onFinish={() => finish(true)}
        onLeave={() => {
          if (note !== undefined) return;
          finish(false);
        }}
        loading={read}
        placement={editing.placement}
      >
        <DescriptionNote note={note} onDismiss={dismiss} onReload={reload.ask} />
      </MarkdownEditor>
      <ConfirmDialog open confirm={reload} question={RELOAD_QUESTION} />
    </>
  );
}
