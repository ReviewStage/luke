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

const INBOX_PLACE = "inbox";

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

type NumberedPick = (draft: InboxDraft, number: number) => InboxDraft | undefined;

function numberedPickOf(thread: readonly InboxMessage[]): NumberedPick | undefined {
  const ask = openAskOf(thread)?.ask;
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  return (draft, number) => askNumberedPick(ask, draft, number);
}

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

const DRAFT_HEAD = {
  YOU: "You",
} as const;

function useReader(readerId: string | undefined): Actor {
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const { members } = useMemberDirectory();
  const member = members?.find((each) => each.userId === readerId);
  if (member !== undefined) return memberActor(member, readerId);
  if (account?.status === ACCOUNT_STATUS.SIGNED_IN) return accountActor(account);
  if (readerId !== undefined) {
    return { kind: ACTOR_KIND.PERSON, userId: readerId, name: DRAFT_HEAD.YOU, you: true };
  }
  return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };
}

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

const SENDING = "Sending";

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

const NO_MESSAGES: readonly InboxMessage[] = [];

function AnswerValues({
  values,
  texts,
}: {
  values: readonly InboxFormValue[];
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

function draftReplyOf(scroller: HTMLElement): Element | null {
  return scroller.querySelector('[data-inbox-comment="draft"]');
}

function footPadding(scroller: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(scroller).scrollPaddingBottom) || 0;
}

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

const NEWER_APP_ASK = `Answer this in a newer ${PRODUCT_NAME}.`;

function Waiting({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element | null {
  const starter = usePerson(on);
  if (on === undefined) return null;
  return (
    <span className="inbox-waiting-on text-muted-foreground" data-inbox-waiting="">
      Waiting on {actorName(starter, { sentence: true })}
    </span>
  );
}

const AGENT_DID = {
  WITHDREW: "withdrew this",
  REPLACED_BY_QUESTION: "replaced this with a newer question",
  REPLACED_BY_MESSAGE: "replaced this with a newer message",
  REPLACED: "replaced this",
} as const;

function AnsweredMarker(): React.JSX.Element {
  return (
    <span data-inbox-settled="answered">
      <Badge tone={STATUS_TONE.COMPLETE} icon={<CheckIcon aria-hidden="true" />}>
        {ANSWERED}
      </Badge>
    </span>
  );
}

function HeldAsk({ ask, title }: { ask: InboxKnownAsk; title: string }): React.JSX.Element | null {
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

function resolvedByMember(item: InboxItem): boolean {
  return inboxSettledStanding(item) === INBOX_SETTLED_STANDING.RESOLVED;
}

const THREAD_EVENT = {
  RESOLVED: "resolved",
  WITHDRAWN: "withdrawn",
  REPLACED: "replaced",
} as const;

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

type ThreadEventsAfter = ReadonlyMap<number, readonly ThreadEventLine[]>;

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

function replacingPost(thread: readonly InboxMessage[], index: number): number {
  const later = (message: InboxMessage, at: number) =>
    at > index && message.author === INBOX_MESSAGE_AUTHOR.AGENT;
  const asked = thread.findIndex((message, at) => later(message, at) && message.ask !== undefined);
  return asked === -1 ? thread.findIndex(later) : asked;
}

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

function closeNotes(events: ThreadEventsAfter): ReadonlySet<string> {
  const notes = new Set<string>();
  for (const lines of events.values()) {
    for (const line of lines) {
      if (line.kind === THREAD_EVENT.RESOLVED && line.note !== undefined) notes.add(line.note.id);
    }
  }
  return notes;
}

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

const THREAD_ROW_ESTIMATE_PX = 96;

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

const RESOLVED_IT = "resolved this without an answer";

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

function AskMarker({ on }: { on: InboxItem["startedBy"] }): React.JSX.Element | null {
  const starter = usePerson(on);
  if (on === undefined) return null;
  return <WaitingMarker on={actorName(starter, { sentence: true })} />;
}

function AskBox({
  title,
  message,
  ask,
  thread,
  waitingOn,
}: {
  title: string;
  message: InboxMessage;
  ask: InboxReadAsk;
  thread: readonly InboxMessage[];
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
  const answered = ask.status === INBOX_ASK_STATUS.ANSWERED;
  if (answered && answerOf(thread, message.id)?.answers !== undefined) {
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

function answeredAsk(
  thread: readonly InboxMessage[],
  answers: InboxAnswers,
): InboxReadAsk | undefined {
  return thread.find((message) => message.id === answers.ask)?.ask;
}

const NO_TEXT_LABELS: ReadonlySet<string> = new Set();

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
  title: string;
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

const NO_LEAD: readonly MenuAction[][] = [];

export interface InboxPanePhone {
  readonly onShowPanel: (() => void) | undefined;
  readonly narrowedTask?: string | undefined;
}

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

const OPEN_TASK = "Open task";
const OPEN_AUTOMATION = "Open automation";
const OPEN_AGENT = "Open agent";

const ITEM_THING = "Inbox item";

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
  lead?: readonly MenuAction[][];
  heading?: React.ReactNode;
}): React.JSX.Element | null {
  const menu = useMenu(shown);
  const close = useInboxClose(item, onClose, shown);
  const { groups: itemGroups } = useInboxItemActions(item, {
    onMark,
    onAskClose: close.ask,
    keyed: true,
    remind: onRemind === undefined ? undefined : { onRemind },
  });
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

function QuestionClose({
  item,
  closer,
  takesFocus,
  onStage,
}: {
  item: InboxItem;
  closer: InboxCloser | undefined;
  takesFocus: boolean;
  onStage: () => void;
}): React.JSX.Element | null {
  const cross = useRef<HTMLButtonElement>(null);
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

function Subject({
  item,
  heading,
  first,
}: {
  item: InboxItem;
  heading: (element: HTMLElement | null) => void;
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

function AnswerMentions({
  value,
  children,
}: {
  value: TaskMentionsValue | undefined;
  children: React.ReactNode;
}): React.ReactNode {
  return value === undefined ? children : <TaskMentions value={value}>{children}</TaskMentions>;
}

function answerKeywords(holder: InboxHolder, item: InboxItem): readonly string[] {
  const repository =
    holder.kind === INBOX_HOLDER.TASK ? holder.task.repository : holder.agent.repository;
  const body = (item.thread ?? []).map((message) => message.text).join("\n");
  return dictationKeywords({ repository, title: item.title, body });
}

export interface InboxPaneDoors {
  readonly onOpenHolder: (() => void) | undefined;
  readonly taskCard: React.ReactNode;
  readonly onOpenAgent: (agentId: string) => void;
  readonly code: InboxCodeDoors;
  readonly onMark?: ((item: InboxItem, unread: boolean) => void) | undefined;
  readonly onRemind?: InboxReminder | undefined;
  readonly onClose?: InboxCloser | undefined;
}

export interface InboxNewThread {
  readonly onStart: (item: InboxItem, start: NewThreadStart) => Promise<string | undefined>;
}

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
    glyph: <HolderGlyph holder={holder} />,
    hint: name,
    card:
      known === undefined ? undefined : (
        <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
      ),
    onPress: onOpen === undefined ? undefined : () => onOpen(),
  };
}

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
  title: string;
  titleShown: boolean;
}): React.JSX.Element {
  const automation = useAutomationCrumb(holder, doors.onOpenHolder);
  const crumbs: Crumb[] = [
    taskCrumb(holder, doors) ?? automation,
    agentCrumb(by, titleShown),
    { label: title, current: true, shown: titleShown },
  ].filter((crumb) => crumb !== undefined);
  return (
    <div className="inbox-crumbs flex min-w-0 flex-initial">
      <Breadcrumbs label="Path" crumbs={crumbs} />
    </div>
  );
}

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

function PhoneHolder({
  holder,
  by,
  doors,
  narrowed,
}: {
  holder: InboxHolder;
  by: ItemAgent;
  doors: InboxPaneDoors;
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
}: {
  holder: InboxHolder;
  item: InboxItem;
  control: TaskInboxControl;
  agents: AgentsControl;
  doors: InboxPaneDoors;
  hidden: boolean;
  onBack: (() => void) | undefined;
  pager: InboxPager | undefined;
  mentions?: TaskMentionsValue | undefined;
  phone?: InboxPanePhone | undefined;
  newThread?: InboxNewThread | undefined;
}): React.JSX.Element {
  const connected = useConnected();
  const now = useMinute();
  const board = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
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
  const phoneHead = phone !== undefined && onBack !== undefined;
  const waitingOn = readersItem(item, readerId) ? undefined : inboxWaitsOn(item);
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
  const workspaceId = itemWorkspaceId(holder);
  const onDraft = (next: InboxDraft) => control.onDraft(item, next);
  const asking = openAskOf(thread);
  const openAsk = asking !== undefined && knownAsk(asking.ask) ? asking.ask : undefined;
  const wordsAlone = openAsk?.type === INBOX_ASK.ANSWER && openAsk.fields === undefined;
  const resolving = open && draft.resolving === true && doors.onClose !== undefined;
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
          start={TOOLBAR_INSET.COLUMN}
          wrapHeading
          lead={
            onBack === undefined ? undefined : (
              <ReplayUnmask>
                <BackButton label="Inbox" place={INBOX_PLACE} onBack={onBack} />
              </ReplayUnmask>
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
        <Conversation list={board}>
          <ConversationContent
            className={`inbox-board ${LOG_OVER_COMPOSER_CLASS} ph-no-capture flex flex-col pt-section-gap`}
          >
            <ItemWords itemId={item.id} workspaceId={workspaceId} images={images} code={doors.code}>
              <Subject item={item} heading={setHeading} first={phoneHead} />
              <ReplyDoorProvider value={quoteDoor?.lay}>
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
