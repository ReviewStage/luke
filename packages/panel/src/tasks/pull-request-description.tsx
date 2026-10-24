import type { CodingAgentOverviewPullRequest } from "@luke/features/coding-agent-wire";
import { PULL_REQUEST_ACTION, PULL_REQUEST_REFUSAL } from "@luke/features/pull-request-write-wire";
import { IRREVERSIBLE_WORDS } from "@luke/features/words";
import {
  ANNOUNCE,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  EDITABLE_BLOCK_KIND,
  EditableBlock,
  useConfirmDialog,
} from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { usePrefetchEditorBundle } from "../bundle-loader.js";
import { PLACEMENT_END, type PlanEditorPlacement } from "../plan-editor/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { MarkdownEditor } from "./markdown-editor.js";
import { documentWordsUnder, editsOnClick } from "./plan-document-editor.js";
import {
  PullRequestWriteNote,
  usePullRequestWrites,
  WRITE_NOTE,
  type WriteNote,
  type WriteOutcome,
} from "./pull-request-writes.js";

/**
 * pull-request-description.tsx -- a pull request's description edited in place: GitHub's rendering as it reads, the plan's editor on its Markdown once pressed, and the edit written to GitHub as it finishes or is left.
 *
 * Where the member may edit the description, its words are drawn as GitHub
 * renders them, and nothing on them marks them editable, as a plan's
 * sections are drawn; a click on the words opens the editor in their place,
 * the caret where the click landed, and so does Return on the description
 * selected. The editor is every Markdown document's (`./markdown-editor.tsx`),
 * on the description as written, with the plan's toolbar, `/` menu and
 * chords; until its bundle has loaded, GitHub's rendering stands. Esc or ⌘↩
 * finishes it, and so does focus leaving it: words left as they opened
 * write nothing, and changed ones are written to GitHub on the member's
 * own sign-in, with the words they began from, which the service holds
 * GitHub's to (`pull-request-write-wire.ts`). The editor stays open until
 * the description's read lands again after the write, so GitHub's
 * rendering of the new words replaces it with nothing drawn between. Words
 * changed as the description goes, as the tab or the pull request is left,
 * are written the same way. A refusal keeps the editor open on the draft
 * and says why as a live alert: where the description changed on GitHub
 * since it opened, with Reload, which asks first, then drops the draft and
 * opens the description as GitHub now has it. A draft whose write is
 * refused as the description goes is kept, and the description opens on it
 * again, saying why, the next time it is drawn.
 */

/** The description's own words. */
const DESCRIPTION_WORDS = {
  LABEL: "Description",
  ROOM: "Editing the description",
  PLACEHOLDER: "Describe the change",
  CHANGED: "The description changed on GitHub since you opened it.",
  RELOAD: "Reload",
} as const;

/** What Reload asks first, since it drops the draft. */
const RELOAD_QUESTION: DialogQuestion = {
  title: "Reload the description?",
  body: `Your changes are discarded, and the description opens as it stands on GitHub now. ${IRREVERSIBLE_WORDS}`,
  verb: "Reload",
  running: "Reloading",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
};

/** Where the description stands: drawn, open in its editor, or waiting on its read to open again on GitHub's words. */
const EDITING = {
  CLOSED: "closed",
  OPEN: "open",
  RELOADING: "reloading",
} as const;

type Editing =
  | { readonly kind: typeof EDITING.CLOSED }
  | {
      readonly kind: typeof EDITING.OPEN;
      /** The words the editor opened on. */
      readonly opened: string;
      /** The words GitHub holds, as far as the tab knows: those it opened on, or those last written. */
      readonly base: string;
      readonly placement: PlanEditorPlacement | undefined;
      /** Each opening's own, so a reload opens a new editor rather than keeping the old one's words. */
      readonly generation: number;
      /** The read standing when the last write went out, which a newer read closes the editor after. */
      readonly written?: CodingAgentOverviewPullRequest | undefined;
    }
  | {
      readonly kind: typeof EDITING.RELOADING;
      /** The read standing when Reload was chosen, which a newer read opens the editor after. */
      readonly read: CodingAgentOverviewPullRequest;
      readonly generation: number;
    };

const CLOSED: Editing = { kind: EDITING.CLOSED };

/** A draft whose write was refused as its description went: its words, the words it began from, and why. */
interface HeldDraft {
  readonly draft: string;
  readonly base: string;
  readonly note: WriteNote | undefined;
}

/**
 * The drafts refused as their descriptions went, by agent and then by pull
 * request number, each opened on again the next time its description is
 * drawn, so no refused words are lost with the surface they were typed on.
 */
const heldDrafts = new Map<string, Map<number, HeldDraft>>();

/** The draft held for a pull request's description; none where none is. */
function heldDraft(agentId: string, number: number): HeldDraft | undefined {
  return heldDrafts.get(agentId)?.get(number);
}

/** A refused draft kept for its description, or let go where `draft` is none. */
function holdDraft(agentId: string, number: number, draft: HeldDraft | undefined): void {
  const kept = heldDrafts.get(agentId) ?? new Map<number, HeldDraft>();
  if (draft === undefined) kept.delete(number);
  else kept.set(number, draft);
  if (kept.size === 0) heldDrafts.delete(agentId);
  else heldDrafts.set(agentId, kept);
}

/**
 * Whether two descriptions read as the same words, line endings aside, as
 * the service compares them, so one saved with mixed line endings, which the
 * editor hands back with one kind, writes nothing untouched.
 */
function sameWords(one: string, other: string): boolean {
  return one.replaceAll("\r\n", "\n") === other.replaceAll("\r\n", "\n");
}

/** A write of the description still out: its words, the words it began from, and how it goes. */
interface WriteOut {
  readonly body: string;
  readonly base: string;
  readonly outcome: Promise<WriteOutcome>;
}

/** Why the last write was refused, under the editor: the description changed on GitHub, with Reload; otherwise the write line's own words. */
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
      <div className="plan-editor-note">
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

/**
 * The description of a pull request the member may edit: `drawn`, GitHub's
 * rendering, or the placeholder where it has none, until it is pressed or
 * Return opens it; then the editor on its Markdown in its place. `onRead`
 * asks the description's read again, which Reload waits on.
 */
export function PullRequestDescription({
  agentId,
  pullRequest,
  body,
  drawn,
  onRead,
}: {
  agentId: string;
  pullRequest: CodingAgentOverviewPullRequest;
  /** The description as written, Markdown, empty where it has none. */
  body: string;
  /** GitHub's rendering of it; none where it has none. */
  drawn: ReactNode | undefined;
  onRead: () => void;
}): React.JSX.Element {
  const { number } = pullRequest;
  const writes = usePullRequestWrites(agentId, onRead);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  const block = useRef<HTMLDivElement>(null);
  // A draft refused as the description last went opens the editor on it again, saying why.
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
  // The editor's words as they stand, handed over at every change; none until the first.
  const draft = useRef<string | undefined>(undefined);
  // Whether the block takes the keyboard back as the editor closes, as it does closed by the keyboard.
  const refocus = useRef(false);
  // The write still out, which a leaving waits on, since only one goes at a time.
  const out = useRef<WriteOut | undefined>(undefined);
  const note = writes.note ?? heldNote;
  const dismiss = () => {
    writes.dismiss();
    setHeldNote(undefined);
  };
  const open = (placement: PlanEditorPlacement | undefined) => {
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
  // Once the read after a write lands, the editor closes onto GitHub's rendering of it, unless words were typed since.
  useEffect(() => {
    if (editing.kind === EDITING.OPEN && editing.written !== undefined) {
      if (pullRequest === editing.written) return;
      if (sameWords(draft.current ?? editing.opened, editing.base)) close();
      else setEditing({ ...editing, written: undefined });
      return;
    }
    if (editing.kind !== EDITING.RELOADING || pullRequest === editing.read) return;
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
  // Note that words changed as the description goes are written as they
  // stand, because no finish reaches an editor taken out of the page, once
  // a write still out has answered, against the words GitHub then holds;
  // ones GitHub refuses are held, with why, for the next time it is drawn.
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
    () => {
      if (editing.kind === EDITING.OPEN) {
        draft.current = undefined;
        dismiss();
        setEditing({ kind: EDITING.RELOADING, read: pullRequest, generation: editing.generation });
        onRead();
      }
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  );
  const read = drawn ?? (
    <p className="pull-request-words pull-request-description-empty">
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
          if (editing.kind !== EDITING.CLOSED || !editsOnClick(target)) return;
          // Note that the caret is placed by the words the click landed on, since the editor may draw what stands above them at another height, an alert say.
          open({ x, y, words: documentWordsUnder(pressed, x, y) });
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
        // Note that the words wear the drawn description's own classes, so nothing moves as it opens or closes.
        className="transcript-markdown pull-request-description-text"
        roomClassName="pull-request-words pull-request-description"
        onDraft={(markdown) => {
          draft.current = markdown;
        }}
        onFinish={() => finish(true)}
        onLeave={() => {
          // Note that a refusal standing holds the editor open, Reload's question among it, so the draft is not sent again unasked.
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
