import { useAtomValue } from "@effect/atom-react";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_BOUNDS,
  INBOX_RESPONSE,
  type InboxItem,
  type InboxReadResponse,
  type InboxReplyKind,
  knownResponse,
} from "@luke/features/inbox-wire";
import { SERVER_HANDED } from "@luke/ui/agent-servers-model";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useRef, useState } from "react";
import {
  PROMPT_INPUT_STATUS,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
  submitPromptInput,
} from "../ai-elements/prompt-input";
import { editorBundleAtom } from "../editor-bundle";
import { useIntegrationStatuses } from "../integration-statuses";
import { COMPOSER_INPUT, type ComposerEditorHandle } from "../plan-editor/contract";
import { BusyLabel } from "../spinner";
import { Tooltip } from "../tooltip";
import { ComposerField } from "./composer-field";
import { useComposerPickers } from "./composer-pickers";
import { DictateButton, DictationStrip } from "./dictation-strip";
import { type InboxDraft, inboxReply, pressesOf } from "./inbox-model";
import type { SkillSource } from "./skill-picker";
import type { TaskInboxControl } from "./use-task-inbox";

/**
 * inbox-answer-box.tsx -- the box an open Inbox item is answered in, docked under its thread: the agent's message box's card and field, with the item's own presses at its foot.
 *
 * The box is the agent composer's card (`ai-elements/prompt-input.tsx`)
 * around the agent composer's field (`composer-field.tsx`), and takes what
 * that box takes, through the same pickers (`composer-pickers.tsx`): an `@`
 * opens the list of what the note may mention, where the page hands
 * mentions, the plan's own on a plan's Inbox and the item's repository's
 * in the window's, each written in as its link and drawn as its chip; a `/`
 * opens the repository's skills; and the microphone left of the send
 * records words into the box at the caret, in place of the foot until ✓
 * or Enter, or ✕ or Escape. The note goes to the agent in the "Inbox
 * answer" message as it was written, links and all, so what a mention names
 * reaches the agent as a message's does. Enter sends, Shift+Enter is a new
 * line, and Escape leaves the box, as in the agent's box; an approval, a
 * task, and an item asking nothing are answered by the presses in the
 * foot, the one that holds back and the one that goes ahead, so Enter
 * there sends nothing. Unlike the agent's box, the field never takes the
 * caret as an item opens, because K and J step the list while the caret
 * is elsewhere.
 *
 * A card whose agent need not hear back says whether its answer will
 * message the agent: a bare press does not, and a typed note does. Why an
 * answer did not go, or a dictation left nothing, is said under the card.
 */

/** What a card's box asks for, by what the item asks; a text's own placeholder stands where the agent wrote one. */
const NOTE_PLACEHOLDER = {
  [INBOX_RESPONSE.CHOICE]: "Add a note, or answer in your own words",
  [INBOX_RESPONSE.APPROVAL]: "Add a note for the agent",
  [INBOX_RESPONSE.TEXT]: "Your answer",
  [INBOX_RESPONSE.TODO]: "Add a note for the agent",
  [INBOX_RESPONSE.FORM]: "Add a note for the agent",
  [INBOX_RESPONSE.NONE]: "Add a note for the agent",
} as const;

/** What the card says in the box's place where the item asks something this build does not know. */
const NEWER_LUKE = "Answer this in a newer Luke.";

/** What the note says while the editor bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The answer box could not be loaded.";

/**
 * What the box says on an item whose agent need not hear back: a bare
 * press, Done or Got it, is kept for the agent to read, and a typed note is
 * sent to it as a message, so the line says which the answer will be.
 */
const QUIET_LINE = {
  BARE: "Without a note, this won't message the agent.",
  NOTED: "Your note will be sent to the agent.",
} as const;

/** What the box's Send is called. */
const SEND = "Send to agent";

/** The presses that send a card, in the box's footer: its response's where it is answered by a press, Send for the rest. */
function SendPresses({
  item,
  draft,
  sending,
  onAnswer,
}: {
  item: InboxItem;
  draft: InboxDraft;
  sending: boolean;
  onAnswer: (press?: InboxReplyKind) => void;
}): React.JSX.Element {
  const presses = pressesOf(item.response);
  if (presses !== undefined) {
    const { back, ahead } = presses;
    return (
      <div className="inbox-presses flex gap-(--control-gap)">
        {back === undefined ? null : (
          <button
            type="button"
            className="toolbar-button"
            disabled={sending}
            onClick={() => onAnswer(back.reply)}
          >
            {back.label}
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={sending}
          onClick={() => onAnswer(ahead.reply)}
        >
          <BusyLabel busy={sending} label="Sending">
            {ahead.label}
          </BusyLabel>
        </button>
      </div>
    );
  }
  return (
    <Tooltip label={SEND}>
      <PromptInputSubmit
        aria-label={SEND}
        status={sending ? PROMPT_INPUT_STATUS.SUBMITTED : PROMPT_INPUT_STATUS.READY}
        disabled={sending || inboxReply(item, draft) === undefined}
      />
    </Tooltip>
  );
}

/** What the card's box asks for: the agent's own placeholder on a text, its response's words otherwise. */
function placeholderOf(response: InboxReadResponse): string {
  if (!knownResponse(response)) return "";
  if (response.type === INBOX_RESPONSE.TEXT && response.placeholder !== undefined) {
    return response.placeholder;
  }
  return NOTE_PLACEHOLDER[response.type];
}

/** The box an open item is answered in, as above, a note that it was not sent under the card as the composer's is. */
export function InboxAnswerBox({
  item,
  control,
  agent,
  skills,
  keywords,
}: {
  item: InboxItem;
  control: TaskInboxControl;
  /** The item's agent as its holder's read lists it, whose servers' switches a server's chip reads; none before the read lands. */
  agent: CodingAgentSummary | undefined;
  /** Where the item's repository's skills are read from; nothing where none can be. */
  skills: SkillSource | undefined;
  /** The words a dictation into the box is likely to say (`dictation-keywords.ts`). */
  keywords: readonly string[];
}): React.JSX.Element {
  const editor = useRef<ComposerEditorHandle | undefined>(undefined);
  const room = useRef<HTMLDivElement>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const draft = control.draftOf(item);
  const sending = control.sending.has(item.id);
  const byPress = pressesOf(item.response) !== undefined;
  const placeholder = placeholderOf(item.response);
  const bundle = useAtomValue(editorBundleAtom);
  const module = AsyncResult.isSuccess(bundle) ? bundle.value : undefined;
  const statuses = useIntegrationStatuses();
  const pickers = useComposerPickers({
    editor,
    room,
    draft: draft.note,
    placeholder,
    self: item.agentId,
    skills,
    keywords,
    // A server's chip says what the answer does with it: opens a turn, or steers the one running.
    servers: {
      statuses,
      place: {
        disabled: agent?.disabledServers ?? [],
        handed:
          agent?.status === CODING_AGENT_STATUS.RUNNING
            ? SERVER_HANDED.STEERS
            : SERVER_HANDED.OPENS,
      },
    },
    onNote: setRefusal,
  });
  const { dictation, dictating } = pickers;
  const note =
    control.notes.get(item.id) ??
    refusal ??
    (AsyncResult.isFailure(bundle) ? EDITOR_LOAD_FAILED : undefined);
  const answer = (press?: InboxReplyKind) => {
    setRefusal(undefined);
    control.onAnswer(item, draft, press);
  };
  return (
    <div className="agent-composer">
      {knownResponse(item.response) ? (
        <PromptInput
          className="inbox-answer"
          data-presses={byPress ? "" : undefined}
          // A press answers an approval, a task, and an item asking nothing, so its box's Enter sends nothing.
          onSubmit={() => (byPress ? undefined : answer())}
        >
          <ComposerField
            // Each item's note is its own editor, so one item's undo never reaches another's words.
            key={item.id}
            module={module}
            editor={editor}
            room={room}
            draft={draft.note}
            setDraft={(text) => control.onDraft(item, { ...draft, note: text })}
            placeholder={placeholder}
            label={placeholder}
            className="ph-no-capture agent-composer-input"
            input={
              sending
                ? COMPOSER_INPUT.DISABLED
                : dictating
                  ? COMPOSER_INPUT.READ_ONLY
                  : COMPOSER_INPUT.EDITABLE
            }
            maxLength={INBOX_BOUNDS.MAX_NOTE_CHARS}
            takesFocus={false}
            {...pickers.field}
            onEnter={() => {
              if (room.current !== null) submitPromptInput(room.current);
            }}
            // The box takes no files yet, so a pasted file is left to the editor.
            onPasteFiles={() => false}
          />
          <PromptInputFooter className="inbox-answer-foot">
            {dictating ? (
              <DictationStrip dictation={dictation} />
            ) : (
              <>
                <PromptInputTools className="inbox-answer-quiet px-1 text-[12px] text-muted-foreground">
                  {item.needsReply ? null : (
                    <span data-inbox-quiet="">
                      {draft.note.trim() === "" ? QUIET_LINE.BARE : QUIET_LINE.NOTED}
                    </span>
                  )}
                </PromptInputTools>
                <div className="inbox-answer-actions">
                  <DictateButton dictation={dictation} disabled={sending || module === undefined} />
                  <SendPresses item={item} draft={draft} sending={sending} onAnswer={answer} />
                </div>
              </>
            )}
          </PromptInputFooter>
        </PromptInput>
      ) : (
        <p className="m-0 text-muted-foreground" data-inbox-unknown="">
          {NEWER_LUKE}
        </p>
      )}
      {note === undefined ? null : (
        <p className="error-message agent-composer-note" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
