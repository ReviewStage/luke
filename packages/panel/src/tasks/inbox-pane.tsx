import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import type { Channel } from "@luke/features/channel-wire";
import { dictationKeywords } from "@luke/features/dictation-keywords";
import {
  fieldValueWords,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  inboxAddressedTo,
  inboxWaitsOn,
  openAskOf,
} from "@luke/features/inbox-wire";
import { markdownLink } from "@luke/features/link-grammar";
import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BackButton,
  Badge,
  Breadcrumbs,
  BUTTON_SIZE,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CardHead,
  type Crumb,
  ErrorState,
  Fill,
  GAP,
  IconButton,
  INLINE_REF_LOOK,
  InlineRef,
  LAYOUT_ELEMENT,
  MoreButton,
  moreLabel,
  SidePanelIcon,
  STATUS_TONE,
  Stack,
  SteppedBack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TOOLBAR_INSET,
  Toolbar,
  Tooltip,
  useMenu,
  useMinute,
  WingFace,
} from "@luke/ui";
import {
  ACTOR_KIND,
  type Actor,
  accountActor,
  actorName,
  memberActor,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { GLYPH } from "@luke/ui/icons";
import { isWireString } from "@luke/wire";
import { BotIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, ZapIcon } from "lucide-react";
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ACTOR_SIZE,
  ActorLine,
  ActorMark,
  ActorRef,
  AutomationCard,
  commentAuthor,
} from "../actor-ref.js";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { useAutomation } from "../automation-directory.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { PhoneHead } from "../desktop/phone-head.js";
import { unreadShown } from "../failure-report.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { useSteadyDoor } from "../steady-door.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { LOG_OVER_COMPOSER_CLASS } from "./agent-composer.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { ChannelCard } from "./channel-card.js";
import { type AnswerNewThread, InboxAnswerBox, type NewThreadStart } from "./inbox-answer-box.js";
import {
  ANSWERED,
  AnsweredCard,
  AskControls,
  bareKey,
  DraftQuestion,
  HeldControls,
  hasControls,
  INBOX_ASK_BOX,
  INBOX_ASK_KIND,
  INBOX_ASK_STANDING,
  OPTION_NUMBER,
  optionRows,
  sendFromPane,
  takesTyping,
  WaitingMarker,
  WithdrawnWhy,
  WithdrawnWords,
} from "./inbox-ask-controls.js";
import { askHeadWords } from "./inbox-ask-words.js";
import { type InboxCloser, useInboxClose } from "./inbox-close.js";
import type { InboxCodeDoors } from "./inbox-code-card.js";
import { INBOX_VIEW_ITEMS } from "./inbox-columns.js";
import { COMMENT, INBOX_THREAD, InboxComment } from "./inbox-comment.js";
import type { FormTextDoors } from "./inbox-form-text.js";
import { useInboxItemActions } from "./inbox-item-actions.js";
import { AddressedTo, HolderGlyph } from "./inbox-item-parts.js";
import {
  AgentName,
  type ItemAgent,
  ItemWords,
  MessageWords,
  useMessageWriter,
} from "./inbox-message.js";
import {
  answerOf,
  askNumberedPick,
  EMPTY_INBOX_DRAFT,
  holderAutomationId,
  holderName,
  INBOX_HOLDER,
  INBOX_NOT_READ,
  INBOX_SETTLED_STANDING,
  type InboxDraft,
  type InboxHolder,
  type InboxKnownAsk,
  inboxSettledStanding,
  itemWorkspaceId,
  knownAsk,
  operatorHolder,
  readersItem,
  sentStamp,
} from "./inbox-model.js";
import { type InboxPager, InboxPagerControls } from "./inbox-pager.js";
import { InboxStamp } from "./inbox-stamp.js";
import { REPLY_SCOPE } from "./reply-to-selection.js";
import { SentWords } from "./skill-chip.js";
import { TAB_KIND, tabLook } from "./tab-look.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { cardTitle } from "./tool-call-model.js";
import { INERT_LINK_CLASS, TranscriptWords } from "./transcript-blocks.js";
import type { AgentsControl } from "./use-agents.js";
import { opensAsLink } from "./use-open-link.js";
import {
  type InboxImageReads,
  type PendingInboxReply,
  pendingReplyOn,
  type TaskInboxControl,
} from "./use-task-inbox.js";

/**
 * inbox-pane.tsx -- one inbox item at reading size: a comment thread under the item's title, the agent's messages and what they ask, and the answers given in place or as they were given.
 *
 * The item reads as a comment thread, as an issue or a pull request does:
 * its title alone leads as the thread's subject. Each message under it is a
 * comment, a Markdown document headed by its writer's chip, their face and
 * name, and when, the chip's face standing out on the line that runs down
 * through every face to join the comments: a member by their face and name,
 * the agent by its tile and name. Its words are drawn with the item's own
 * pictures, pairs, and lone-link cards, read under the item's own
 * workspace, its plan's or its agent's, and its files after them, never as
 * a strip over its words: a picture its words draw stands there alone,
 * every other one as a picture after them, opened larger over the window
 * by a press (`inbox-pictures.tsx`), and any other file as its chip
 * (`CommentFiles`). A thread read cut to its latest says, after its first
 * message, that the earlier ones are in the agent's tab.
 *
 * A member's answer leads with the ask's card it answered, its kind and how
 * it was answered at its head and its controls under it as the answer left
 * them, read-only; where the thread read no longer carries the ask, it
 * leads with its stamp (`inbox-stamp.tsx`) and its values listed. An
 * agent's message that asks ends, while the ask waits, with a marker saying
 * which teammate it waits on, or nothing where it waits on the reader, its
 * controls standing in the draft reply over the note: a `decide`'s numbered
 * options or two small buttons, each numbered for the key that picks it
 * from anywhere in the Inbox but a field; a `do`'s steps with Mark done and
 * Couldn't do it; an `answer`'s fields, filled in part or whole, or its
 * Answer; each attaches its answer to the reply rather than sending it, and
 * a press pressed again takes it off. Answered, it leaves the agent's
 * message for the reply that answered it, or says "Answered" alone where
 * that reply is no longer read; replaced, it keeps its controls as it
 * offered them, stepped back to the muted ink and taking nothing, over a
 * pill saying a newer question, or message, replaced it; withdrawn, the
 * same over a pill saying so and its why as a muted sentence, or who closed
 * the item. An ask of a type this build does not know, one a newer service
 * wrote, is drawn as a line naming a newer Luke, so the rest still reads.
 *
 * The draft reply is the reader's chip, "You" and nothing after it, over
 * the agent composer's box, its card and its field, with its `@` mentions,
 * its skills, and its microphone (`inbox-answer-box.tsx`), flowing at the
 * thread's end rather than docked under it, and a notice's Send reads "Got
 * it" until a word is written. The draft reply ends a settled item's
 * thread too. The board is a log, as an agent's transcript is: each item opens
 * at its newest message, the draft reply just over the board's foot, and
 * keeps to it as messages land while the reader is there; scrolled up, the
 * transcript's way back to the newest line floats over the foot; and the
 * reader's own message, sent while scrolled up, is scrolled into view as it
 * lands, the draft under it. The pane's bar is its path, task › agent, each
 * crumb drawn as its tab in the task's column, opening what it names and
 * hanging the card its sidebar row or tab hangs, after a way back to the
 * list where the item stands alone, and nothing else that opens the agent,
 * since its name does. Wherever the thread names the agent, the name is
 * the agent's own reference (`agent-ref.tsx`): its tab's card on hover, its
 * tab on a press, an archived agent's card saying so. Every time shows its
 * moment in the shared tooltip, and an agent this window does not list, one
 * started on another Mac, still leads with a glyph. The pane shows words an
 * agent wrote and pictures of what it rendered, so its thread is out of the
 * session recording (`ph-no-capture`), and the viewer, drawn over the
 * window outside it, is out of it on its own.
 *
 * Words selected anywhere in the thread but the draft reply stand Reply
 * over them, as an agent's words do in its tab (`reply-to-selection.tsx`):
 * its title, the agent's words and a member's, an answer's picks, ticks,
 * and values, and the lines saying what became of an ask. A press lays
 * them into the box as a quote block, so a reply can answer the thread
 * point by point. Reply stands only while the box takes a quote: never
 * while a send is out, a dictation holds the box, or its editor is still
 * loading (`inbox-answer-box.tsx`).
 */

/** Where the way back from an item standing alone leads, as its hint names it. */
const INBOX_PLACE = "inbox";

/**
 * A link block, drawn as a link alone in its paragraph of the item's own words is: the card of what it names where it earns one (`lone-link-card.tsx`), else its chip. Note that it is handed to the words as a markdown link, because that one path is what gives a link its mark, its live label, its card, and the door it opens; an address that opens nowhere keeps its label with the address beside it to copy.
 */
export function LinkBlock({ url, label }: { url: string; label: string }): React.JSX.Element {
  if (opensAsLink(url)) {
    return (
      <div className="m-0 select-text">
        <TranscriptWords text={markdownLink(label, url)} asDocument />
      </div>
    );
  }
  return (
    <div className="m-0 select-text">
      <Tooltip label={url}>
        <span className={INERT_LINK_CLASS}>
          {label} <span className="select-text text-muted-foreground">{url}</span>
        </span>
      </Tooltip>
    </div>
  );
}

/** How a number key picks an open item's option: the draft after the option numbered is picked, or none where it has none. */
type NumberedPick = (draft: InboxDraft, number: number) => InboxDraft | undefined;

/** How the number keys pick an open item's options, its thread's open `decide`'s, or none where it has none they pick. */
function numberedPickOf(thread: readonly InboxMessage[]): NumberedPick | undefined {
  const ask = openAskOf(thread)?.ask;
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  return (draft, number) => askNumberedPick(ask, draft, number);
}

/**
 * The number keys pick an open item's options, its thread's open `decide`'s, 1 the first, as a press on
 * the option would, and take the keyboard to it, wherever in the Inbox the
 * developer stands but a field or an editor, whose keys are its own, and
 * never under a dialog. Note that the keys are heard on the document,
 * because a reader stepping the list with J and K holds the keyboard on its
 * row rather than in the pane.
 */
function useOptionNumbers(
  pane: React.RefObject<HTMLElement | null>,
  item: InboxItem,
  draft: InboxDraft,
  control: TaskInboxControl,
  pick: NumberedPick | undefined,
): void {
  const latest = useRef({ item, draft, control, pick });
  latest.current = { item, draft, control, pick };
  const numbered = pick !== undefined;
  useEffect(() => {
    if (!numbered) return;
    const onKey = (event: KeyboardEvent) => {
      const { item, draft, control, pick } = latest.current;
      const shown = pane.current;
      if (!OPTION_NUMBER.test(event.key) || !bareKey(event) || event.shiftKey) return;
      if (event.defaultPrevented || event.isComposing || takesTyping(event.target)) return;
      if (
        shown === null ||
        shown.hidden ||
        document.querySelector('[aria-modal="true"]') !== null
      ) {
        return;
      }
      const inbox = shown.parentElement;
      const from = event.target;
      if (from !== document.body && !(from instanceof Node && inbox?.contains(from) === true))
        return;
      const number = Number(event.key);
      // Note that a number picks only an option drawn, never one stepped aside while the box starts a new thread.
      const row = optionRows(shown)[number - 1];
      if (row === undefined) return;
      const picked = pick?.(draft, number);
      if (picked === undefined) return;
      event.preventDefault();
      control.onDraft(item, picked);
      row.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [numbered, pane]);
}

/** What the draft reply's head names the reader by, where nothing else names them. */
const DRAFT_HEAD = {
  YOU: "You",
} as const;

/** The reader as the window draws them: as the workspace's members list them, else as their account signs in, else by their id alone. */
function useReader(readerId: string | undefined): Actor {
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const { members } = useMemberDirectory();
  const member = members?.find((each) => each.userId === readerId);
  if (member !== undefined) return memberActor(member, readerId);
  if (account?.status === ACCOUNT_STATUS.SIGNED_IN) return accountActor(account);
  // Note that a reader known by their id alone is still drawn as a person, by the words the head names them with.
  if (readerId !== undefined) {
    return { kind: ACTOR_KIND.PERSON, userId: readerId, name: DRAFT_HEAD.YOU, you: true };
  }
  return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };
}

/**
 * The reader's reply not yet sent, as the thread's last comment, drawn as
 * a member's is: headed by the reader's own chip, "You", with nothing after
 * it, and the box under it, so what is sent drops into the thread in its
 * place and the box stands at the end again, as an issue's thread is
 * written on.
 */
function DraftReply({
  readerId,
  children,
}: {
  readerId: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const reader = useReader(readerId);
  return (
    <InboxComment
      kind={COMMENT.DRAFT}
      author={commentAuthor(reader)}
      nameRef={<ActorRef actor={reader} nameOnly />}
    >
      {children}
    </InboxComment>
  );
}

/** What a reply on its way says at its head's end. */
const SENDING = "Sending";

/**
 * The reader's plain reply on its way, as the thread's last message before
 * the draft reply: drawn as the reader's own message is, its files going
 * up, and "Sending" at its head's end, until the item holds it, when the
 * message it became stands in its place.
 */
function PendingReply({
  readerId,
  reply,
  now,
}: {
  readerId: string | undefined;
  reply: PendingInboxReply;
  now: number;
}): React.JSX.Element {
  const reader = useReader(readerId);
  return (
    <InboxComment
      kind={COMMENT.MESSAGE}
      author={commentAuthor(reader)}
      nameRef={<ActorRef actor={reader} nameOnly />}
      at={reply.at}
      now={now}
      trailing={
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {SENDING}
        </Text>
      }
    >
      {reply.attachments.length === 0 ? null : (
        <AttachedFileChips files={attachmentChips(reply.attachments)} uploading />
      )}
      {reply.text === "" ? null : (
        <div
          className="inbox-message-words m-0 leading-reading select-text"
          data-inbox-message-text=""
        >
          <SentWords text={reply.text} asDocument />
        </div>
      )}
    </InboxComment>
  );
}

/** No messages, one array so an item nobody wrote on hands down the same one. */
const NO_MESSAGES: readonly InboxMessage[] = [];

/**
 * A form's values as a member filled them, one a line in the form's order:
 * each field's name, then what was put in it, a text field's words drawn as
 * the agent's tab draws a sent message, so a mention they hold is its chip,
 * and any other field's value in its words, "yes" or "no" for a yes or no.
 */
function AnswerValues({
  values,
  texts,
}: {
  values: readonly InboxFormValue[];
  /** The labels of the form's text fields. */
  texts: ReadonlySet<string>;
}): React.JSX.Element | null {
  if (values.length === 0) return null;
  return (
    <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.TIGHT} className="inbox-values" data-inbox-values="">
      {values.map(({ label, value }) => (
        <li
          key={label}
          className="inbox-value flex min-w-0 flex-wrap items-baseline gap-x-control-gap gap-y-list-gap"
        >
          <span className="inbox-value-label min-w-0 max-w-full flex-none text-muted-foreground wrap-anywhere">
            {label}
          </span>
          <div className="inbox-value-words m-0 min-w-0 flex-[1_1_16ch] wrap-anywhere select-text">
            {texts.has(label) && isWireString(value) ? (
              <SentWords text={value} />
            ) : (
              fieldValueWords(value)
            )}
          </div>
        </li>
      ))}
    </Stack>
  );
}

/** Where a thread read carries only its latest messages: a line saying the earlier ones stand in the agent's tab, the agent's name opening it. */
function EarlierMessages({ by }: { by: ItemAgent }): React.JSX.Element {
  return (
    <li
      className="inbox-thread-earlier relative pb-luke-20 pl-inbox-earlier text-caption-inline text-muted-foreground before:absolute before:top-0 before:-bottom-inbox-face-half before:left-inbox-line before:w-luke-2 before:bg-border before:content-['']"
      data-inbox-earlier=""
    >
      <ActorLine>
        {"Earlier messages are in "}
        <AgentName by={by} />
        {"’s tab"}
      </ActorLine>
    </li>
  );
}

/** The reader's draft reply at the thread's end, where the box stands. */
function draftReplyOf(scroller: HTMLElement): Element | null {
  return scroller.querySelector('[data-inbox-comment="draft"]');
}

/** How far the scroller's foot stands in from its edge: its scroll padding, which clears the fade over it. */
function footPadding(scroller: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(scroller).scrollPaddingBottom) || 0;
}

/**
 * Scrolls the board to a message of the reader's own the moment it lands
 * on the thread, inside the board's own scroller, since the pane may still
 * be sliding in (`AGENTS.md`'s panel motion): far enough that the draft
 * reply under it, the box written in again, stands whole over the board's
 * foot, and no further than the message's head. A message another wrote,
 * or another item opened, scrolls nothing. Note that a reader already at
 * the thread's end is kept there by the log itself (`Conversation`), whose
 * observer has the last word once the thread's new height is reported, so
 * this is what brings the message in for a reader scrolled up, whom the
 * log leaves where they are; the two never pull different ways for long,
 * since a scroll that lands at the end hands the thread back to the log.
 */
function useScrollToOwnMessage(
  board: React.RefObject<HTMLDivElement | null>,
  item: InboxItem,
  readerId: string | undefined,
): void {
  const last = item.thread?.at(-1);
  const own =
    last !== undefined &&
    last.author === INBOX_MESSAGE_AUTHOR.MEMBER &&
    readerId !== undefined &&
    last.member?.userId === readerId;
  const seen = useRef({ itemId: item.id, lastId: last?.id });
  useLayoutEffect(() => {
    const was = seen.current;
    seen.current = { itemId: item.id, lastId: last?.id };
    const scroller = board.current;
    if (!own || scroller === null || was.itemId !== item.id || was.lastId === last?.id) return;
    const comment = scroller.querySelector(`[data-message-id="${CSS.escape(last.id)}"]`);
    if (comment === null) return;
    const room = scroller.getBoundingClientRect();
    const head = comment.getBoundingClientRect().top;
    const foot = (draftReplyOf(scroller) ?? comment).getBoundingClientRect().bottom;
    const under = foot - (room.bottom - footPadding(scroller));
    if (under > 0) scroller.scrollTop += Math.min(under, head - room.top);
  }, [board, item.id, last, own]);
}

/** What an ask's box says where its type is one this build does not know. */
const NEWER_LUKE_ASK = "Answer this in a newer Luke.";

/**
 * Who an open ask waits on where that is a teammate (`inboxWaitsOn`): its
 * task's assignee, else the one who started its agent, in the muted ink, as the list's Waiting on others does,
 * though any member may still answer. Where the item is the reader's
 * (`readersItem`) it draws nothing: the draft reply under the thread,
 * holding the ask's controls, already says the answer is theirs.
 */
function Waiting({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element | null {
  const starter = usePerson(on);
  if (on === undefined) return null;
  return (
    <span className="inbox-waiting-on text-muted-foreground" data-inbox-waiting="">
      Waiting on {actorName(starter, { sentence: true })}
    </span>
  );
}

/**
 * What ends an agent's message whose ask was replaced: by a newer question
 * where a later message of the agent's on the thread asks one, and by a
 * newer message otherwise, as a post that asks nothing replaces the ask
 * it posts over.
 */
const REPLACED = {
  BY_QUESTION: "Replaced by a newer question",
  BY_MESSAGE: "Replaced by a newer message",
} as const;

/**
 * What ends an agent's message whose ask of words alone was answered, where
 * the thread read carries the reply: a small pill saying "Answered", with
 * no card, the reply's words being the answer.
 */
function AnsweredMarker(): React.JSX.Element {
  return (
    <span data-inbox-settled="answered">
      <Badge tone={STATUS_TONE.COMPLETE} icon={<CheckIcon aria-hidden="true" />}>
        {ANSWERED}
      </Badge>
    </span>
  );
}

/**
 * What ends an agent's message whose ask was replaced or withdrawn: its
 * controls as it offered them (`HeldControls`), stepped back to the muted
 * ink (`SteppedBack`), nothing picked and taking nothing, so what it used to
 * ask still reads in the thread and never as an answer, then `marker`, the
 * small pill saying what became of it, where one says it. An `answer` of words
 * alone, which has no controls, ends with the pill alone, as does a to-do
 * naming no steps, whose one step was the item's title as it stood then,
 * which a later post may have renamed.
 */
function HeldAsk({
  ask,
  title,
  marker,
}: {
  ask: InboxKnownAsk;
  /** The item's title, which stands as the one step of a to-do that names none. */
  title: string;
  /** What became of it; none where the thread says so in a line of its own (`ResolvedEvent`). */
  marker: React.JSX.Element | null;
}): React.JSX.Element | null {
  // A to-do naming no steps draws the item's title as its one step, and a later post may have renamed the item since, so the title it drew then is not known.
  if (!hasControls(ask) || (ask.type === INBOX_ASK.DO && ask.steps.length === 0)) return marker;
  return (
    <div
      className="inbox-ask-replaced flex min-w-0 flex-col gap-control-gap"
      data-inbox-replaced=""
    >
      <div
        className="inbox-ask-replaced-controls flex min-w-0 flex-col gap-block-gap"
        aria-disabled="true"
      >
        <SteppedBack>
          <HeldControls ask={ask} title={title} draft={EMPTY_INBOX_DRAFT} />
        </SteppedBack>
      </div>
      {marker}
    </div>
  );
}

/**
 * The pill ending a replaced ask's message: a newer question replaced it
 * where a later message of the agent's on the thread asks one, and a newer
 * message otherwise.
 */
function ReplacedMarker({
  message,
  thread,
}: {
  message: InboxMessage;
  thread: readonly InboxMessage[];
}): React.JSX.Element {
  const at = thread.findIndex((said) => said.id === message.id);
  const asked = thread
    .slice(at + 1)
    .some((said) => said.author === INBOX_MESSAGE_AUTHOR.AGENT && said.ask !== undefined);
  return (
    <span data-inbox-settled="replaced">
      <Badge>{asked ? REPLACED.BY_QUESTION : REPLACED.BY_MESSAGE}</Badge>
    </span>
  );
}

/**
 * Whether a member resolved the item without an answer while that close
 * stands, as its row's card says it (`inboxSettledStanding`), which the
 * thread says in a line of its own among its messages (`ResolvedEvent`).
 */
function resolvedByMember(item: InboxItem): boolean {
  return inboxSettledStanding(item) === INBOX_SETTLED_STANDING.RESOLVED;
}

/**
 * What ends a withdrawn ask's message: the pill saying it was withdrawn,
 * and why its agent took it back as a muted sentence under the pill, so a
 * long why reads as words rather than wrapping inside it. Where no reason
 * was said a member closed the item without answering, which the thread's
 * own line says while the close stands (`ResolvedEvent`), so the pill says
 * so only where that line is not drawn.
 */
function WithdrawnMarker({
  resolved,
  reason,
}: {
  /** Whether a member resolved the item without an answer while that close stands (`resolvedByMember`). */
  resolved: boolean;
  reason: string | undefined;
}): React.JSX.Element | null {
  if (reason === undefined && resolved) return null;
  return (
    <div
      className="inbox-ask-withdrawn flex min-w-0 flex-col items-start gap-tight-gap"
      data-inbox-settled="withdrawn"
    >
      <Badge>
        <WithdrawnWords reason={reason} />
      </Badge>
      <WithdrawnWhy reason={reason} />
    </div>
  );
}

/**
 * Where the line saying a member resolved the item stands among its
 * messages: after the last one written by the time of the close, since a
 * settled item still takes messages, or at the thread's end where that time
 * is not known; -1 before every message read, and none where no member's
 * close stands.
 */
function resolvedAfter(item: InboxItem, thread: readonly InboxMessage[]): number | undefined {
  if (!resolvedByMember(item)) return undefined;
  const settled = item.settledAt;
  if (settled === undefined) return thread.length - 1;
  return thread.findLastIndex((message) => message.createdAt <= settled);
}

/** What a member resolving the item says after their name. */
const RESOLVED_IT = "resolved this without an answer";

/**
 * A member resolving the item without an answer, as a line of the thread
 * where they did (`resolvedAfter`), drawn as a plan comment's "resolved this" is: their
 * face on the gutter's line, their name, what they did, and when.
 */
function ResolvedEvent({ item, now }: { item: InboxItem; now: number }): React.JSX.Element {
  const closer = usePerson(item.closedBy);
  return (
    <InboxComment
      kind={COMMENT.CLOSED}
      author={commentAuthor(closer)}
      nameRef={<ActorRef actor={closer} nameOnly />}
      said={RESOLVED_IT}
      at={item.settledAt}
      now={now}
    />
  );
}

/**
 * The small pill that ends the agent's message while what it asks waits on
 * a teammate: "Waiting on" them, after a dot in the muted ink. Where it
 * waits on the reader it draws nothing, the draft reply at the thread's
 * end (`DraftReply`) holding its controls saying so already.
 */
function AskMarker({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element | null {
  const starter = usePerson(on);
  if (on === undefined) return null;
  return <WaitingMarker on={actorName(starter, { sentence: true })} />;
}

/**
 * The box closing a message that asks: while it waits, a marker alone
 * saying which teammate it waits on (`AskMarker`), or nothing where it
 * waits on the reader, its controls standing in the draft reply; once answered, nothing, the card standing at the head
 * of the reply that answered it (`AnsweredCard`), or, for an ask of words
 * alone, which draws no card, a small "Answered" marker (`AnsweredMarker`);
 * a card saying
 * "Answered" alone where the thread read no longer carries that reply; for
 * a replaced ask, no card, its controls as it offered them, stepped back,
 * over a small marker saying a newer question, or message, replaced it
 * (`HeldAsk`); for a withdrawn one the same, over a marker saying so and
 * why, or with none where a member's close stands, which the thread's own
 * line says (`ResolvedEvent`); and an ask this build does not know a card
 * naming a newer Luke.
 */
function AskBox({
  title,
  resolved,
  message,
  ask,
  thread,
  waitingOn,
}: {
  /** The item's title, as `cardTitle` reads it. */
  title: string;
  /** Whether a member resolved the item without an answer while that close stands (`resolvedByMember`). */
  resolved: boolean;
  message: InboxMessage;
  ask: InboxReadAsk;
  thread: readonly InboxMessage[];
  /** The teammate the ask waits on while open; none where it waits on the reader. */
  waitingOn: InboxItem["startedBy"];
}): React.JSX.Element | null {
  if (!knownAsk(ask)) {
    return (
      <div className={INBOX_ASK_BOX} data-inbox-ask="newer">
        <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
          <CardHead>
            <Text tone={TEXT_TONE.MUTED}>{NEWER_LUKE_ASK}</Text>
            {ask.status === INBOX_ASK_STATUS.OPEN ? <Waiting on={waitingOn} /> : null}
          </CardHead>
        </Card>
      </div>
    );
  }
  if (ask.status === INBOX_ASK_STATUS.REPLACED) {
    return (
      <HeldAsk
        ask={ask}
        title={title}
        marker={<ReplacedMarker message={message} thread={thread} />}
      />
    );
  }
  if (ask.status === INBOX_ASK_STATUS.WITHDRAWN) {
    return (
      <HeldAsk
        ask={ask}
        title={title}
        marker={<WithdrawnMarker resolved={resolved} reason={ask.withdrawnReason} />}
      />
    );
  }
  if (ask.status === INBOX_ASK_STATUS.OPEN) {
    return <AskMarker on={waitingOn} />;
  }
  // The card goes with the reply that answered it, wherever the thread read still carries that reply.
  const answered = ask.status === INBOX_ASK_STATUS.ANSWERED;
  if (answered && answerOf(thread, message.id)?.answers !== undefined) {
    // An answer of words alone draws no card, so its marker says here that it was answered.
    return ask.type === INBOX_ASK.ANSWER && ask.fields === undefined ? <AnsweredMarker /> : null;
  }
  return (
    <div className={INBOX_ASK_BOX} data-inbox-ask={ask.status}>
      <Card look={CARD_LOOK.RAISED} padding={CARD_PADDING.FLUSH}>
        <CardHead>
          <span className={INBOX_ASK_KIND}>{askHeadWords(ask, undefined)}</span>
          <span className={INBOX_ASK_STANDING}>
            <CheckIcon aria-hidden="true" />
            {ANSWERED}
          </span>
        </CardHead>
      </Card>
    </div>
  );
}

/** The ask a message's answer answers, where the thread read still carries it. */
function answeredAsk(
  thread: readonly InboxMessage[],
  answers: InboxAnswers,
): InboxReadAsk | undefined {
  return thread.find((message) => message.id === answers.ask)?.ask;
}

/** No text fields' labels, for values whose ask this build cannot read, so none is known to be a text field. */
const NO_TEXT_LABELS: ReadonlySet<string> = new Set();

/**
 * One message of the thread, a Markdown document, as its
 * writer's comment: a member by their face and name, the agent by its tile
 * and name and a quiet "agent" after it, then when. An answer leads with
 * the card of the ask it answered, filled in as it was answered
 * (`AnsweredCard`), or, where the thread read no longer carries that ask,
 * its stamp and its values listed; then its words, the agent's drawn as its
 * question's are and a member's as a sent message's, and the files it
 * carried after them, a picture its words draw standing there alone;
 * an agent's message that asks ends with its ask's box, a marker alone
 * while it waits, until it is answered. It is drawn again only where it is
 * handed another prop (`memo`), each the part of the item it draws, so a
 * change to the item that leaves the message as it was, as marking it read
 * does, draws none of the thread's messages again.
 */
const ThreadMessage = memo(function ThreadMessage({
  itemId,
  title,
  threadAddressedTo,
  resolved,
  message,
  thread,
  by,
  now,
  images,
  waitingOn,
}: {
  itemId: string;
  /** The item's title, as `cardTitle` reads it. */
  title: string;
  /** The member the item's agent addressed its thread to (`inboxAddressedTo`), which an open ask from before messages kept their own addressee is addressed to. */
  threadAddressedTo: InboxItem["waitsOn"];
  /** Whether a member resolved the item without an answer while that close stands (`resolvedByMember`). */
  resolved: boolean;
  message: InboxMessage;
  thread: readonly InboxMessage[];
  by: ItemAgent;
  now: number;
  images: InboxImageReads;
  waitingOn: InboxItem["startedBy"];
}): React.JSX.Element {
  const writer = useMessageWriter(message, by);
  const answers = message.answers;
  // Note that an open ask from before messages kept their own addressee is addressed as its thread is.
  const addressedTo =
    message.addressedTo ??
    (message.ask?.status === INBOX_ASK_STATUS.OPEN ? threadAddressedTo : undefined);
  const answered = answers === undefined ? undefined : answeredAsk(thread, answers);
  return (
    <InboxComment
      kind={COMMENT.MESSAGE}
      messageId={message.id}
      author={writer.author}
      nameRef={writer.nameRef}
      at={message.createdAt}
      now={now}
      trailing={addressedTo === undefined ? undefined : <AddressedTo to={addressedTo} />}
    >
      {answers === undefined ? null : answered !== undefined && knownAsk(answered) ? (
        <AnsweredCard ask={answered} title={title} answers={answers} />
      ) : (
        <>
          {/* Where the thread read no longer carries the ask, or this build does not know it, the answer is its stamp and its values listed. */}
          <InboxStamp stamp={sentStamp(answers, answered)} />
          <AnswerValues values={answers.values ?? []} texts={NO_TEXT_LABELS} />
        </>
      )}
      <MessageWords itemId={itemId} message={message} images={images} />
      {message.ask === undefined ? null : (
        <AskBox
          title={title}
          resolved={resolved}
          message={message}
          ask={message.ask}
          thread={thread}
          waitingOn={waitingOn}
        />
      )}
    </InboxComment>
  );
});

/** No groups over the item's own. */
const NO_LEAD: readonly MenuAction[][] = [];

/** What a phone's item offers in its ⋯ over the item's own actions, past the bar's buttons it stands for. */
export interface InboxPanePhone {
  /** Opens the side panel beside the item, which the title bar's toggle opens elsewhere; none while it is open or where there is none. */
  readonly onShowPanel: (() => void) | undefined;
}

/**
 * What a phone's ⋯ leads with, in place of what the wide bar draws as
 * buttons and crumbs: the pager's steps, then what the crumbs open, the
 * item's task or automation and its agent, then the side panel.
 */
function phoneItemGroups(
  holder: InboxHolder,
  by: ItemAgent,
  doors: InboxPaneDoors,
  pager: InboxPager | undefined,
  phone: InboxPanePhone,
): MenuAction[][] {
  const steps: MenuAction[] =
    pager === undefined || (pager.onPrevious === undefined && pager.onNext === undefined)
      ? []
      : [
          {
            label: "Previous inbox item",
            icon: <ChevronUpIcon />,
            disabled: pager.onPrevious === undefined,
            onSelect: () => pager.onPrevious?.(),
            command: APP_COMMAND.PREVIOUS_INBOX_ITEM,
          },
          {
            label: "Next inbox item",
            icon: <ChevronDownIcon />,
            disabled: pager.onNext === undefined,
            onSelect: () => pager.onNext?.(),
            command: APP_COMMAND.NEXT_INBOX_ITEM,
          },
        ];
  const { onOpenHolder } = doors;
  const holderItem: MenuAction[] =
    onOpenHolder === undefined
      ? []
      : holder.kind === INBOX_HOLDER.TASK
        ? [
            {
              label: OPEN_TASK,
              detail: holder.task.name,
              icon: tabLook({
                kind: TAB_KIND.PLAN,
                name: holder.task.name,
                status: holder.task.status,
              }).icon,
              onSelect: onOpenHolder,
              command: APP_COMMAND.OPEN_IN_TASK,
            },
          ]
        : [
            {
              label: OPEN_AUTOMATION,
              detail: holderName(holder),
              icon: <ZapIcon />,
              onSelect: onOpenHolder,
            },
          ];
  // ⌘O opens the item's task, or its agent where no task holds it (`desktop-inbox.tsx`).
  const agentItem: MenuAction = {
    label: OPEN_AGENT,
    detail: by.subject.name,
    icon: <BotIcon />,
    onSelect: by.onOpen,
    ...(holder.kind === INBOX_HOLDER.TASK ? {} : { command: APP_COMMAND.OPEN_IN_TASK }),
  };
  const panel: MenuAction[] =
    phone.onShowPanel === undefined
      ? []
      : [{ label: "Show panel", icon: <SidePanelIcon />, onSelect: phone.onShowPanel }];
  return [steps, [...holderItem, agentItem], panel].filter((group) => group.length > 0);
}

/** What a phone's ⋯ calls the crumbs' presses. */
const OPEN_TASK = "Open task";
const OPEN_AUTOMATION = "Open automation";
const OPEN_AGENT = "Open agent";

/** What the pane's ⋯ menu is called, which is its tooltip too, as the item's row names its own. */
const ITEM_THING = "Inbox item";

/**
 * The item's ⋯ menu at the end of the pane's bar, as an issue's page and an
 * agent's tab end theirs, offering what the item's row's menu offers in the
 * same order (`inbox-item-actions.tsx`): Copy link, the item's link under its
 * agent; Mark as read or unread, naming U; Move to channel…; and, while the
 * item is open, Resolve without answering, asked first. It is keyed by its
 * item where it is drawn, so a question asked on one item never closes the
 * next, and the menu and the question go with the pane once it is hidden.
 */
function InboxItemMenu({
  item,
  shown,
  onMark,
  onMove,
  onClose,
  lead = NO_LEAD,
  heading,
}: {
  item: InboxItem;
  shown: boolean;
  onMark: InboxPaneDoors["onMark"];
  onMove: InboxPaneDoors["onMove"];
  onClose: InboxCloser | undefined;
  /** Groups over the item's own, as a phone's head leads its ⋯ with what its bar drew as buttons (`phoneItemGroups`); none elsewhere. */
  lead?: readonly MenuAction[][];
  /** Muted over the items, pressed by nothing: where the item stands in the list, on a phone. */
  heading?: React.ReactNode;
}): React.JSX.Element | null {
  const menu = useMenu(shown);
  const close = useInboxClose(item, onClose, shown);
  const { groups: itemGroups } = useInboxItemActions(item, {
    onMark,
    onMove,
    onAskClose: close.ask,
    keyed: true,
  });
  const groups = itemGroups(lead);
  if (groups.length === 0) return null;
  return (
    <>
      <MoreButton thing={ITEM_THING} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(ITEM_THING)}
          menu={menu.drawn}
          heading={heading}
          groups={groups}
          onClose={menu.close}
        />
      )}
      {close.dialog}
    </>
  );
}

/**
 * The open question's ×, at its card's top end: Resolve without answering,
 * asked first, as the item's ⋯ offers it (`inbox-close.tsx`). It is keyed by
 * its item where it is drawn, so a question asked on one item never closes
 * the next.
 */
function QuestionClose({
  item,
  closer,
  shown,
}: {
  item: InboxItem;
  closer: InboxCloser | undefined;
  shown: boolean;
}): React.JSX.Element {
  const close = useInboxClose(item, closer, shown);
  return (
    <>
      {close.action === undefined ? null : (
        <Tooltip label={close.action.label}>
          <IconButton
            icon={close.action.icon}
            label={close.action.label}
            size={BUTTON_SIZE.COMPACT}
            onClick={close.action.onSelect}
          />
        </Tooltip>
      )}
      {close.dialog}
    </>
  );
}

/**
 * The thread's subject, as a plan or a pull request leads with one: the
 * item's title alone, the thread under it, its words quoted into a reply
 * as the thread's are.
 */
function Subject({
  item,
  heading,
  first,
}: {
  item: InboxItem;
  /** Takes the title's heading, which the bar watches scroll away (`useHeadingAway`). */
  heading: (element: HTMLElement | null) => void;
  /** Whether it is the page's first heading, as on a phone, whose bar names what holds the item and whose list is not drawn beside it. */
  first: boolean;
}): React.JSX.Element {
  return (
    <header
      className="inbox-subject flex flex-col gap-tight-gap border-b border-border pb-block-gap"
      {...{ [REPLY_SCOPE]: "" }}
    >
      <Text
        as={first ? TEXT_ELEMENT.H1 : TEXT_ELEMENT.H2}
        variant={TEXT_VARIANT.DIALOG}
        ref={heading}
        className="inbox-subject-title"
        data-inbox-title=""
      >
        {cardTitle(item.title)}
      </Text>
    </header>
  );
}

/**
 * Whether the item's heading has scrolled up out of the thread's view, as
 * the thread's scroller reports it, so the bar names the item in its place.
 * Note that a heading the pane does not draw, its list standing alone in its
 * place, has not scrolled away, and that another item opens with its own
 * heading in view until its scroller says otherwise.
 */
function useHeadingAway(
  board: React.RefObject<HTMLElement | null>,
  heading: HTMLElement | null,
  itemId: string,
): boolean {
  const [away, setAway] = useState<{ readonly itemId: string; readonly away: boolean }>({
    itemId,
    away: false,
  });
  useEffect(() => {
    const scroller = board.current;
    if (scroller === null || heading === null || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const seen = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry === undefined) return;
        const top = entry.rootBounds?.top ?? 0;
        setAway({
          itemId,
          away: !entry.isIntersecting && entry.boundingClientRect.bottom <= top,
        });
      },
      { root: scroller },
    );
    seen.observe(heading);
    return () => seen.disconnect();
  }, [board, heading, itemId]);
  return away.itemId === itemId && away.away;
}

/** The box's mentions where the pane is handed them; the page's own where it is not. */
function AnswerMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <TaskMentions value={value}>{children}</TaskMentions>;
}

/** The words a dictation into an item's box is likely to say: its repository's, its title's, and its thread's. */
function answerKeywords(holder: InboxHolder, item: InboxItem): readonly string[] {
  const repository =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : holder.agent.repository;
  const body = (item.thread ?? []).map((message) => message.text).join("\n");
  return dictationKeywords({ repository, title: item.title, body });
}

/** What the pane's crumbs open, and the cards they hang. */
export interface InboxPaneDoors {
  /** Opens what holds the item: its task, or its automation's page; nothing where there is none to open. */
  readonly onOpenHolder: (() => void) | undefined;
  /** The task's hover card, as its sidebar row hangs it; none for an automation. */
  readonly taskCard: React.ReactNode;
  /** Opens the agent's tab on its task. */
  readonly onOpenAgent: (agentId: string) => void;
  readonly code: InboxCodeDoors;
  /** Marks the item read or unread, from the bar's ⋯ menu; none where the pane offers no mark. */
  readonly onMark?: ((item: InboxItem, unread: boolean) => void) | undefined;
  /** Closes an open item without an answer, from the bar's ⋯ menu; none where the pane offers no close. */
  readonly onClose?: InboxCloser | undefined;
  /** Asks which channel the item's thread moves to, from the bar's ⋯ menu; none where Channels is off. */
  readonly onMove?: ((item: InboxItem) => void) | undefined;
}

/** What starts a new thread from an item's box instead of a reply, where the page offers one. */
export interface InboxNewThread {
  /** The channel the item stands in, which a thread started from it lands in; none where the window lists no channels. */
  readonly channelOf: (item: InboxItem) => Channel | undefined;
  /** The workspace whose channels those are, whose members name a channel's maker on its card. */
  readonly workspaceId: string | undefined;
  /** Starts a thread with the item's agent, in the item's channel, and opens it; answers why it did not start, or nothing once it did. */
  readonly onStart: (item: InboxItem, start: NewThreadStart) => Promise<string | undefined>;
}

/**
 * The box's new thread for one item: the item's agent's chip, wearing its
 * tile as a mention of the agent does, and its channel's chip, each hanging
 * its card and opening nothing, since a press on the checkbox's words ticks it.
 */
function answerNewThread(offer: InboxNewThread, item: InboxItem, by: ItemAgent): AnswerNewThread {
  const { name, tile } = by.subject;
  const channel = offer.channelOf(item);
  return {
    agent: (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={<ActorMark actor={tile} size={ACTOR_SIZE.INLINE} />}
        label={name}
        card={<AgentCard subject={by.subject} models={by.models} />}
      />
    ),
    channel:
      channel === undefined ? undefined : (
        <InlineRef
          look={INLINE_REF_LOOK.PILL}
          glyph={<GLYPH.CHANNEL />}
          label={channel.name}
          card={<ChannelCard channel={channel} workspaceId={offer.workspaceId} />}
        />
      ),
    onStart: (start) => offer.onStart(item, start),
  };
}

/**
 * An automation's crumb, as its page's own look names it: its clock and its
 * name, hanging its card where the window reads it, and opening its page
 * where that can be opened.
 */
function useAutomationCrumb(
  holder: InboxHolder,
  onOpen: (() => void) | undefined,
): Crumb | undefined {
  const automationId = holderAutomationId(holder);
  const known = useAutomation(automationId ?? undefined);
  if (holder.kind !== INBOX_HOLDER.AGENT) return undefined;
  const name = holderName(holder);
  return {
    label: name,
    // Note that the agents no automation names stand under no automation, so their crumb wears the factory glyph, as their group's header does.
    glyph: <HolderGlyph holder={holder} />,
    hint: name,
    card:
      known === undefined ? undefined : (
        <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
      ),
    onPress: onOpen === undefined ? undefined : () => onOpen(),
  };
}

/**
 * The pane's path, task › agent, each crumb wearing its tab's glyph in the task's column,
 * the task's document glyph and the agent's mark: each opens what it names,
 * the task or the agent's tab, and hangs the card its sidebar row or tab
 * hangs. An agent with no task stands under the automation that started it
 * instead, by its clock and name, which hang its card and open the
 * automation's page where that can be opened, and are words alone where it
 * cannot. An agent this window
 * does not list, one started on another Mac, hangs a card saying so and
 * still opens its tab. Once the thread's heading has scrolled away, the
 * item's title joins the path as its last words, in the text's own ink, so
 * the bar still says what is read; it fades in as it comes and out as the
 * heading comes back, so the title never stands twice. A narrow bar cuts the
 * task's crumb short first, then the title, which fades out where it is cut
 * as every title does, and the agent's keeps its size.
 */
function Crumbs({
  holder,
  by,
  doors,
  title,
  titleShown,
}: {
  holder: InboxHolder;
  by: ItemAgent;
  doors: InboxPaneDoors;
  /** The item's title, as its heading reads it. */
  title: string;
  /** Whether the heading has scrolled away, so the path names the item. */
  titleShown: boolean;
}): React.JSX.Element {
  const automation = useAutomationCrumb(holder, doors.onOpenHolder);
  // Note that Luke stands under nothing but himself, so his path reads Luke › title rather than naming him twice.
  const operator = operatorHolder(holder);
  const crumbs: Crumb[] = [
    taskCrumb(holder, doors) ?? (operator ? undefined : automation),
    // Note that once the title joins the path the agent's crumb keeps its size, so a narrow bar cuts the task's crumb short first and then the title.
    agentCrumb(holder, by, titleShown),
    { label: title, current: true, shown: titleShown },
  ].filter((crumb) => crumb !== undefined);
  return (
    <div className="inbox-crumbs flex min-w-0 flex-initial">
      <Breadcrumbs label="Path" crumbs={crumbs} />
    </div>
  );
}

/** The path's task crumb, wearing its plan's glyph and hanging its card, which opens the task; none for an item no task holds. */
function taskCrumb(holder: InboxHolder, doors: InboxPaneDoors): Crumb | undefined {
  if (holder.kind !== INBOX_HOLDER.TASK) return undefined;
  const { onOpenHolder } = doors;
  return {
    label: holder.task.name,
    glyph: tabLook({ kind: TAB_KIND.PLAN, name: holder.task.name, status: holder.task.status })
      .icon,
    hint: holder.task.name,
    card: doors.taskCard,
    onPress: () => onOpenHolder?.(),
  };
}

/** The path's agent crumb, wearing its mark, or Luke's face for Luke's own, and hanging its card, which opens its tab; `fixed` keeps its size where the crumbs after it give way first. */
function agentCrumb(holder: InboxHolder, by: ItemAgent, fixed = false): Crumb {
  const { name, agent } = by.subject;
  const operator = operatorHolder(holder);
  return {
    label: name,
    glyph: operator ? <WingFace /> : tabLook({ kind: TAB_KIND.AGENT, name, agent }).icon,
    hint: name,
    card: <AgentCard subject={by.subject} models={by.models} />,
    onPress: () => by.onOpen(),
    fixed,
  };
}

/**
 * A phone's bar's name for the item: what holds it, its task as the wide
 * path leads with it, or its agent where no task holds it, each crumb
 * pressing where the wide path's does. Note that the bar never names the
 * item's title, because the thread's heading right under it already does.
 */
function PhoneHolder({
  holder,
  by,
  doors,
}: {
  holder: InboxHolder;
  by: ItemAgent;
  doors: InboxPaneDoors;
}): React.JSX.Element {
  return <Breadcrumbs label="Path" crumbs={[taskCrumb(holder, doors) ?? agentCrumb(holder, by)]} />;
}

/**
 * One item at reading size, as a comment thread: under the pane's crumbs,
 * the item's title alone as the thread's subject, then every message of
 * its thread, oldest first, a plain reply of the reader's on its way after
 * them (`PendingReply`), and the reader's draft reply at its end, the
 * open ask's controls standing in it.
 * Where the item stands alone, the whole Inbox wide, the crumbs follow a
 * way back to the list (`inbox-columns.ts`), its tooltip naming Back's
 * chord, which goes back as Escape does, and the bar ends in the pager,
 * "2 of 8" and the arrows up and down the list (`inbox-pager.tsx`).
 */
export function InboxPane({
  holder,
  item,
  control,
  agents,
  doors,
  hidden,
  onBack,
  pager,
  mentions,
  phone,
  channelName,
  newThread,
}: {
  /** What holds the item: its task, or the automation that started its agent with no task. */
  holder: InboxHolder;
  item: InboxItem;
  /** The live read of the item's task, or of its agent with no task, which answers it and holds its draft. */
  control: TaskInboxControl;
  agents: AgentsControl;
  doors: InboxPaneDoors;
  /** Whether the list stands alone in the item's place. */
  hidden: boolean;
  /** Goes back to the list, where the item stands alone. */
  onBack: (() => void) | undefined;
  /** Where the item stands in the list and the steps either side, drawn at the bar's end where the item stands alone among others. */
  pager: InboxPager | undefined;
  /** What the box's `@` offers where the page around the pane hands nothing, as the window's Inbox does; the page's own otherwise. */
  mentions?: TaskMentionsValue | undefined;
  /**
   * A phone's head (`phone-head.tsx`), where the item stands alone on a
   * phone: the way back's glyph, what holds the item centred (`PhoneHolder`), and one ⋯
   * holding the pager, what the crumbs open, the panel, and the item's own
   * actions; none elsewhere, where the bar draws its crumbs and buttons.
   */
  phone?: InboxPanePhone | undefined;
  /** The channel the Inbox is narrowed to, by name, which the way back to the list names; none where it lists every channel. */
  channelName?: string | undefined;
  /** What the box's checkbox starts a new thread with instead of a reply; none where the page offers none. */
  newThread?: InboxNewThread | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const board = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const directory = useMemberDirectory();
  const readerId = directory.readerId ?? agents.me;
  useScrollToOwnMessage(board, item, readerId);
  const [heading, setHeading] = useState<HTMLElement | null>(null);
  const headingAway = useHeadingAway(board, heading, item.id);
  // A phone heads the item with its own row, the item standing alone in the list's place.
  const phoneHead = phone !== undefined && onBack !== undefined;
  // An open ask waits on its task's assignee, else whoever started its agent, as the list says, though any member may answer it.
  const waitingOn = readersItem(item, readerId) ? undefined : inboxWaitsOn(item);
  // Note that the agent and the pictures are handed to the thread's messages as the same objects while they say the same, so a message is drawn again only where it moved (`ThreadMessage`).
  const onOpenAgent = useSteadyDoor(() => doors.onOpenAgent(item.agentId));
  const { agents: listedAgents, archived, models, me, pullRequests } = agents;
  const by: ItemAgent = useMemo(
    () => ({
      subject: agentSubject(
        { agents: listedAgents, archived, models, me, pullRequests },
        item.agentId,
        NOTHING_HELD,
        false,
      ),
      models,
      onOpen: onOpenAgent,
    }),
    [listedAgents, archived, models, me, pullRequests, item.agentId, onOpenAgent],
  );
  const { images: pictures, onImage, onRetryImage } = control;
  const images: InboxImageReads = useMemo(
    () => ({ images: pictures, onImage, onRetryImage }),
    [pictures, onImage, onRetryImage],
  );
  const open = item.status === INBOX_STATUS.OPEN;
  const draft = control.draftOf(item);
  const thread = item.thread ?? NO_MESSAGES;
  const pending = pendingReplyOn(control.pendingReplies, item);
  const resolved = resolvedAfter(item, thread);
  useOptionNumbers(pane, item, draft, control, open ? numberedPickOf(thread) : undefined);
  const formText: FormTextDoors = {
    self: item.agentId,
    agent: by.subject.agent,
    skills: agents.readSkills,
    keywords: answerKeywords(holder, item),
    onEnter: () => sendFromPane(pane.current),
  };
  // Note that the item's words are read under its own workspace, its plan's or its agent's, never the one the Inbox lists, which may not be the item's.
  const workspaceId = itemWorkspaceId(holder);
  const onDraft = (next: InboxDraft) => control.onDraft(item, next);
  // The open ask's controls stand in the draft reply, over its note.
  const asking = openAskOf(thread);
  const openAsk = asking !== undefined && knownAsk(asking.ask) ? asking.ask : undefined;
  // Note that an ask of words alone has no controls, so the box stands plain and its words answer it.
  const wordsAlone = openAsk?.type === INBOX_ASK.ANSWER && openAsk.fields === undefined;
  const question =
    openAsk === undefined || wordsAlone ? undefined : (
      <DraftQuestion
        pane={pane}
        close={<QuestionClose key={item.id} item={item} closer={doors.onClose} shown={!hidden} />}
      >
        <AskControls
          ask={openAsk}
          title={cardTitle(item.title)}
          doors={{ draft, disabled: !open, text: formText, onDraft }}
        />
      </DraftQuestion>
    );
  // The box stands at the thread's end as the reader's draft reply.
  const draftReply = (
    <AnswerMentions value={mentions}>
      <DraftReply readerId={readerId}>
        <InboxAnswerBox
          item={item}
          readerId={readerId}
          control={control}
          agent={by.subject.agent}
          thread={thread}
          controls={question}
          skills={agents.readSkills}
          keywords={answerKeywords(holder, item)}
          replyScope={board}
          onUnarchiveAgent={() => agents.onArchive(item.agentId, false)}
          newThread={newThread === undefined ? undefined : answerNewThread(newThread, item, by)}
        />
      </DraftReply>
    </AnswerMentions>
  );
  return (
    <section
      ref={pane}
      className={INBOX_VIEW_ITEMS}
      aria-label={cardTitle(item.title)}
      hidden={hidden}
    >
      {phoneHead ? (
        <PhoneHead
          place="inbox-item"
          start={
            channelName === undefined ? (
              <BackButton label="Inbox" place={INBOX_PLACE} onBack={onBack} />
            ) : (
              <BackButton label={`#${channelName}`} place={`#${channelName}`} onBack={onBack} />
            )
          }
          title={<PhoneHolder holder={holder} by={by} doors={doors} />}
          end={
            <InboxItemMenu
              key={item.id}
              item={item}
              shown={!hidden}
              onMark={doors.onMark}
              onMove={doors.onMove}
              onClose={doors.onClose}
              lead={phoneItemGroups(holder, by, doors, pager, phone)}
              heading={
                pager?.count === undefined ? undefined : `${pager.count.at} of ${pager.count.total}`
              }
            />
          }
        />
      ) : (
        <Toolbar
          place="inbox-item"
          start={TOOLBAR_INSET.COLUMN}
          wrapHeading
          lead={
            onBack === undefined ? undefined : channelName === undefined ? (
              <BackButton label="Inbox" place={INBOX_PLACE} onBack={onBack} />
            ) : (
              <BackButton label={`#${channelName}`} place={`#${channelName}`} onBack={onBack} />
            )
          }
          title={
            <Crumbs
              holder={holder}
              by={by}
              doors={doors}
              title={cardTitle(item.title)}
              titleShown={headingAway}
            />
          }
          actions={
            <>
              {/* The bar ends in the pager, where the item stands alone, and the item's ⋯ menu. */}
              {pager === undefined ||
              (pager.onPrevious === undefined && pager.onNext === undefined) ? null : (
                <InboxPagerControls pager={pager} />
              )}
              <InboxItemMenu
                key={item.id}
                item={item}
                shown={!hidden}
                onMark={doors.onMark}
                onMove={doors.onMove}
                onClose={doors.onClose}
              />
            </>
          }
        />
      )}
      <Fill className="desktop-inbox">
        {/* The thread is a log as an agent's transcript is: each item opens at its newest message, the box at its end, and keeps to it while the reader is there; scrolled up, the way back floats over its foot. */}
        <Conversation subject={item.id} list={board}>
          <ConversationContent
            className={`inbox-board ${LOG_OVER_COMPOSER_CLASS} ph-no-capture flex flex-col pt-section-gap`}
          >
            {/* The item's words are drawn as documents: its own pictures read through the Inbox, and a link alone on its line as its card. */}
            <ItemWords itemId={item.id} workspaceId={workspaceId} images={images} code={doors.code}>
              <Subject item={item} heading={setHeading} first={phoneHead} />
              <Stack
                as={LAYOUT_ELEMENT.OL}
                gap={GAP.NONE}
                className={INBOX_THREAD}
                aria-label="Messages"
              >
                {resolved === -1 ? <ResolvedEvent item={item} now={now} /> : null}
                {thread.map((message, at) => (
                  <Fragment key={message.id}>
                    <ThreadMessage
                      itemId={item.id}
                      title={cardTitle(item.title)}
                      threadAddressedTo={inboxAddressedTo(item)}
                      resolved={resolved !== undefined}
                      message={message}
                      thread={thread}
                      by={by}
                      now={now}
                      images={images}
                      waitingOn={waitingOn}
                    />
                    {/* The first message always stands, so the line saying earlier ones are cut follows it. */}
                    {at === 0 && thread.length >= INBOX_BOUNDS.MAX_MESSAGES_READ ? (
                      <EarlierMessages by={by} />
                    ) : null}
                    {at === resolved ? <ResolvedEvent item={item} now={now} /> : null}
                  </Fragment>
                ))}
                {pending === undefined ? null : (
                  <PendingReply readerId={readerId} reply={pending} now={now} />
                )}
                {draftReply}
              </Stack>
            </ItemWords>
            {control.failed ? (
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.INBOX_READ)}
                onRetry={control.onRetry}
              >
                {INBOX_NOT_READ}
              </ErrorState>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </Fill>
    </section>
  );
}
