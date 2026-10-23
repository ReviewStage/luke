import {
  ASK_STATUS,
  CHAT_ASK,
  CHAT_BOUNDS,
  type ChatAnswer,
  type ChatMessage,
  type ChatResponse,
  knownResponse,
} from "@luke/features/chat-wire";
import type { InboxAsk } from "@luke/features/inbox-wire";
import {
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardHead,
  ErrorState,
  GAP,
  LAYOUT_ELEMENT,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
} from "@luke/ui";
import { type Actor, actorName } from "@luke/ui/actor-model";
import type { ChatAskAnswer } from "@luke/ui/chat-model";
import { CheckIcon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import {
  chatAnsweredAt,
  chatAnswers,
  chatAskHolds,
  chatAskMissing,
  chatAskOf,
  chatAskReply,
  chatAskWaitsOn,
  chatNumberedPick,
} from "./chat-ask-model.js";
import { useChatReplyDoor } from "./chat-reply-doors.js";
import {
  AnswerForm,
  answerPlaceholder,
  EDITOR_LOAD_FAILED,
  useAnswerField,
} from "./inbox-answer-box.js";
import {
  ANSWERED,
  AnsweredCard,
  AskControls,
  bareKey,
  DraftQuestion,
  focusMissing,
  hasControls,
  OPTION_NUMBER,
  optionRows,
  sendFromPane,
  takesTyping,
  WaitingMarker,
  WithdrawnWords,
} from "./inbox-ask-controls.js";
import { askHeadWords } from "./inbox-ask-words.js";
import { COMMENT, Comment, CommentName, THREAD_TIME_CLASS } from "./inbox-comment.js";
import type { FormTextDoors } from "./inbox-form-text.js";
import {
  answerDid,
  EMPTY_INBOX_DRAFT,
  INBOX_MISSING,
  type InboxDraft,
  type InboxMissing,
  sentenceCased,
} from "./inbox-model.js";
import { ComposerQuoteView, REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";

/**
 * chat-ask.tsx -- an ask a chat message carries, drawn as the Inbox draws an ask: what it asks, its answer given in place, and its answer as it was given.
 *
 * The card is the Inbox's ask (`inbox-ask-controls.tsx`), its response read
 * as the ask it stands for (`chat-ask-model.ts`): the Inbox's frame, headed
 * by what the ask asks in the Inbox's words ("Pick one", "Pick any",
 * "Steps", "Your answer", "Fill in") and where it stands, then its title and
 * the blocks the poster wrote, which the row hands it. An acknowledgement
 * asks nothing and wears no head. While it waits on someone else, the
 * poster's own, one in a channel the reader cannot post in (an archived one,
 * or a direct message between two others), or one naming others, it ends
 * with the Inbox's pill saying whom: the other of a direct message's two, or
 * the members the message mentions.
 *
 * Where the reader may answer it, its controls stand in the Inbox's answer
 * box (`inbox-answer-box.tsx`) over its note line, as an Inbox item's open
 * ask does: a choice's options, numbered for the keys that pick them while
 * the keyboard is in the card; an approval's Approve and Decline, two small
 * presses; a task's Mark done and Couldn't do it; a form's fields, its text
 * fields the composer's own; nothing for words, whose note line is the
 * answer. Each attaches its answer rather than sending it, a press pressed
 * again taking it off, and the box's Send sends it, lit once the card holds
 * anything; a send that lacks something sends nothing and takes the keyboard
 * there, and Enter on an option or in a field sends as Send does. An
 * acknowledgement's Send reads Got it until a word is written. The note line
 * takes mentions where the page hands them, and a dictation, but no files,
 * which a chat answer does not carry. Words selected in the card, its
 * title, its blocks, and its options, steps, and fields' names, and
 * replied to are quoted into its note line while it may be answered
 * (`chat-reply-doors.ts`). Why an answer was not taken is said under the
 * box.
 *
 * Once answered, the card holds the answerer's comment as the Inbox draws an
 * answer: their face and name, when, and whether it reached the poster, then
 * the controls as the answer left them, read-only, a press given green going
 * ahead and red holding back, and their note as a sent message's words. Once
 * its poster resolved it, the card's head says it was withdrawn, and why. A
 * response this build does not know is drawn as a line naming a newer Luke,
 * answered nowhere.
 */

type CarriedAsk = NonNullable<ChatMessage["ask"]>;

/** What a card says of a response this build does not know. */
const NEWER_LUKE = "Answer this in a newer Luke.";

/** Whom a pill says an ask waits on where it names no one but is not the reader's to answer. */
const ANYONE = "an answer";

/** Joins a few names as a reader says them: "Ada and Bob". */
const NAMES = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** What a card is handed by the row it stands in. */
interface AskCardProps {
  readonly message: ChatMessage;
  readonly ask: CarriedAsk;
  readonly chat: ChatAnswer;
  /** Whether the reader may answer it where it stands: never in a channel they cannot post in, which the service refuses an answer in too. */
  readonly answers: boolean;
  /** The blocks the poster wrote, which the card holds under its title. */
  readonly blocks: React.ReactNode;
  /** The actor a member is drawn as, by the member's id (`chat-actors.ts`). */
  readonly actorOf: (memberId: string) => Actor;
  /** The words a dictation into the note line is likely to say. */
  readonly keywords: readonly string[];
  readonly now: number;
  readonly onAnswer: (answer: ChatAskAnswer) => Promise<string | undefined>;
}

/**
 * Takes the keyboard to what the answer lacks, as the Inbox's box does.
 * Note that an approval and a task are decided by two presses, which the
 * Inbox's way to an option does not stand on, so a decision lacking takes
 * the keyboard to the first of them.
 */
function focusLacking(box: HTMLElement | null, missing: InboxMissing): void {
  if (box !== null && missing.kind === INBOX_MISSING.OPTION && optionRows(box).length === 0) {
    box.querySelector<HTMLButtonElement>(".inbox-ask-presses button")?.focus();
    return;
  }
  focusMissing(box, missing);
}

/**
 * An open card's answer: the ask's controls as the box's body, the note
 * line, and the foot's microphone and Send, as an Inbox item's box draws
 * them; why an answer was not taken under it.
 */
function Answer({
  card,
  message,
  ask,
  response,
  asked,
  self,
  keywords,
  onAnswer,
}: {
  /** The card the box answers, whose words a Reply quotes into its note line. */
  card: RefObject<HTMLDivElement | null>;
  message: ChatMessage;
  ask: CarriedAsk;
  response: ChatResponse;
  asked: InboxAsk | undefined;
  /** The poster's agent, which the note line's `@` list does not offer; none where a person or Luke posted it. */
  self: string | undefined;
  keywords: readonly string[];
  onAnswer: AskCardProps["onAnswer"];
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<InboxDraft>(EMPTY_INBOX_DRAFT);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const statuses = useIntegrationStatuses();
  const asks = asked !== undefined && hasControls(asked);
  const placeholder = answerPlaceholder(
    asks,
    response.type === CHAT_ASK.TEXT ? response.placeholder : undefined,
  );
  const field = useAnswerField({
    draft: draft.note,
    placeholder,
    self,
    agent: undefined,
    skills: undefined,
    keywords,
    statuses,
    onNote: setRefusal,
  });
  // A Reply over the card's words lays its quote into the note line, never while an answer is out.
  useChatReplyDoor(card, (words) => !sending && field.editor.current?.insertQuote(words) === true);
  const nod = response.type === CHAT_ASK.NONE && draft.note.trim() === "";
  // A send of an answer that lacks something goes nowhere, and takes the keyboard to what it lacks.
  const send = () => {
    if (sending) return;
    const reply = chatAskReply(response, draft);
    if (reply === undefined) {
      const missing = chatAskMissing(response, draft);
      if (missing !== undefined) focusLacking(box.current, missing);
      return;
    }
    setSending(true);
    setRefusal(undefined);
    onAnswer({ seq: message.seq, revision: ask.revision, reply }).then(
      (refused) => {
        setSending(false);
        setRefusal(refused);
      },
      (failed: Error) => {
        setSending(false);
        setRefusal(failed.message);
      },
    );
  };
  const text: FormTextDoors = {
    self,
    agent: undefined,
    skills: undefined,
    keywords,
    onEnter: () => sendFromPane(box.current),
  };
  const controls =
    asked === undefined || !asks ? undefined : (
      <DraftQuestion pane={box}>
        <AskControls
          ask={asked}
          title={undefined}
          doors={{ draft, disabled: sending, text, onDraft: setDraft }}
        />
      </DraftQuestion>
    );
  // The number keys pick an option while the keyboard is in the card but in a field, as the Inbox's do anywhere in it, and take the keyboard to it: a row of the list, or one of two presses.
  const onNumber = (event: React.KeyboardEvent) => {
    if (asked === undefined || sending || !OPTION_NUMBER.test(event.key)) return;
    if (!bareKey(event) || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.defaultPrevented || takesTyping(event.target)) return;
    const number = Number(event.key);
    const picked = chatNumberedPick(asked, draft, number);
    if (picked === undefined) return;
    event.preventDefault();
    setDraft(picked);
    if (box.current === null) return;
    const rows = optionRows(box.current);
    const options =
      rows.length > 0
        ? rows
        : [...box.current.querySelectorAll<HTMLButtonElement>(".inbox-ask-presses button")];
    options[number - 1]?.focus();
  };
  const note = refusal ?? (field.failed ? EDITOR_LOAD_FAILED : undefined);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys it hears come from the options and fields inside it, whose numbers pick.
    <div ref={box} className="chat-ask-box" onKeyDown={onNumber}>
      <AnswerForm
        field={field}
        asks={asks}
        messages={false}
        controls={controls}
        note={draft.note}
        onNote={(words) => setDraft((was) => ({ ...was, note: words }))}
        placeholder={placeholder}
        maxLength={CHAT_BOUNDS.MAX_NOTE_CHARS}
        onEnter={() => field.room.current?.closest("form")?.requestSubmit()}
        quote={(quote) => <ComposerQuoteView quote={quote} held={sending} />}
        nod={nod}
        sending={sending}
        held={sending}
        // Note that a form of fields none of which must be filled is answered empty, so it holds an answer before anything is in it.
        sendable={nod || chatAskHolds(draft) || chatAskReply(response, draft) !== undefined}
        onSubmit={send}
      />
      {note === undefined ? null : (
        <div className="agent-composer-note">
          <ErrorState>{note}</ErrorState>
        </div>
      )}
    </div>
  );
}

/** Where an answer went, as the Inbox's says it: to the poster, or kept in the thread for them to read where they need not hear back. */
function Delivered({ heard, poster }: { heard: boolean; poster: Actor }): React.JSX.Element {
  return (
    <ActorLine>
      {heard ? "Sent to " : "Saved for "}
      <ActorRef actor={poster} />
      {heard ? null : " to read"}
    </ActorLine>
  );
}

/**
 * An answered card's answer as its answerer's comment: their face and
 * name, when, and where it went; then the ask's controls as the answer left
 * them, or what they did where it has none and they wrote nothing; then
 * their note, drawn as a sent message's words.
 */
function AnsweredComment({
  message,
  ask,
  asked,
  chat,
  actorOf,
  now,
}: {
  message: ChatMessage;
  ask: CarriedAsk;
  asked: InboxAsk | undefined;
  chat: ChatAnswer;
  actorOf: AskCardProps["actorOf"];
  now: number;
}): React.JSX.Element | null {
  const { answer, answeredBy } = ask;
  if (answer === undefined) return null;
  const answers = asked === undefined ? undefined : chatAnswers(message, asked, answer);
  const drawn = asked !== undefined && answers !== undefined && hasControls(asked);
  const at = chatAnsweredAt(chat, message);
  const answerer = actorOf(answeredBy ?? "");
  return (
    <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.NONE} className="inbox-thread" aria-label="Answer">
      <Comment
        kind={COMMENT.ANSWERED}
        head={
          <>
            <CommentName>
              <ActorRef actor={answerer} />
            </CommentName>
            <span className="inbox-comment-when">
              {at === undefined ? null : (
                <>
                  <Time className={THREAD_TIME_CLASS} at={at} now={now} /> ·{" "}
                </>
              )}
              <Delivered heard={ask.needsReply} poster={actorOf(message.authorId)} />
            </span>
          </>
        }
      >
        {drawn ? <AnsweredCard ask={asked} title={undefined} answers={answers} /> : null}
        {/* Where no control says what was done and nothing was written, a chip says it, as the Inbox's answer does. */}
        {drawn || answer.note !== undefined ? null : (
          <span className="inbox-pick" data-inbox-pick="">
            <CheckIcon aria-hidden="true" />
            <span>{sentenceCased(answerDid(answer))}</span>
          </span>
        )}
        {answer.note === undefined ? null : (
          <div className="inbox-words" data-inbox-note="">
            <SentWords text={answer.note} asDocument />
          </div>
        )}
      </Comment>
    </Stack>
  );
}

/** The pill an open ask ends with while it waits on someone else, naming them, or saying it waits on an answer where it names no one. */
function Waiting({
  waitsOn,
  actorOf,
}: {
  waitsOn: readonly string[];
  actorOf: AskCardProps["actorOf"];
}): React.JSX.Element {
  const names = waitsOn.map((memberId) => actorName(actorOf(memberId), { sentence: true }));
  return <WaitingMarker on={names.length === 0 ? ANYONE : NAMES.format(names)} />;
}

/** An ask's card: its head, its title, the blocks the row hands it, and its answer as the ask stands. */
export function AskCard({
  message,
  ask,
  chat,
  answers,
  blocks,
  actorOf,
  keywords,
  now,
  onAnswer,
}: AskCardProps): React.JSX.Element {
  const { response } = ask;
  const open = ask.status === ASK_STATUS.OPEN;
  const card = useRef<HTMLDivElement>(null);
  const title =
    ask.title === undefined ? null : (
      <div {...{ [REPLY_SCOPE]: "" }}>
        <Text variant={TEXT_VARIANT.DIALOG}>{ask.title}</Text>
      </div>
    );
  if (!knownResponse(response)) {
    return (
      <div className="chat-ask" data-status={ask.status}>
        <div className="inbox-ask">
          <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
            <CardHead>
              <Text tone={TEXT_TONE.MUTED}>{NEWER_LUKE}</Text>
            </CardHead>
            <div className="chat-ask-body">
              {title}
              {blocks}
            </div>
          </Card>
        </div>
      </div>
    );
  }
  const asked = chatAskOf(response);
  const mine = message.authorId === chat.self;
  const answerable = open && !mine && answers;
  const named = chatAskWaitsOn(chat, message);
  const waitsOn = named.filter((memberId) => memberId !== chat.self);
  // An ask waits on someone else where the reader may not answer it, or where it names others and not them.
  const waiting = open && (!answerable || (named.length > 0 && waitsOn.length === named.length));
  // Note that the poster's own agent is never offered to mention, as the Inbox's box never offers the item's.
  const self = chat.members.find((member) => member.id === message.authorId)?.agentId;
  const standing = (() => {
    switch (ask.status) {
      case ASK_STATUS.ANSWERED:
        return <span className="inbox-ask-standing">{ANSWERED}</span>;
      case ASK_STATUS.CLOSED:
        // Note that only its poster resolves an ask, so a close that says no reason was theirs.
        return (
          <WithdrawnWords
            reason={ask.closedReason}
            closer={ask.closedReason === undefined ? actorOf(message.authorId) : undefined}
          />
        );
      default:
        return null;
    }
  })();
  return (
    <div ref={card} className="chat-ask" data-status={ask.status}>
      <div className="inbox-ask">
        <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
          {asked === undefined ? null : (
            <CardHead>
              <span className="inbox-ask-kind">{askHeadWords(asked, undefined)}</span>
              {standing}
            </CardHead>
          )}
          <div className="chat-ask-body">
            {title}
            {blocks}
            {waiting ? <Waiting waitsOn={waitsOn} actorOf={actorOf} /> : null}
            {answerable ? (
              <Answer
                card={card}
                message={message}
                ask={ask}
                response={response}
                asked={asked}
                self={self}
                keywords={keywords}
                onAnswer={onAnswer}
              />
            ) : null}
            {ask.status === ASK_STATUS.ANSWERED ? (
              <AnsweredComment
                message={message}
                ask={ask}
                asked={asked}
                chat={chat}
                actorOf={actorOf}
                now={now}
              />
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
