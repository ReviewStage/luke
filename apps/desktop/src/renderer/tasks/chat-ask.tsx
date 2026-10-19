import {
  ASK_STATUS,
  CHAT_ASK,
  CHAT_BOUNDS,
  type ChatMessage,
  type ChatReadResponse,
  type ChatReplyKind,
  fieldValueWords,
  knownResponse,
  replyWords,
} from "@luke/features/chat-wire";
import { type InboxReadResponse, inboxReadResponseSchema } from "@luke/features/inbox-wire";
import {
  EMPTY_INBOX_DRAFT,
  type InboxDraft,
  inboxReply,
  pressesOf,
} from "@luke/panel/tasks/inbox-model";
import { Tooltip } from "@luke/panel/tooltip";
import {
  BADGE_TONE,
  Badge,
  BUTTON_SHAPE,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  CARD_PADDING,
  Card,
  ChoiceList,
  GAP,
  IconButton,
  Inline,
  LAYOUT_ELEMENT,
  Stack,
  TEXT_AREA_SUBMIT,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
} from "@luke/ui";
import type { ChatAskAnswer } from "@luke/ui/chat-model";
import { Option, Schema } from "effect";
import { ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { ChoiceOptions, choiceOptions, FormFields } from "./inbox-pane";

/** Reads a chat ask's response as the Inbox's answer parts take one, the two sharing one wire shape. */
const readInboxResponse = Schema.decodeUnknownOption(inboxReadResponseSchema);

/** The ask's response as the Inbox's answer parts read it; none where it does not read as one. */
function asInboxResponse(response: ChatReadResponse): InboxReadResponse | undefined {
  return Option.getOrUndefined(readInboxResponse(response));
}

/**
 * chat-ask.tsx -- an ask a chat message carries, drawn as a card in its row: what it asks, and its answer, given in place or as it was given.
 *
 * The card is the shared `Card`, its pieces stacked in it. It heads itself
 * with what kind of ask it is, a badge in the attention ink while the ask
 * stands open and a plain one once it is settled, then its title, then
 * the blocks the poster wrote, which the row hands it. What the ask asks
 * for follows, from the Inbox's own answer pieces (`inbox-pane.tsx`): a
 * choice's options, pressed one at a time or several where it allows, one
 * perhaps recommended; a form's fields. A note line closes an open card:
 * a choice, words, and a form are sent by its round press or Enter, and
 * an approval, a task, and an ask of nothing by the presses under it, the
 * one that holds back and the one that goes ahead, as the Inbox's are. A
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
  const options = response.options.map((option) => ({
    ...option,
    recommended: response.recommended === option.label,
  }));
  return (
    <ChoiceList
      legend="What was offered"
      options={choiceOptions(options)}
      value={ask.answer?.choices ?? []}
      settled
      pickedNote="Picked"
    />
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
      <Text tone={TEXT_TONE.MUTED}>
        Resolved{ask.closedReason === undefined ? "" : `: ${ask.closedReason}`}
      </Text>
    );
  }
  if (ask.answer === undefined) return null;
  const by = ask.answeredBy === undefined ? undefined : nameOf(ask.answeredBy);
  const values = ask.answer.values ?? [];
  return (
    <Stack gap={GAP.TIGHT}>
      <Text tone={TEXT_TONE.MUTED}>
        {by === undefined ? "" : `${by}: `}
        {replyWords(ask.answer)}
        {ask.answer.note === undefined ? null : (
          <Text as={TEXT_ELEMENT.SPAN}> {ask.answer.note}</Text>
        )}
      </Text>
      {/* A form's answer is what was filled in, so each field stands under the line, in the form's order. */}
      {values.length === 0 ? null : (
        <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.NONE}>
          {values.map(({ label, value }) => (
            <li key={label}>
              <Text tone={TEXT_TONE.MUTED}>
                {label}: <Text as={TEXT_ELEMENT.SPAN}>{fieldValueWords(value)}</Text>
              </Text>
            </li>
          ))}
        </Stack>
      )}
    </Stack>
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
  draft: InboxDraft;
  sending: boolean;
  onAnswer: (press?: ChatReplyKind) => void;
}): React.JSX.Element {
  const inbox = asInboxResponse(response);
  const presses = inbox === undefined ? undefined : pressesOf(inbox);
  if (presses === undefined) {
    return (
      <Tooltip label="Send">
        <IconButton
          type={BUTTON_TYPE.SUBMIT}
          icon={<ArrowUpIcon aria-hidden="true" />}
          label="Send"
          variant={BUTTON_VARIANT.PRIMARY}
          shape={BUTTON_SHAPE.ROUND}
          disabled={
            !sending &&
            (inbox === undefined || inboxReply({ response: inbox }, draft) === undefined)
          }
          busy={sending}
          busyLabel="Sending"
        />
      </Tooltip>
    );
  }
  const { back, ahead } = presses;
  return (
    <Inline gap={GAP.CONTROL}>
      <Button
        variant={BUTTON_VARIANT.PRIMARY}
        busy={sending}
        busyLabel="Sending"
        onClick={() => onAnswer(ahead.reply)}
      >
        {ahead.label}
      </Button>
      {back === undefined ? null : (
        <Button disabled={sending} onClick={() => onAnswer(back.reply)}>
          {back.label}
        </Button>
      )}
    </Inline>
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
  const [draft, setDraft] = useState<InboxDraft>(EMPTY_INBOX_DRAFT);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const { response } = ask;
  if (!knownResponse(response)) return <Text tone={TEXT_TONE.SUBTLE}>{NEWER_LUKE}</Text>;
  const byPress = pressesOf(response) !== undefined;
  const send = (press?: ChatReplyKind) => {
    const reply = inboxReply({ response }, draft, press);
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
      {/* Note that the card has no foot to count picks on, as the Inbox's box does, so it says under the options that several may be picked. */}
      {response.type === CHAT_ASK.CHOICE && response.multiple === true ? (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Pick any that apply.
        </Text>
      ) : null}
      {response.type === CHAT_ASK.FORM ? (
        <FormFields form={response} draft={draft} disabled={sending} onDraft={setDraft} />
      ) : null}
      {ask.needsReply ? null : <Text tone={TEXT_TONE.MUTED}>{QUIET}</Text>}
      <form
        className="chat-ask-note"
        onSubmit={(event) => {
          event.preventDefault();
          if (!byPress) send();
        }}
      >
        <span className="chat-ask-note-field ph-no-capture">
          <TextArea
            label={placeholder}
            placeholder={placeholder}
            rows={1}
            grow
            maxLength={CHAT_BOUNDS.MAX_NOTE_CHARS}
            value={draft.note}
            disabled={sending}
            onChange={(note) => setDraft({ ...draft, note })}
            submitKey={TEXT_AREA_SUBMIT.ENTER}
            onSubmit={() => {
              if (!byPress) send();
            }}
          />
        </span>
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
      <Card padding={CARD_PADDING.SNUG}>
        <Stack gap={GAP.CONTROL}>
          <Inline>
            <Badge tone={open ? BADGE_TONE.ATTENTION : BADGE_TONE.NEUTRAL}>
              {knownResponse(response) ? ASK_KIND[response.type] : ASK_KIND[CHAT_ASK.NONE]}
            </Badge>
          </Inline>
          {ask.title === undefined ? null : <Text variant={TEXT_VARIANT.DIALOG}>{ask.title}</Text>}
          {blocks}
          {open && mine ? <Text tone={TEXT_TONE.MUTED}>{WAITING}</Text> : null}
          {open && !mine ? <Answer message={message} ask={ask} onAnswer={onAnswer} /> : null}
          {open ? null : (
            <>
              <Picked ask={ask} />
              <Settled ask={ask} nameOf={nameOf} />
            </>
          )}
        </Stack>
      </Card>
    </div>
  );
}
