import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { dictationKeywords } from "@repo/features/dictation-keywords";
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
} from "@repo/features/inbox-wire";
import { markdownLink } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { APP_COMMAND } from "@repo/settings/shortcuts";
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
} from "@repo/ui";
import {
  ACTOR_KIND,
  type Actor,
  accountActor,
  actorName,
  memberActor,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { isWireString } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, ZapIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ConversationRows,
  ConversationScrollButton,
} from "../ai-elements/conversation.js";
import { useAutomation } from "../automation-directory.js";
import { useConnected } from "../connection.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { PhoneHead, phoneFindGroups } from "../desktop/phone-head.js";
import { unreadShown } from "../failure-report.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { useSteadyDoor } from "../steady-door.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { LOG_OVER_COMPOSER_CLASS } from "./agent-composer.js";
import { AgentCard, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { AttachedFileChips, attachmentChips } from "./attached-file-chips.js";
import { type AnswerNewThread, InboxAnswerBox, type NewThreadStart } from "./inbox-answer-box.js";
import {
  ANSWERED,
  AnsweredCard,
  AskControls,
  bareKey,
  DraftQuestion,
  DraftResolving,
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
} from "./inbox-ask-controls.js";
import { askHeadWords } from "./inbox-ask-words.js";
import { closeAction, type InboxCloser, useInboxClose } from "./inbox-close.js";
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
  readersItem,
  sentStamp,
} from "./inbox-model.js";
import { type InboxPager, InboxPagerControls } from "./inbox-pager.js";
import type { InboxReminder } from "./inbox-remind.js";
import { InboxStamp } from "./inbox-stamp.js";
import { REPLY_SCOPE, ReplyDoorProvider } from "./reply-to-selection.js";
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
  pendingRepliesOn,
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
 * wrote, is drawn as a line naming a newer version of the app, so the rest still reads.
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
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
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
  place,
  children,
}: {
  readerId: string | undefined;
  place: VirtualRowPlace;
  children: React.ReactNode;
}): React.JSX.Element {
  const reader = useReader(readerId);
  return (
    <InboxComment
      place={place}
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
 * One of the reader's plain replies on their way, which stand as the
 * thread's last messages before the draft reply, in the order sent: drawn
 * as the reader's own message is, its files going up, and "Sending" at its
 * head's end, until the item holds it, when the message it became stands in
 * its place.
 */
function PendingReply({
  readerId,
  reply,
  now,
  place,
}: {
  readerId: string | undefined;
  reply: PendingInboxReply;
  now: number;
  place: VirtualRowPlace;
}): React.JSX.Element {
  const reader = useReader(readerId);
  return (
    <InboxComment
      place={place}
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
function EarlierMessages({
  by,
  place,
}: {
  by: ItemAgent;
  place: VirtualRowPlace;
}): React.JSX.Element {
  return (
    <li
      {...place}
      className="inbox-thread-earlier relative pb-ui-20 pl-inbox-earlier text-caption-inline text-muted-foreground before:absolute before:top-0 before:-bottom-inbox-face-half before:left-inbox-line before:w-ui-2 before:bg-border before:content-['']"
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
 * or another item opened, scrolls nothing. Note that a reader already near
 * the thread's end is followed there by the log itself
 * (`ConversationRows`' `followOnAppend`), so this is what brings the
 * message in for a reader scrolled up, whom the log leaves where they are.
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
const NEWER_APP_ASK = `Answer this in a newer ${PRODUCT_NAME}.`;

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
 * What the agent's line says it did to an ask of its own, after its name:
 * withdrew it, or replaced it by a newer question where the post that
 * replaced it asks one, by a newer message where it asks nothing, as a post
 * that asks nothing replaces the ask it posts over, or by one the thread
 * read no longer carries.
 */
const AGENT_DID = {
  WITHDREW: "withdrew this",
  REPLACED_BY_QUESTION: "replaced this with a newer question",
  REPLACED_BY_MESSAGE: "replaced this with a newer message",
  REPLACED: "replaced this",
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
 * ask still reads in the thread and never as an answer; what became of it
 * is the thread's own line (`ThreadEvent`). An `answer` of words alone,
 * which has no controls, keeps none, as does a to-do naming no steps, whose
 * one step was the item's title as it stood then, which a later post may
 * have renamed.
 */
function HeldAsk({
  ask,
  title,
}: {
  ask: InboxKnownAsk;
  /** The item's title, which stands as the one step of a to-do that names none. */
  title: string;
}): React.JSX.Element | null {
  // A to-do naming no steps draws the item's title as its one step, and a later post may have renamed the item since, so the title it drew then is not known.
  if (!hasControls(ask) || (ask.type === INBOX_ASK.DO && ask.steps.length === 0)) return null;
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
    </div>
  );
}

/**
 * Whether a member resolved the item without an answer while that close
 * stands, as its row's card says it (`inboxSettledStanding`), which the
 * thread says in a line of its own among its messages (`ThreadEvent`).
 */
function resolvedByMember(item: InboxItem): boolean {
  return inboxSettledStanding(item) === INBOX_SETTLED_STANDING.RESOLVED;
}

/** What a line of what happened to the thread says: a member resolved it, or the agent withdrew or replaced one of its asks. */
const THREAD_EVENT = {
  RESOLVED: "resolved",
  WITHDRAWN: "withdrawn",
  REPLACED: "replaced",
} as const;

/**
 * A line of what happened to the thread, drawn among its messages: a member
 * resolving it without an answer, by whom where that is known, and the note
 * the close carried, where it carried one; the agent withdrawing an ask, and why; or the agent replacing one, by the
 * post that replaced it where the thread read carries it. Each says when,
 * where that is known, and is keyed by what it is about: the ask's message,
 * or the item for its standing close.
 */
type ThreadEventLine = { readonly key: string } & (
  | {
      readonly kind: typeof THREAD_EVENT.RESOLVED;
      readonly closer: InboxItem["closedBy"];
      readonly note: InboxMessage | undefined;
      readonly at: number | undefined;
    }
  | {
      readonly kind: typeof THREAD_EVENT.WITHDRAWN;
      readonly reason: string;
      readonly at: number | undefined;
    }
  | {
      readonly kind: typeof THREAD_EVENT.REPLACED;
      readonly by: InboxMessage | undefined;
      readonly at: number | undefined;
    }
);

/** Each line of what happened to the thread, by the index of the message it follows; -1 before every message read. */
type ThreadEventsAfter = ReadonlyMap<number, readonly ThreadEventLine[]>;

/** Where a line dated `at` stands: after the last message written by then, and never before the message at `from` it is about. */
function standsAfter(
  thread: readonly InboxMessage[],
  from: number,
  at: number | undefined,
): number {
  if (at === undefined) return from;
  return Math.max(
    from,
    thread.findLastIndex((message) => message.createdAt <= at),
  );
}

/**
 * The note a member's close carried, which the service writes as their
 * message in the close's own write, so stamped with the close's very time:
 * a member's message written then that answers nothing, by the closer where
 * the close names one; none where the close carried no note.
 */
function closeNote(
  thread: readonly InboxMessage[],
  at: number | undefined,
  closer: InboxItem["closedBy"],
): InboxMessage | undefined {
  if (at === undefined) return undefined;
  return thread.find(
    (message) =>
      message.author === INBOX_MESSAGE_AUTHOR.MEMBER &&
      message.answers === undefined &&
      message.createdAt === at &&
      (closer === undefined || message.member?.userId === closer.userId),
  );
}

/**
 * Where the post that replaced the ask at `index` stands: the agent's next
 * post that asks, since a follow-up asking nothing on a thread still asking
 * leaves its ask open; or, where none does, its next post, as a deployment
 * that replaced an ask with a post asking nothing left it; -1 where the
 * thread read carries neither.
 */
function replacingPost(thread: readonly InboxMessage[], index: number): number {
  const later = (message: InboxMessage, at: number) =>
    at > index && message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  const asked = thread.findIndex((message, at) => later(message, at) && message.ask !== undefined);
  return asked === -1 ? thread.findIndex(later) : asked;
}

/**
 * Whether the ask at `index`, withdrawn with no why, is the one the
 * member's close that still stands withdrew, whose line the item's own close
 * draws: the ask withdrawn at the close's stamp, or, for an ask withdrawn
 * before its time was kept, the latest ask, since a post asking since would
 * have opened the item again.
 */
function withdrawnByStandingClose(
  item: InboxItem,
  thread: readonly InboxMessage[],
  index: number,
): boolean {
  if (!resolvedByMember(item)) return false;
  const at = thread[index]?.ask?.withdrawnAt;
  if (at !== undefined) return at === item.settledAt;
  return thread.findLastIndex((message) => message.ask !== undefined) === index;
}

/**
 * The line a settled ask's message gives the thread, and where it stands:
 * for a replaced one, just before the post that replaced it
 * (`replacingPost`), dated as that post, or right after it where the thread
 * read no longer carries that post; for one withdrawn with why, where it was
 * withdrawn; and for one withdrawn with none, which a member's close leaves,
 * the line saying it was resolved without an answer, unless it is the close
 * that still stands (`withdrawnByStandingClose`).
 */
function askEvent(
  item: InboxItem,
  thread: readonly InboxMessage[],
  index: number,
): { readonly after: number; readonly line: ThreadEventLine } | undefined {
  const message = thread[index];
  const ask = message?.ask;
  if (message === undefined || ask === undefined) return undefined;
  const key = message.id;
  if (ask.status === INBOX_ASK_STATUS.REPLACED) {
    const next = replacingPost(thread, index);
    const by = next === -1 ? undefined : thread[next];
    const line = { key, kind: THREAD_EVENT.REPLACED, by, at: by?.createdAt } as const;
    return { after: next === -1 ? index : next - 1, line };
  }
  if (ask.status !== INBOX_ASK_STATUS.WITHDRAWN) return undefined;
  const after = standsAfter(thread, index, ask.withdrawnAt);
  if (ask.withdrawnReason !== undefined) {
    const reason = ask.withdrawnReason;
    const line = { key, kind: THREAD_EVENT.WITHDRAWN, reason, at: ask.withdrawnAt } as const;
    return { after, line };
  }
  if (withdrawnByStandingClose(item, thread, index)) return undefined;
  // Note that a close no longer standing names no closer, but the note it carried was written by them.
  const note = closeNote(thread, ask.withdrawnAt, undefined);
  const line = {
    key,
    kind: THREAD_EVENT.RESOLVED,
    closer: note?.member,
    note,
    at: ask.withdrawnAt,
  } as const;
  return { after, line };
}

/**
 * Every line of what happened to the thread, by the message each follows:
 * what became of each settled ask (`askEvent`), then the member's close
 * where it stands, after the last message written by the time of the close,
 * since a settled item still takes messages, or at the thread's end where
 * that time is not known.
 */
function threadEvents(item: InboxItem, thread: readonly InboxMessage[]): ThreadEventsAfter {
  const events = new Map<number, ThreadEventLine[]>();
  const add = (after: number, line: ThreadEventLine) => {
    events.set(after, [...(events.get(after) ?? []), line]);
  };
  thread.forEach((_, index) => {
    const event = askEvent(item, thread, index);
    if (event !== undefined) add(event.after, event.line);
  });
  if (resolvedByMember(item)) {
    const settled = item.settledAt;
    const after =
      settled === undefined
        ? thread.length - 1
        : thread.findLastIndex((message) => message.createdAt <= settled);
    const note = closeNote(thread, settled, item.closedBy);
    add(after, {
      key: item.id,
      kind: THREAD_EVENT.RESOLVED,
      closer: item.closedBy,
      note,
      at: settled,
    });
  }
  return events;
}

/** The messages a close's line draws as its note, which the thread draws there rather than as messages of their own. */
function closeNotes(events: ThreadEventsAfter): ReadonlySet<string> {
  const notes = new Set<string>();
  for (const lines of events.values()) {
    for (const line of lines) {
      if (line.kind === THREAD_EVENT.RESOLVED && line.note !== undefined) notes.add(line.note.id);
    }
  }
  return notes;
}

/** What a row of the thread draws: a line of what happened to it, a message, the line saying earlier messages are cut, a reply on its way, or the reader's draft reply. */
const THREAD_ROW = {
  EVENT: "event",
  MESSAGE: "message",
  EARLIER: "earlier",
  PENDING: "pending",
  DRAFT: "draft",
} as const;

type ThreadRow =
  | { readonly kind: typeof THREAD_ROW.EVENT; readonly key: string; readonly line: ThreadEventLine }
  | {
      readonly kind: typeof THREAD_ROW.MESSAGE;
      readonly key: string;
      readonly message: InboxMessage;
    }
  | { readonly kind: typeof THREAD_ROW.EARLIER; readonly key: string }
  | {
      readonly kind: typeof THREAD_ROW.PENDING;
      readonly key: string;
      readonly reply: PendingInboxReply;
    }
  | { readonly kind: typeof THREAD_ROW.DRAFT; readonly key: string };

/** The height a row of the thread is taken to have before it is drawn, in pixels: a short message's. */
const THREAD_ROW_ESTIMATE_PX = 96;

/**
 * The thread's rows in order, each one of its comments, as the log's run
 * draws them (`ConversationRows`): the lines of what happened before its
 * first message, then each message, a close's note drawn under the close's
 * own line instead, with the lines that follow it, the line saying earlier
 * messages are cut after the first, which always stands, the reader's
 * replies on their way, and the draft reply last. Note that the run names
 * its rows by one string each (`VirtualRows`), and a line of what happened
 * is kept by the message it follows, so its row is that message's id with
 * the line's kind after it.
 */
function threadRows(
  thread: readonly InboxMessage[],
  events: ThreadEventsAfter,
  pending: readonly PendingInboxReply[],
): readonly ThreadRow[] {
  const notes = closeNotes(events);
  const eventsAt = (after: number): ThreadRow[] =>
    (events.get(after) ?? []).map((line) => ({
      kind: THREAD_ROW.EVENT,
      key: `${line.key}/${line.kind}`,
      line,
    }));
  const rows: ThreadRow[] = eventsAt(-1);
  for (const [at, message] of thread.entries()) {
    if (!notes.has(message.id)) rows.push({ kind: THREAD_ROW.MESSAGE, key: message.id, message });
    if (at === 0 && thread.length >= INBOX_BOUNDS.MAX_MESSAGES_READ) {
      rows.push({ kind: THREAD_ROW.EARLIER, key: THREAD_ROW.EARLIER });
    }
    rows.push(...eventsAt(at));
  }
  for (const reply of pending) rows.push({ kind: THREAD_ROW.PENDING, key: reply.key, reply });
  rows.push({ kind: THREAD_ROW.DRAFT, key: THREAD_ROW.DRAFT });
  return rows;
}

/** What a member resolving the item says after their name. */
const RESOLVED_IT = "resolved this without an answer";

/**
 * A line of what happened to the thread, drawn as a description comment's
 * "resolved this" is: whoever did it, their face on the gutter's line, their
 * name, what they did, and when; a close's note under it, as a member's
 * message draws its words and files, and a withdrawal's why, in the muted
 * ink. The member's is the closer where known, and the agent's its tile.
 */
function ThreadEvent({
  itemId,
  line,
  by,
  now,
  images,
  place,
}: {
  itemId: string;
  line: ThreadEventLine;
  by: ItemAgent;
  now: number;
  images: InboxImageReads;
  place: VirtualRowPlace;
}): React.JSX.Element {
  const closer = usePerson(line.kind === THREAD_EVENT.RESOLVED ? line.closer : undefined);
  if (line.kind === THREAD_EVENT.RESOLVED) {
    return (
      <InboxComment
        place={place}
        kind={COMMENT.CLOSED}
        author={commentAuthor(closer)}
        nameRef={<ActorRef actor={closer} nameOnly />}
        said={RESOLVED_IT}
        at={line.at}
        now={now}
        messageId={line.note?.id}
      >
        {line.note === undefined ? undefined : (
          <MessageWords itemId={itemId} message={line.note} images={images} />
        )}
      </InboxComment>
    );
  }
  const agent = { author: commentAuthor(by.subject.tile), nameRef: <AgentName by={by} /> };
  if (line.kind === THREAD_EVENT.WITHDRAWN) {
    return (
      <InboxComment
        place={place}
        kind={COMMENT.WITHDRAWN}
        {...agent}
        said={AGENT_DID.WITHDREW}
        at={line.at}
        now={now}
      >
        <WithdrawnWhy reason={line.reason} />
      </InboxComment>
    );
  }
  const said =
    line.by === undefined
      ? AGENT_DID.REPLACED
      : line.by.ask === undefined
        ? AGENT_DID.REPLACED_BY_MESSAGE
        : AGENT_DID.REPLACED_BY_QUESTION;
  return (
    <InboxComment
      place={place}
      kind={COMMENT.REPLACED}
      {...agent}
      said={said}
      at={line.at}
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
 * a replaced or withdrawn ask, no card, its controls as it offered them,
 * stepped back (`HeldAsk`), the thread's own line saying what became of it
 * (`ThreadEvent`); and an ask this build does not know a card naming a newer
 * version of the app.
 */
function AskBox({
  title,
  message,
  ask,
  thread,
  waitingOn,
}: {
  /** The item's title, as `cardTitle` reads it. */
  title: string;
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
            <Text tone={TEXT_TONE.MUTED}>{NEWER_APP_ASK}</Text>
            {ask.status === INBOX_ASK_STATUS.OPEN ? <Waiting on={waitingOn} /> : null}
          </CardHead>
        </Card>
      </div>
    );
  }
  if (ask.status === INBOX_ASK_STATUS.REPLACED || ask.status === INBOX_ASK_STATUS.WITHDRAWN) {
    return <HeldAsk ask={ask} title={title} />;
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
  message,
  thread,
  by,
  now,
  images,
  waitingOn,
  place,
}: {
  itemId: string;
  /** The item's title, as `cardTitle` reads it. */
  title: string;
  /** The member the item's agent addressed its thread to (`inboxAddressedTo`), which an open ask from before messages kept their own addressee is addressed to. */
  threadAddressedTo: InboxItem["waitsOn"];
  message: InboxMessage;
  thread: readonly InboxMessage[];
  by: ItemAgent;
  now: number;
  images: InboxImageReads;
  waitingOn: InboxItem["startedBy"];
  place: VirtualRowPlace;
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
      place={place}
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
  /** The task the Inbox is narrowed to, by its name, which the head says the item stands in; none while it lists every task's. */
  readonly narrowedTask?: string | undefined;
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
              replayMasked: true,
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
              replayMasked: true,
              icon: <ZapIcon />,
              onSelect: onOpenHolder,
            },
          ];
  // ⌘O opens the item's task, or its agent where no task holds it (`desktop-inbox.tsx`).
  const agentItem: MenuAction = {
    label: OPEN_AGENT,
    detail: by.subject.name,
    replayMasked: true,
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
 * agent; Mark as read or unread, naming U, and Remind me, naming H; and, while the
 * item is open, Resolve without answering, asked first. It is keyed by its
 * item where it is drawn, so a question asked on one item never closes the
 * next, and the menu and the question go with the pane once it is hidden.
 */
function InboxItemMenu({
  item,
  shown,
  onMark,
  onClose,
  onRemind,
  lead = NO_LEAD,
  heading,
}: {
  item: InboxItem;
  shown: boolean;
  onMark: InboxPaneDoors["onMark"];
  onRemind?: InboxReminder | undefined;
  onClose: InboxCloser | undefined;
  /** Groups over the item's own, as a phone's head leads its ⋯ with what its bar drew as buttons (`phoneItemGroups`); none elsewhere. */
  lead?: readonly MenuAction[][];
  /** Muted over the items, pressed by nothing: where the item stands in the list, on a phone. */
  heading?: React.ReactNode;
}): React.JSX.Element | null {
  const menu = useMenu(shown);
  const close = useInboxClose(item, onClose, shown);
  // Note that a time of the reader's own is picked from the item's row, whose list holds the picker, so this menu offers the times alone.
  const { groups: itemGroups } = useInboxItemActions(item, {
    onMark,
    onAskClose: close.ask,
    keyed: true,
    remind: onRemind === undefined ? undefined : { onRemind },
  });
  // Note that a phone's ⋯, the one given a lead, also stands in for ⌘F, read here as the menu is drawn rather than as the lead was made.
  const groups = itemGroups(lead === NO_LEAD ? lead : [...lead, ...phoneFindGroups()]);
  if (groups.length === 0) return null;
  return (
    <>
      <MoreButton thing={ITEM_THING} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
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
 * which asks nothing and only stages the resolve on the item's draft, the
 * box's Send doing it (`DraftResolving`), so the item's ⋯ keeps its own
 * close and the question it asks (`inbox-close.tsx`). It is keyed by its
 * item where it is drawn, so a resolve staged on one item never lands on
 * the next, and takes back the focus Undo had where it came of Undo's press.
 */
function QuestionClose({
  item,
  closer,
  takesFocus,
  onStage,
}: {
  item: InboxItem;
  closer: InboxCloser | undefined;
  takesFocus: boolean;
  /** Stages the resolve on the item's draft. */
  onStage: () => void;
}): React.JSX.Element | null {
  const cross = useRef<HTMLButtonElement>(null);
  // Note that only the mount reads it, so a question drawn as the item opens takes no focus from where the reader stands.
  const focused = useRef(takesFocus);
  useEffect(() => {
    if (focused.current) cross.current?.focus();
  }, []);
  const close = closeAction(item, closer === undefined ? undefined : onStage);
  return close === undefined ? null : (
    <Tooltip label={close.label}>
      <IconButton
        ref={cross}
        icon={close.icon}
        label={close.label}
        size={BUTTON_SIZE.COMPACT}
        onClick={close.onSelect}
      />
    </Tooltip>
  );
}

/**
 * The thread's subject, as a description or a pull request leads with one: the
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
  /** Sets the item's reminder from its ⋯ menu, or cancels it; none where the pane offers no reminder. */
  readonly onRemind?: InboxReminder | undefined;
  /** Closes an open item without an answer, from the bar's ⋯ menu; none where the pane offers no close. */
  readonly onClose?: InboxCloser | undefined;
}

/** What starts a new thread from an item's box instead of a reply, where the page offers one. */
export interface InboxNewThread {
  /** Starts a thread with the item's agent and opens it; answers why it did not start, or nothing once it did. */
  readonly onStart: (item: InboxItem, start: NewThreadStart) => Promise<string | undefined>;
}

/**
 * The box's new thread for one item: the item's agent's chip, wearing its
 * tile as a mention of the agent does, hanging its card and opening the
 * agent, as a chip does elsewhere. Note that a chip is a button, so its
 * press opens it rather than ticking the checkbox whose words it stands in.
 */
function answerNewThread(offer: InboxNewThread, item: InboxItem, by: ItemAgent): AnswerNewThread {
  const { name, tile } = by.subject;
  return {
    agent: (
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        glyph={<ActorMark actor={tile} size={ACTOR_SIZE.INLINE} />}
        label={name}
        card={<AgentCard subject={by.subject} models={by.models} />}
        onPress={by.onOpen}
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
  const crumbs: Crumb[] = [
    taskCrumb(holder, doors) ?? automation,
    // Note that once the title joins the path the agent's crumb keeps its size, so a narrow bar cuts the task's crumb short first and then the title.
    agentCrumb(by, titleShown),
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

/** The path's agent crumb, wearing its mark and hanging its card, which opens its tab; `fixed` keeps its size where the crumbs after it give way first. */
function agentCrumb(by: ItemAgent, fixed = false): Crumb {
  const { name, agent } = by.subject;
  return {
    label: name,
    glyph: tabLook({ kind: TAB_KIND.AGENT, name, agent }).icon,
    hint: name,
    card: <AgentCard subject={by.subject} models={by.models} />,
    onPress: () => by.onOpen(),
    fixed,
  };
}

/**
 * A phone's bar's name for the item: what holds it, its task as the wide
 * path leads with it, or its agent where no task holds it, each crumb
 * pressing where the wide path's does. Where the Inbox is narrowed to a
 * task, the Inbox leads it, pressing back to that narrowed list, so the
 * screen a thread's link lands on says the list it stands in. Note that the
 * bar never names the item's title, because the thread's heading right
 * under it already does.
 */
function PhoneHolder({
  holder,
  by,
  doors,
  narrowed,
}: {
  holder: InboxHolder;
  by: ItemAgent;
  doors: InboxPaneDoors;
  /** Goes back to the list narrowed to the task; none while it lists every task's. */
  narrowed: (() => void) | undefined;
}): React.JSX.Element {
  const holds = taskCrumb(holder, doors) ?? agentCrumb(by);
  return (
    <Breadcrumbs
      label="Path"
      crumbs={narrowed === undefined ? [holds] : [{ label: "Inbox", onPress: narrowed }, holds]}
    />
  );
}

/**
 * Where the pane stands inside the room of what holds the item, an agent's
 * card in its task's column (`agent-threads.tsx`): its way back names the
 * list it goes back to, and its bar names neither the task nor the agent,
 * which the card's tab and the task's topbar already name, so it holds the
 * item's title alone, once its heading has scrolled away.
 */
export interface InboxPaneWithin {
  /** The way back's words, and the place its hint names. */
  readonly back: { readonly label: string; readonly place: string };
}

/**
 * One item at reading size, as a comment thread: under the pane's crumbs,
 * the item's title alone as the thread's subject, then every message of
 * its thread, oldest first, the reader's plain replies on their way after
 * them, in the order sent (`PendingReply`), and the reader's draft reply at
 * its end, the open ask's controls standing in it.
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
  newThread,
  within,
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
   * phone: the way back's glyph, what holds the item centered (`PhoneHolder`), and one ⋯
   * holding the pager, what the crumbs open, the panel, and the item's own
   * actions; none elsewhere, where the bar draws its crumbs and buttons.
   */
  phone?: InboxPanePhone | undefined;
  /** What the box's checkbox starts a new thread with instead of a reply; none where the page offers none. */
  newThread?: InboxNewThread | undefined;
  /** Where the pane stands inside the room of what holds the item, an agent's card (`InboxPaneWithin`); none in the window's Inbox. */
  within?: InboxPaneWithin | undefined;
}): React.JSX.Element {
  const connected = useConnected();
  const now = useMinute();
  const board = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  // The box's door a quote is laid in through, which the pages the thread draws offer Reply through; held in a record, since a function handed to a state's setter is read as an update.
  const [quoteDoor, setQuoteDoor] = useState<{ readonly lay: (words: string) => void } | undefined>(
    undefined,
  );
  const onQuoteDoor = useCallback(
    (lay: ((words: string) => void) | undefined) =>
      setQuoteDoor(lay === undefined ? undefined : { lay }),
    [],
  );
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
  const { images } = control;
  const open = item.status === INBOX_STATUS.OPEN;
  const draft = control.draftOf(item);
  const thread = item.thread ?? NO_MESSAGES;
  const pending = pendingRepliesOn(control.pendingReplies, item);
  const events = useMemo(() => threadEvents(item, thread), [item, thread]);
  const rows = useMemo(() => threadRows(thread, events, pending), [thread, events, pending]);
  const rowKeys = useMemo(() => rows.map((row) => row.key), [rows]);
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
  // Note that a resolve staged by the question's × stands in its place until Send or Undo, the picks kept beneath it.
  const resolving = open && draft.resolving === true && doors.onClose !== undefined;
  // Which of the × and Undo was pressed last, and on which item, so the one that takes its place takes its focus, and never on another item the pane goes on to show.
  const [pressed, setPressed] = useState<
    { readonly itemId: string; readonly which: "close" | "undo" } | undefined
  >(undefined);
  const pressedHere = pressed?.itemId === item.id ? pressed.which : undefined;
  const question =
    openAsk === undefined || wordsAlone ? undefined : resolving ? (
      <DraftResolving
        takesFocus={pressedHere === "close"}
        onUndo={() => {
          setPressed({ itemId: item.id, which: "undo" });
          onDraft({ ...draft, resolving: undefined });
        }}
      />
    ) : (
      <DraftQuestion
        pane={pane}
        close={
          <QuestionClose
            key={item.id}
            item={item}
            closer={doors.onClose}
            takesFocus={pressedHere === "undo"}
            onStage={() => {
              setPressed({ itemId: item.id, which: "close" });
              onDraft({ ...draft, resolving: true });
            }}
          />
        }
      >
        <AskControls
          ask={openAsk}
          title={cardTitle(item.title)}
          doors={{ draft, disabled: !open, text: formText, onDraft }}
        />
      </DraftQuestion>
    );
  // The box stands at the thread's end as the reader's draft reply.
  const draftReply = (place: VirtualRowPlace) => (
    <AnswerMentions value={mentions}>
      <DraftReply readerId={readerId} place={place}>
        <InboxAnswerBox
          item={item}
          readerId={readerId}
          control={control}
          agent={by.subject.agent}
          thread={thread}
          controls={question}
          resolver={resolving ? doors.onClose : undefined}
          skills={agents.readSkills}
          keywords={answerKeywords(holder, item)}
          replyScope={board}
          onQuoteDoor={onQuoteDoor}
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
            <BackButton
              label={phone.narrowedTask === undefined ? "Inbox" : `${phone.narrowedTask} · Inbox`}
              place={INBOX_PLACE}
              onBack={onBack}
            />
          }
          title={
            <PhoneHolder
              holder={holder}
              by={by}
              doors={doors}
              narrowed={phone.narrowedTask === undefined ? undefined : onBack}
            />
          }
          end={
            <InboxItemMenu
              key={item.id}
              item={item}
              shown={!hidden}
              onMark={doors.onMark}
              onRemind={doors.onRemind}
              onClose={doors.onClose}
              lead={phoneItemGroups(holder, by, doors, pager, phone)}
              heading={
                pager?.count === undefined ? undefined : (
                  <ReplayUnmask>{`${pager.count.at} of ${pager.count.total}`}</ReplayUnmask>
                )
              }
            />
          }
        />
      ) : (
        <Toolbar
          place="inbox-item"
          // Note that a bar inside the item's holder's room that leads with no way back starts on the title it picks up, words rather than crumbs.
          start={
            within !== undefined && onBack === undefined ? TOOLBAR_INSET.PAGE : TOOLBAR_INSET.COLUMN
          }
          wrapHeading
          lead={
            onBack === undefined ? undefined : (
              <ReplayUnmask>
                <BackButton
                  label={within?.back.label ?? "Inbox"}
                  place={within?.back.place ?? INBOX_PLACE}
                  onBack={onBack}
                />
              </ReplayUnmask>
            )
          }
          title={
            within === undefined ? (
              <Crumbs
                holder={holder}
                by={by}
                doors={doors}
                title={cardTitle(item.title)}
                titleShown={headingAway}
              />
            ) : undefined
          }
          pickUp={
            within === undefined ? undefined : { name: cardTitle(item.title), shown: headingAway }
          }
          quiet={within !== undefined}
          actions={
            <>
              {/* The bar ends in the pager, where the item stands alone, and the item's ⋯ menu. */}
              {pager === undefined ||
              (pager.onPrevious === undefined && pager.onNext === undefined) ? null : (
                <ReplayUnmask>
                  <InboxPagerControls pager={pager} />
                </ReplayUnmask>
              )}
              <InboxItemMenu
                key={item.id}
                item={item}
                shown={!hidden}
                onMark={doors.onMark}
                onRemind={doors.onRemind}
                onClose={doors.onClose}
              />
            </>
          }
        />
      )}
      <Fill className="desktop-inbox">
        {/* The thread is a log as an agent's transcript is: each item opens at its newest message, the box at its end, and keeps to it while the reader is there; scrolled up, the way back floats over its foot. */}
        <Conversation list={board}>
          <ConversationContent
            className={`inbox-board ${LOG_OVER_COMPOSER_CLASS} ph-no-capture flex flex-col pt-section-gap`}
          >
            {/* The item's words are drawn as documents: its own pictures read through the Inbox, and a link alone on its line as its card. */}
            <ItemWords itemId={item.id} workspaceId={workspaceId} images={images} code={doors.code}>
              <Subject item={item} heading={setHeading} first={phoneHead} />
              <ReplyDoorProvider value={quoteDoor?.lay}>
                {/* Each item's thread is a run of its own, so it opens at its newest message. Note that every row is drawn, because the thread is a few dozen messages at most and its comments' timeline is drawn from each to the next. */}
                <ConversationRows
                  key={item.id}
                  keys={rowKeys}
                  estimate={THREAD_ROW_ESTIMATE_PX}
                  gap={0}
                  overscan={rowKeys.length}
                  listItems
                  className={INBOX_THREAD}
                  aria-label="Messages"
                >
                  {(at, place) => {
                    const row = rows[at];
                    switch (row?.kind) {
                      case THREAD_ROW.EVENT:
                        return (
                          <ThreadEvent
                            itemId={item.id}
                            line={row.line}
                            by={by}
                            now={now}
                            images={images}
                            place={place}
                          />
                        );
                      case THREAD_ROW.MESSAGE:
                        return (
                          <ThreadMessage
                            itemId={item.id}
                            title={cardTitle(item.title)}
                            threadAddressedTo={inboxAddressedTo(item)}
                            message={row.message}
                            thread={thread}
                            by={by}
                            now={now}
                            images={images}
                            waitingOn={waitingOn}
                            place={place}
                          />
                        );
                      case THREAD_ROW.EARLIER:
                        return <EarlierMessages by={by} place={place} />;
                      case THREAD_ROW.PENDING:
                        return (
                          <PendingReply
                            readerId={readerId}
                            reply={row.reply}
                            now={now}
                            place={place}
                          />
                        );
                      case THREAD_ROW.DRAFT:
                        return draftReply(place);
                      default:
                        return null;
                    }
                  }}
                </ConversationRows>
              </ReplyDoorProvider>
            </ItemWords>
            {/* Note that the thread above keeps its words with no line under it while the app is offline, since the Offline mark says why. */}
            {control.failed && connected ? (
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
