import {
  ASK_STATUS,
  CHAT_ASK,
  CHAT_BOUNDS,
  CHAT_FIELD,
  type ChatChoice,
  type ChatField,
  type ChatForm,
  type ChatMessage,
  type ChatReadResponse,
  type ChatReplyKind,
  fieldValueWords,
  knownResponse,
  replyWords,
} from "@luke/features/chat-wire";
import { ArrowUpIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import { Segmented } from "../segmented";
import { BusyLabel } from "../spinner";
import { Switch } from "../switch";
import { Tooltip } from "../tooltip";
import {
  type ChatDraft,
  chatReply,
  EMPTY_CHAT_DRAFT,
  fieldValueOf,
  pressesOf,
  withChoice,
  withValue,
} from "./chat-answer";
import type { ChatAskAnswer } from "./chat-model";

/**
 * chat-ask.tsx -- an ask a chat message carries, drawn as a card in its row: what it asks, and its answer, given in place or as it was given.
 *
 * The card heads itself with what kind of ask it is, then its title, then
 * the blocks the poster wrote, which the row hands it. What the ask asks
 * for follows: a
 * choice's options, pressed one at a time or several where it allows, one
 * perhaps recommended; a form's fields. A note line closes an open card:
 * a choice, words, and a form are sent by its round press or Enter, and
 * an approval, a task, and an ask of nothing by the presses under it, the
 * one that holds back and the one that goes ahead, as a confirm's are. A
 * card the developer posted waits, and says so; a card whose poster need
 * not hear back says answering tells nobody. Once answered, the options
 * stand with the pick marked and the answer said under them, who gave it
 * and how, a form's fields each with what was filled in; once its poster
 * resolved it, why. An answer refused keeps the
 * card as it was and says why under it. A response this build does not
 * know is drawn as a line naming a newer Luke, answered nowhere.
 */

/** What a card heads itself with, by what it asks. */
const ASK_KIND = {
  [CHAT_ASK.CHOICE]: "Ask · Choice",
  [CHAT_ASK.APPROVAL]: "Ask · Approval",
  [CHAT_ASK.TEXT]: "Ask · Words",
  [CHAT_ASK.TASK]: "Ask · Task",
  [CHAT_ASK.FORM]: "Ask · Form",
  [CHAT_ASK.NONE]: "Notice",
} as const;

/** What a card's note line asks for, by what the ask asks; a text's own placeholder stands where the poster wrote one. */
const NOTE_PLACEHOLDER = {
  [CHAT_ASK.CHOICE]: "Add a note, or answer in your own words",
  [CHAT_ASK.APPROVAL]: "Add a note",
  [CHAT_ASK.TEXT]: "Your answer",
  [CHAT_ASK.TASK]: "Add a note",
  [CHAT_ASK.FORM]: "Add a note",
  [CHAT_ASK.NONE]: "Add a note",
} as const;

/** What a card says of a response this build does not know. */
const NEWER_LUKE = "Answer this in a newer Luke.";

/** What a card the developer posted says while it waits. */
const WAITING = "Waiting on an answer";

/** What a card whose poster need not hear back says over its answer. */
const QUIET = "Answering doesn't message the poster.";

type CarriedAsk = NonNullable<ChatMessage["ask"]>;

/** What the note line asks for: the poster's own placeholder on words, the response's words otherwise. */
function placeholderOf(response: ChatReadResponse): string {
  if (!knownResponse(response)) return "";
  if (response.type === CHAT_ASK.TEXT && response.placeholder !== undefined) {
    return response.placeholder;
  }
  return NOTE_PLACEHOLDER[response.type];
}

/** A settled choice's options: the pick in a picked option's look with a check, the rest stepped back. */
function Picked({ ask }: { ask: CarriedAsk }): React.JSX.Element | null {
  const { response } = ask;
  if (!knownResponse(response) || response.type !== CHAT_ASK.CHOICE) return null;
  const picks = ask.answer?.choices ?? [];
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="What was offered">
      {response.options.map((option) => {
        const picked = picks.includes(option.label);
        return (
          <li key={option.label} className="inbox-option" data-picked={String(picked)}>
            <span>
              <span className="font-medium">{option.label}</span>
              {response.recommended === option.label ? (
                <span className="text-muted-foreground"> · Recommended</span>
              ) : null}
              {picked ? (
                <span className="inbox-picked">
                  <CheckIcon aria-hidden="true" />
                  Picked
                </span>
              ) : null}
            </span>
            {option.detail === undefined ? null : (
              <span className="text-muted-foreground">{option.detail}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The line a settled card closes on: the answer and who gave it, or why its poster resolved it. */
function Settled({
  ask,
  nameOf,
}: {
  ask: CarriedAsk;
  nameOf: (memberId: string) => string;
}): React.JSX.Element | null {
  if (ask.status === ASK_STATUS.CLOSED) {
    return (
      <p className="chat-ask-settled" data-settled="closed">
        Resolved{ask.closedReason === undefined ? "" : `: ${ask.closedReason}`}
      </p>
    );
  }
  if (ask.answer === undefined) return null;
  const by = ask.answeredBy === undefined ? undefined : nameOf(ask.answeredBy);
  const values = ask.answer.values ?? [];
  return (
    <div className="chat-ask-settled" data-settled="answered">
      <p className="m-0">
        {by === undefined ? "" : `${by}: `}
        {replyWords(ask.answer)}
        {ask.answer.note === undefined ? null : (
          <span className="chat-ask-settled-note"> {ask.answer.note}</span>
        )}
      </p>
      {/* A form's answer is what was filled in, so each field stands under the line, in the form's order. */}
      {values.length === 0 ? null : (
        <ul className="chat-ask-values">
          {values.map(({ label, value }) => (
            <li key={label}>
              {label}: <span className="chat-ask-settled-note">{fieldValueWords(value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The presses under the note line that answer an approval, a task, or an ask of nothing; the round send for the rest. */
function Presses({
  response,
  draft,
  sending,
  onAnswer,
}: {
  response: ChatReadResponse;
  draft: ChatDraft;
  sending: boolean;
  onAnswer: (press?: ChatReplyKind) => void;
}): React.JSX.Element {
  const presses = pressesOf(response);
  if (presses === undefined) {
    return (
      <Tooltip label="Send">
        <button
          type="submit"
          className="chat-send"
          aria-label="Send"
          disabled={sending || chatReply(response, draft) === undefined}
        >
          <BusyLabel busy={sending} label="Sending">
            <ArrowUpIcon aria-hidden="true" />
          </BusyLabel>
        </button>
      </Tooltip>
    );
  }
  const { back, ahead } = presses;
  return (
    <div className="chat-ask-presses">
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
    </div>
  );
}

/** A choice's options, each pressed to pick it, the agent's recommendation said after its label; several stay pressed where the choice allows. */
function ChoiceOptions({
  choice,
  draft,
  disabled,
  onDraft,
}: {
  choice: ChatChoice;
  draft: ChatDraft;
  disabled: boolean;
  onDraft: (draft: ChatDraft) => void;
}): React.JSX.Element {
  const multiple = choice.multiple === true;
  return (
    <div className="flex flex-col gap-1" data-chat-choice={multiple ? "multiple" : "one"}>
      {choice.options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={draft.choices.includes(option.label)}
          className="inbox-option"
          disabled={disabled}
          onClick={() => onDraft(withChoice(draft, option.label, multiple))}
        >
          <span>
            <span className="font-medium">{option.label}</span>
            {choice.recommended === option.label ? (
              <span className="text-muted-foreground"> · Recommended</span>
            ) : null}
          </span>
          {option.detail === undefined ? null : (
            <span className="text-muted-foreground">{option.detail}</span>
          )}
        </button>
      ))}
      {multiple ? (
        <p className="m-0 text-[12px] text-muted-foreground">Pick any that apply.</p>
      ) : null}
    </div>
  );
}

/** A field's name over or beside its control, saying where it must be filled. */
function FieldName({ field }: { field: ChatField }): React.JSX.Element {
  return (
    <span className="settings-copy">
      <strong>{field.label}</strong>
      {field.required === true ? <small>Required</small> : null}
    </span>
  );
}

/** One field of a form: the control Settings draws for its type, holding what the developer put in it. */
function FormField({
  field,
  draft,
  disabled,
  onDraft,
}: {
  field: ChatField;
  draft: ChatDraft;
  disabled: boolean;
  onDraft: (draft: ChatDraft) => void;
}): React.JSX.Element {
  const value = fieldValueOf(draft, field.label);
  const set = (next: string | number | boolean | undefined) =>
    onDraft(withValue(draft, field.label, next));
  switch (field.type) {
    case CHAT_FIELD.TEXT:
    case CHAT_FIELD.NUMBER: {
      const number = field.type === CHAT_FIELD.NUMBER;
      return (
        <label className="flex flex-col gap-1" data-chat-field={field.type}>
          <FieldName field={field} />
          <input
            className="settings-input inbox-field-input"
            type={number ? "number" : "text"}
            maxLength={CHAT_BOUNDS.MAX_FIELD_VALUE_CHARS}
            value={value === undefined ? "" : String(value)}
            disabled={disabled}
            onChange={(event) => {
              const typed = event.currentTarget.value;
              if (typed === "") return set(undefined);
              const parsed = event.currentTarget.valueAsNumber;
              set(number ? (Number.isFinite(parsed) ? parsed : undefined) : typed);
            }}
          />
        </label>
      );
    }
    case CHAT_FIELD.SELECT:
      return (
        <div className="settings-row settings-row-wrapping" data-chat-field={field.type}>
          <FieldName field={field} />
          {/* An optional field's choice is taken back by pressing it again, its only way to be left unanswered. */}
          <Segmented
            legend={field.label}
            options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
            value={field.options?.find((option) => option === value)}
            disabled={disabled}
            clearable={field.required !== true}
            onChange={set}
          />
        </div>
      );
    case CHAT_FIELD.BOOLEAN:
      return (
        <div className="settings-row" data-chat-field={field.type}>
          <FieldName field={field} />
          <Switch checked={value === true} label={field.label} disabled={disabled} onChange={set} />
        </div>
      );
  }
}

/** A form's fields, in the agent's order. */
function FormFields({
  form,
  draft,
  disabled,
  onDraft,
}: {
  form: ChatForm;
  draft: ChatDraft;
  disabled: boolean;
  onDraft: (draft: ChatDraft) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" data-chat-form="">
      {form.fields.map((field) => (
        <FormField
          key={field.label}
          field={field}
          draft={draft}
          disabled={disabled}
          onDraft={onDraft}
        />
      ))}
    </div>
  );
}

/** An open card's answer: the response's controls, the note line, and its presses. */
function Answer({
  message,
  ask,
  onAnswer,
}: {
  message: ChatMessage;
  ask: CarriedAsk;
  onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ChatDraft>(EMPTY_CHAT_DRAFT);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const { response } = ask;
  if (!knownResponse(response)) return <p className="chat-unknown">{NEWER_LUKE}</p>;
  const byPress = pressesOf(response) !== undefined;
  const send = (press?: ChatReplyKind) => {
    const reply = chatReply(response, draft, press);
    if (reply === undefined || sending) return;
    setSending(true);
    setNote(undefined);
    onAnswer({ seq: message.seq, revision: ask.revision, reply }).then(
      (refused) => {
        setSending(false);
        setNote(refused);
      },
      (failed: Error) => {
        setSending(false);
        setNote(failed.message);
      },
    );
  };
  const placeholder = placeholderOf(response);
  return (
    <>
      {response.type === CHAT_ASK.CHOICE ? (
        <ChoiceOptions choice={response} draft={draft} disabled={sending} onDraft={setDraft} />
      ) : null}
      {response.type === CHAT_ASK.FORM ? (
        <FormFields form={response} draft={draft} disabled={sending} onDraft={setDraft} />
      ) : null}
      {ask.needsReply ? null : <p className="chat-ask-quiet">{QUIET}</p>}
      <form
        className="chat-ask-note"
        onSubmit={(event) => {
          event.preventDefault();
          if (!byPress) send();
        }}
      >
        <textarea
          className="chat-ask-note-field ph-no-capture"
          aria-label={placeholder}
          placeholder={placeholder}
          rows={1}
          maxLength={CHAT_BOUNDS.MAX_NOTE_CHARS}
          value={draft.note}
          disabled={sending}
          onChange={(event) => setDraft({ ...draft, note: event.currentTarget.value })}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!byPress) send();
          }}
        />
        {byPress ? null : (
          <Presses response={response} draft={draft} sending={sending} onAnswer={send} />
        )}
      </form>
      {byPress ? (
        <Presses response={response} draft={draft} sending={sending} onAnswer={send} />
      ) : null}
      {note === undefined ? null : (
        <p className="error-message" role="alert">
          {note}
        </p>
      )}
    </>
  );
}

/** An ask's card: its kind, its title, the blocks the row hands it, and its answer as the ask stands. */
export function AskCard({
  message,
  ask,
  mine,
  blocks,
  nameOf,
  onAnswer,
}: {
  message: ChatMessage;
  ask: CarriedAsk;
  /** Whether the developer posted it, which leaves them nothing to answer. */
  mine: boolean;
  blocks: React.ReactNode;
  nameOf: (memberId: string) => string;
  onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
}): React.JSX.Element {
  const { response } = ask;
  const open = ask.status === ASK_STATUS.OPEN;
  return (
    <div className="chat-ask" data-status={ask.status}>
      <p className="chat-ask-kind">
        {knownResponse(response) ? ASK_KIND[response.type] : ASK_KIND[CHAT_ASK.NONE]}
      </p>
      {ask.title === undefined ? null : <p className="chat-ask-title">{ask.title}</p>}
      {blocks}
      {open && mine ? <p className="chat-ask-quiet">{WAITING}</p> : null}
      {open && !mine ? <Answer message={message} ask={ask} onAnswer={onAnswer} /> : null}
      {open ? null : (
        <>
          <Picked ask={ask} />
          <Settled ask={ask} nameOf={nameOf} />
        </>
      )}
    </div>
  );
}
