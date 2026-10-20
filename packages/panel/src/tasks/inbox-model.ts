import type { FileChip } from "@luke/features/attachment-model";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import {
  codeLinesReadable,
  fieldValueWords,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxAsk,
  type InboxChoice,
  type InboxCodeBlock,
  type InboxFieldValue,
  type InboxForm,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
  type InboxReadResponse,
  type InboxReply,
  type InboxReplyKind,
  type InboxResponse,
  inboxAnswersRefusal,
  inboxReplyRefusal,
  knownBlock,
  knownResponse,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, readLink } from "@luke/features/luke-link";
import { linksIn } from "@luke/features/mention-link";
import type { TaskFileRequest, TaskSummary } from "@luke/features/task-wire";
import type { TaskCode, TasksFileAnswer } from "@luke/features/tasks-view";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { isWireString } from "@luke/wire";
import type { CountNoun } from "../desktop/sidebar-group-header.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";
import { plainWords } from "./tool-call-model.js";

/**
 * inbox-model.ts -- the Inbox as pure decisions: which items it lists and how, what an item's answer is, and how a settled one reads.
 *
 * The list holds every item of every plan it is handed, the latest changed
 * first, under its plan, under the person whose agent asks it, or in one
 * run with no groups, the items its tab takes: what needs the reader, what
 * is unread, every open item, or everything, each tab counting its own.
 * An item is the reader's where they started the agent that asks it,
 * or where the service does not say who did, as main counts what waits on
 * the account (`agent-notices.ts`), and only the reader's open items need
 * them: Needs you lists only those, though the steps through any tab keep the
 * item chosen, while a teammate's open item stands in the list as waiting
 * on them. A settled item keeps everything its agent offered,
 * the developer's pick marked, and says who settled it and what they
 * wrote. A task's board, which counts what waits, holds what waits the
 * oldest posted first, since it has held its agent longest, and what is
 * settled, answered or taken back by its agent, the latest changed first.
 * Every item the task's inbox holds is
 * drawn, whether or not the window's list of agents has caught up with the
 * agent that posted it, since the service reads the inbox by task and an
 * agent's items go with it. A card's answer is held to the same rule the
 * service holds it to (`inbox-wire.ts`'s `inboxReplyRefusal`), so a press
 * the service would refuse is never offered; an item asking a response
 * this build does not know holds no answer at all. A code block's lines
 * are read as the File tab reads a file, at the block's commit, with a few
 * of the file around them, the lines it points at lit. Nothing here draws.
 */

/**
 * What the developer has put on a card so far: the options picked on a
 * choice, the fields filled on a form, their note, and the files they
 * attached to it; on a thread, the steps ticked in its open `do` ask and the
 * answer pressed in it and attached to the reply (Mark done, Couldn't do it,
 * Submit, or Answer), a `decide`'s pick being its choices.
 */
export interface InboxDraft {
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly note: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly steps?: readonly number[] | undefined;
  readonly press?: InboxReplyKind | undefined;
}

export const EMPTY_INBOX_DRAFT: InboxDraft = { choices: [], values: [], note: "", attachments: [] };

/** One file an answer or a message on the thread carried, as an item read names it. */
type InboxFile = NonNullable<InboxItem["answerFiles"]>[number];

/**
 * The files an answer or a message on the thread carried as chips, in the
 * order they were attached: each by its name and type, its bytes as the
 * `data:` URL its read came back as where it did, and none while it is
 * read or where the read did not answer, which draws the chip by its name
 * alone.
 */
export function inboxFileChips(
  files: readonly InboxFile[],
  urls: ReadonlyMap<string, { readonly url: string } | { readonly failed: true }>,
): FileChip[] {
  return files.map((file) => {
    const read = urls.get(file.attachmentId);
    return {
      name: file.name,
      mediaType: file.mediaType,
      url: read !== undefined && "url" in read ? read.url : "",
    };
  });
}

/** The board as the tab draws it. */
export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

/** The task's board from its inbox: what waits the oldest posted first, and what is settled the latest changed first. */
export function inboxBoard(items: readonly InboxItem[]): InboxBoardView {
  return {
    open: items
      .filter((item) => item.status === INBOX_STATUS.OPEN)
      .toSorted((a, b) => a.postedAt - b.postedAt),
    settled: items
      .filter((item) => item.status !== INBOX_STATUS.OPEN)
      .toSorted((a, b) => b.updatedAt - a.updatedAt),
  };
}

/** What the draft holds for the field, or nothing where it is untouched. */
export function fieldValueOf(draft: InboxDraft, label: string): InboxFieldValue | undefined {
  return draft.values.find((each) => each.label === label)?.value;
}

/** The draft with the field set to the value, or cleared where none. */
export function withValue(
  draft: InboxDraft,
  label: string,
  value: InboxFieldValue | undefined,
): InboxDraft {
  const others = draft.values.filter((each) => each.label !== label);
  return { ...draft, values: value === undefined ? others : [...others, { label, value }] };
}

/**
 * The answer's kind for what the card holds: a press where one was given,
 * else the decision an approval or a to-do holds, the nod a note is
 * answered by, the options picked, the form filled, or the developer's
 * words or files.
 */
function replyKindOf(
  item: Pick<InboxItem, "response">,
  draft: InboxDraft,
  press: InboxReplyKind | undefined,
): InboxReplyKind | undefined {
  if (press !== undefined) return press;
  const response = item.response;
  if (!knownResponse(response)) return undefined;
  if (response.type === INBOX_RESPONSE.APPROVAL || response.type === INBOX_RESPONSE.TODO) {
    return decidedOf(response, draft);
  }
  if (response.type === INBOX_RESPONSE.NONE) return INBOX_REPLY.ACKNOWLEDGED;
  if (response.type === INBOX_RESPONSE.CHOICE && draft.choices.length > 0) return INBOX_REPLY.CHOSE;
  if (response.type === INBOX_RESPONSE.FORM) return INBOX_REPLY.SUBMITTED;
  return draft.note.trim() === "" && draft.attachments.length === 0
    ? undefined
    : INBOX_REPLY.ANSWERED;
}

/** A form's values as sent, in the form's own order: words trimmed, a field left blank left out, and a switch left alone sent as no. */
function sentValues(form: Pick<InboxForm, "fields">, draft: InboxDraft): readonly InboxFormValue[] {
  return form.fields.flatMap((field) => {
    const held = fieldValueOf(draft, field.label);
    const value =
      held === undefined ? (field.type === INBOX_FIELD.BOOLEAN ? false : undefined) : held;
    if (value === undefined) return [];
    const sent = isWireString(value) ? value.trim() : value;
    return sent === "" ? [] : [{ label: field.label, value: sent }];
  });
}

/**
 * The answer the card holds, or nothing where it holds none the item
 * takes: a choice is answered by its options, with the note beside them,
 * or by the developer's own words; an approval and a task by the decision
 * picked, or a press given, and an item asking nothing by its nod, with the
 * note beside them; words by words; a
 * form by its fields, with the note beside them. The files attached go
 * beside any of these, and stand for the developer's own words where they
 * wrote none, as a message's do; they travel apart from the answer.
 */
export function inboxReply(
  item: Pick<InboxItem, "response">,
  draft: InboxDraft,
  press?: InboxReplyKind,
): InboxReply | undefined {
  const response = item.response;
  if (!knownResponse(response)) return undefined;
  const reply = replyKindOf(item, draft, press);
  if (reply === undefined) return undefined;
  const note = draft.note.trim();
  // A note past the wire's bound is no answer the service would take, so the card offers no send for it.
  if (note.length > INBOX_BOUNDS.MAX_NOTE_CHARS) return undefined;
  const answer: InboxReply = {
    reply,
    ...(reply === INBOX_REPLY.CHOSE ? { choices: draft.choices } : undefined),
    ...(response.type === INBOX_RESPONSE.FORM
      ? { values: sentValues(response, draft) }
      : undefined),
    ...(note === "" ? undefined : { note }),
  };
  return inboxReplyRefusal(item, answer, draft.attachments) === undefined ? answer : undefined;
}

/** What an open item's answer still lacks: an option picked, a required field filled, or the developer's own words. */
export const INBOX_MISSING = {
  OPTION: "option",
  FIELD: "field",
  WORDS: "words",
} as const;

/** What the answer lacks, with the line the box's foot says it in; a field's by its label. */
export type InboxMissing =
  | { readonly kind: typeof INBOX_MISSING.OPTION; readonly line: string }
  | { readonly kind: typeof INBOX_MISSING.FIELD; readonly label: string; readonly line: string }
  | { readonly kind: typeof INBOX_MISSING.WORDS; readonly line: string };

/** What the box's foot says an answer lacks, by what it lacks. */
const MISSING_LINE = {
  ONE: "Pick an option",
  MANY: "Pick at least one",
  APPROVAL: "Approve or decline",
  TODO: "Tick it, or say you couldn't",
  WORDS: "Write your answer",
} as const;

/**
 * What the card's answer still lacks, the first thing in the item's order,
 * or nothing where it lacks nothing it can be told to fill: a choice with
 * no pick and no words of the developer's own lacks an option, a form its
 * first required field left empty, an approval or a to-do its decision,
 * and words their words. A note lacks nothing, its nod being its answer.
 */
export function inboxMissing(
  item: Pick<InboxItem, "response">,
  draft: InboxDraft,
): InboxMissing | undefined {
  const response = item.response;
  if (!knownResponse(response)) return undefined;
  const ownWords = draft.note.trim() !== "" || draft.attachments.length > 0;
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      if (draft.choices.length > 0 || ownWords) return undefined;
      return {
        kind: INBOX_MISSING.OPTION,
        line: response.multiple === true ? MISSING_LINE.MANY : MISSING_LINE.ONE,
      };
    case INBOX_RESPONSE.FORM: {
      const sent = new Set(sentValues(response, draft).map((value) => value.label));
      const empty = response.fields.find(
        (field) => field.required === true && !sent.has(field.label),
      );
      return empty === undefined
        ? undefined
        : { kind: INBOX_MISSING.FIELD, label: empty.label, line: `Fill in ${empty.label}` };
    }
    case INBOX_RESPONSE.TEXT:
      return ownWords ? undefined : { kind: INBOX_MISSING.WORDS, line: MISSING_LINE.WORDS };
    case INBOX_RESPONSE.APPROVAL:
    case INBOX_RESPONSE.TODO:
      if (decidedOf(response, draft) !== undefined) return undefined;
      return {
        kind: INBOX_MISSING.OPTION,
        line: response.type === INBOX_RESPONSE.APPROVAL ? MISSING_LINE.APPROVAL : MISSING_LINE.TODO,
      };
    default:
      return undefined;
  }
}

/** A response decided by a pick of two, the one going ahead and the one holding back: an approval, or a to-do. */
export type InboxDecided = Extract<
  InboxResponse,
  { type: typeof INBOX_RESPONSE.APPROVAL | typeof INBOX_RESPONSE.TODO }
>;

/** What an approval or a to-do may be decided as, the one going ahead first, as its cards stand. */
export function decisionsOf(
  response: InboxDecided,
): readonly { readonly reply: InboxReplyKind; readonly label: string }[] {
  const { ahead, back } = INBOX_PRESSES[response.type];
  return [ahead, back];
}

/**
 * The decision the card holds for an approval or a to-do, or none yet.
 * Note that the draft holds it as its one pick, by its reply's kind, so it
 * is kept with the card's words as a choice's pick is.
 */
export function decidedOf(response: InboxDecided, draft: InboxDraft): InboxReplyKind | undefined {
  const held = draft.choices[0];
  return decisionsOf(response).find((decision) => decision.reply === held)?.reply;
}

/** The draft holding the decision given, in place of any before it. */
export function withDecision(draft: InboxDraft, reply: InboxReplyKind): InboxDraft {
  return { ...draft, choices: [reply] };
}

/**
 * The draft after the open item's option numbered `number`, counted from
 * one, is picked by its key: a choice's option, as `withChoice` picks it,
 * or an approval's or a to-do's decision, the one going ahead first; none
 * where the item has no such option.
 */
export function numberedPick(
  item: Pick<InboxItem, "response">,
  draft: InboxDraft,
  number: number,
): InboxDraft | undefined {
  const response = item.response;
  if (!knownResponse(response)) return undefined;
  if (response.type === INBOX_RESPONSE.CHOICE) {
    const option = response.options[number - 1];
    return option === undefined ? undefined : withChoice(response, draft, option.label);
  }
  if (response.type !== INBOX_RESPONSE.APPROVAL && response.type !== INBOX_RESPONSE.TODO) {
    return undefined;
  }
  const decision = decisionsOf(response)[number - 1];
  return decision === undefined ? undefined : withDecision(draft, decision.reply);
}

/**
 * The draft after the option labelled is picked by its number: the one
 * pick of a choice of one, which picking again keeps, or one more of a
 * choice of several, which picking again lets go, as a press on its row
 * would.
 */
export function withChoice(
  choice: Pick<InboxChoice, "multiple">,
  draft: InboxDraft,
  label: string,
): InboxDraft {
  if (choice.multiple !== true) return { ...draft, choices: [label] };
  const choices = draft.choices.includes(label)
    ? draft.choices.filter((each) => each !== label)
    : [...draft.choices, label];
  return { ...draft, choices };
}

/** What the box's foot says of a choice of several: how many are picked, or that any may be. */
export function pickedWords(count: number): string {
  return count === 0 ? "Pick any that apply" : `${count} picked`;
}

/** What follows an item's question on its thread: a message on it, or where it was settled. */
export const THREAD_ENTRY = {
  MESSAGE: "message",
  SETTLED: "settled",
} as const;

export type ThreadEntry =
  | { readonly kind: typeof THREAD_ENTRY.MESSAGE; readonly message: InboxMessage }
  | { readonly kind: typeof THREAD_ENTRY.SETTLED; readonly at: number };

/**
 * When the item was answered or taken back; none while it waits. Note that
 * a service before the stamp says only when the item last changed, which
 * stands in for it.
 */
export function settledAt(item: InboxItem): number | undefined {
  if (item.status === INBOX_STATUS.OPEN) return undefined;
  return item.settledAt ?? item.updatedAt;
}

/**
 * What follows an item's question on its thread, in the order it was
 * written: its messages and, on a settled item, its answer or its agent
 * taking it back, each at its own moment, so a message written while the
 * item waited stands before the answer that came after it. A message
 * written in the same instant as the settlement follows it.
 */
export function threadEntries(item: InboxItem): readonly ThreadEntry[] {
  const messages: ThreadEntry[] = (item.messages ?? []).map((message) => ({
    kind: THREAD_ENTRY.MESSAGE,
    message,
  }));
  const at = settledAt(item);
  if (at === undefined) return messages;
  const after = messages.findIndex(
    (entry) => entry.kind === THREAD_ENTRY.MESSAGE && entry.message.createdAt > at,
  );
  const settled: ThreadEntry = { kind: THREAD_ENTRY.SETTLED, at };
  return after === -1
    ? [...messages, settled]
    : [...messages.slice(0, after), settled, ...messages.slice(after)];
}

/** Whether the thread an item read carries is cut to its latest messages, so earlier ones stand only in the agent's tab. */
export function threadCut(item: InboxItem): boolean {
  return (item.messages ?? []).length >= INBOX_BOUNDS.MAX_MESSAGES_READ;
}

/** A message on an item's thread as the box holds it: its words trimmed and the files attached. */
export interface InboxMessageDraft {
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
}

/**
 * The message the box holds on an item's thread, or nothing where it holds
 * none the service would take: words or files or both, never neither, and
 * words within the thread's bound. The options picked and the fields
 * filled while the item waited are no part of a message.
 */
export function inboxMessageOf(draft: InboxDraft): InboxMessageDraft | undefined {
  const text = draft.note.trim();
  if (text.length > INBOX_BOUNDS.MAX_MESSAGE_CHARS) return undefined;
  if (text === "" && draft.attachments.length === 0) return undefined;
  return { text, attachments: draft.attachments };
}

/**
 * The thread an item is drawn as from version 5, or nothing where it is
 * drawn from the fields a desktop before it reads: a thread holding an ask,
 * or one a note opens, the agent's words with nothing in the item's blocks,
 * since a post that asks nothing leaves those empty. An item from before
 * version 5, whose question its blocks hold and whose thread asks nothing,
 * is drawn as it always was.
 */
export function inboxThreadOf(item: InboxItem): readonly InboxMessage[] | undefined {
  const thread = item.thread ?? [];
  if (thread.some((message) => message.ask !== undefined)) return thread;
  const opens = thread[0]?.author === INBOX_MESSAGE_AUTHOR.AGENT;
  return opens && item.blocks.length === 0 ? thread : undefined;
}

/** An ask this build knows, as a read carries it, with where it stands. */
export type InboxKnownAsk = Extract<InboxReadAsk, { type: InboxAsk["type"] }>;

/** A `decide` ask as a read carries it. */
export type InboxDecideAsk = Extract<InboxKnownAsk, { type: typeof INBOX_ASK.DECIDE }>;

/** A `do` ask as a read carries it. */
export type InboxDoAsk = Extract<InboxKnownAsk, { type: typeof INBOX_ASK.DO }>;

/** Whether an ask read off the wire is one this build knows, which its type decides. */
export function knownAsk(ask: InboxReadAsk): ask is InboxKnownAsk {
  return Object.values<string>(INBOX_ASK).includes(ask.type);
}

/** The message whose ask waits on an answer, and the ask; none where nothing waits. */
export interface InboxAsking {
  readonly message: InboxMessage;
  readonly ask: InboxReadAsk;
}

/** The thread's open ask: the latest message whose ask stands open; none where none does. */
export function openAskOf(thread: readonly InboxMessage[]): InboxAsking | undefined {
  const message = thread.findLast((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN);
  return message?.ask === undefined ? undefined : { message, ask: message.ask };
}

/** The most characters an option may spell and still stand as one of two small buttons. */
const BUTTON_OPTION_CHARS = 24;

/**
 * Whether a `decide` is a yes or no in other words, approve or decline,
 * approve or request changes: exactly two short options of one pick with no
 * detail, drawn as two small buttons, the first going ahead and the second
 * holding back.
 */
export function decideButtons(ask: Pick<InboxDecideAsk, "options" | "multiple">): boolean {
  return (
    ask.multiple !== true &&
    ask.options.length === 2 &&
    ask.options.every(
      (option) => option.detail === undefined && option.label.length <= BUTTON_OPTION_CHARS,
    )
  );
}

/** How many steps a `do` ask shows: its own, or one, the item's title, for a to-do from before version 5 that named none. */
export function shownSteps(ask: Pick<InboxDoAsk, "steps">): number {
  return Math.max(ask.steps.length, 1);
}

/** The steps the draft ticks, in order, each once. */
function tickedSteps(draft: InboxDraft): readonly number[] {
  return [...new Set(draft.steps ?? [])].toSorted((a, b) => a - b);
}

/** Whether every step the ask shows is ticked, which Mark done waits for. */
export function everyStepTicked(ask: Pick<InboxDoAsk, "steps">, draft: InboxDraft): boolean {
  const ticked = new Set(draft.steps ?? []);
  return Array.from({ length: shownSteps(ask) }, (_, at) => at).every((at) => ticked.has(at));
}

/** The draft with the step at `at` ticked, or let go where it was. */
export function withStep(draft: InboxDraft, at: number): InboxDraft {
  const ticked = tickedSteps(draft);
  const steps = ticked.includes(at) ? ticked.filter((each) => each !== at) : [...ticked, at];
  return { ...draft, steps };
}

/** Whether a form's required fields are filled as the draft holds them, which Submit waits for. */
export function formFilled(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const sent = new Set(sentValues(form, draft).map((value) => value.label));
  return form.fields.every((field) => field.required !== true || sent.has(field.label));
}

/**
 * The answer the draft attaches to the reply for the open ask, or none: a
 * `decide`'s options picked, a `do`'s Mark done or Couldn't do it with the
 * steps ticked, an `answer`'s Submit with its fields' values, or its Answer,
 * whose words are the reply's own. Note that the title standing as a `do`'s
 * one step is ticked on the card alone, since the ask names no such step.
 */
export function attachedAnswers(asking: InboxAsking, draft: InboxDraft): InboxAnswers | undefined {
  const { ask } = asking;
  if (!knownAsk(ask)) return undefined;
  const id = asking.message.id;
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return draft.choices.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.CHOSE, choices: draft.choices };
    case INBOX_ASK.DO: {
      if (draft.press !== INBOX_REPLY.DONE && draft.press !== INBOX_REPLY.NOT_DONE)
        return undefined;
      const steps = tickedSteps(draft).filter((at) => at < ask.steps.length);
      return { ask: id, reply: draft.press, steps };
    }
    case INBOX_ASK.ANSWER:
      if (ask.fields !== undefined) {
        return draft.press === INBOX_REPLY.SUBMITTED
          ? {
              ask: id,
              reply: INBOX_REPLY.SUBMITTED,
              values: sentValues({ fields: ask.fields }, draft),
            }
          : undefined;
      }
      return draft.press === INBOX_REPLY.ANSWERED
        ? { ask: id, reply: INBOX_REPLY.ANSWERED }
        : undefined;
  }
}

/**
 * The draft after the open ask's option numbered `number`, counted from
 * one, is picked by its key: a `decide`'s, as `withChoice` picks it, the
 * first of two buttons going ahead; none for any other ask.
 */
export function askNumberedPick(
  ask: InboxReadAsk,
  draft: InboxDraft,
  number: number,
): InboxDraft | undefined {
  if (!knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  const option = ask.options[number - 1];
  return option === undefined ? undefined : withChoice(ask, draft, option.label);
}

/** The draft with its attached answer taken off: the pick let go, or the press. */
export function withoutAnswer(draft: InboxDraft): InboxDraft {
  return { ...draft, choices: [], press: undefined };
}

/** What a reply sends on a thread: its words, its files, and the answer to the open ask it carries, if any. */
export interface InboxThreadSend {
  readonly text: string;
  readonly attachments: readonly CodingAgentAttachment[];
  readonly answers?: InboxAnswers;
}

/**
 * What the box sends on a thread, or nothing where the service would take
 * nothing: a plain reply of words or files or both, never neither, or the
 * answer attached, with whatever words and files go with it, which the ask
 * must take as it stands (`inboxAnswersRefusal`); words within the bound.
 */
export function inboxThreadSend(
  thread: readonly InboxMessage[],
  draft: InboxDraft,
): InboxThreadSend | undefined {
  const text = draft.note.trim();
  if (text.length > INBOX_BOUNDS.MAX_MESSAGE_CHARS) return undefined;
  const { attachments } = draft;
  const asking = openAskOf(thread);
  const answers = asking === undefined ? undefined : attachedAnswers(asking, draft);
  if (asking === undefined || answers === undefined || !knownAsk(asking.ask)) {
    return text === "" && attachments.length === 0 ? undefined : { text, attachments };
  }
  const refusal = inboxAnswersRefusal(asking.ask, answers, text, attachments);
  return refusal === undefined ? { text, attachments, answers } : undefined;
}

/** Which way an answer goes: ahead, a check in green, or holding back, a turn back in red. */
export const ANSWER_TONE = {
  AHEAD: "ahead",
  BACK: "back",
} as const;

type AnswerTone = (typeof ANSWER_TONE)[keyof typeof ANSWER_TONE];

/** An answer as words: what the reply's stamp says, attached or sent, and which way it goes. */
export interface AnswerStamp {
  readonly tone: AnswerTone;
  readonly words: string;
}

/** The pick of two buttons' past tense, where its words are an act this build can say done; nothing for another. */
const DONE_WORDS: ReadonlyMap<string, string> = new Map([
  ["Approve", "Approved"],
  ["Decline", "Declined"],
  ["Request changes", "Requested changes"],
]);

/** The two buttons' pick an answer makes, and which of the two it is; none where the ask is no pair of buttons. */
function buttonPick(
  answers: InboxAnswers,
  ask: InboxReadAsk | undefined,
): { readonly label: string; readonly tone: AnswerTone } | undefined {
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  if (!decideButtons(ask) || answers.reply !== INBOX_REPLY.CHOSE) return undefined;
  const label = answers.choices?.[0];
  const at = ask.options.findIndex((option) => option.label === label);
  if (label === undefined || at < 0) return undefined;
  return { label, tone: at === 0 ? ANSWER_TONE.AHEAD : ANSWER_TONE.BACK };
}

/** The steps a `do` answer ticked of those its ask shows, "2/3"; nothing where the ask named none. */
function stepCount(answers: InboxAnswers, ask: InboxReadAsk | undefined): string | undefined {
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DO) return undefined;
  if (ask.steps.length === 0) return undefined;
  return `${(answers.steps ?? []).length}/${ask.steps.length}`;
}

/** Words with a count after them where there is one. */
function counting(words: string, count: string | undefined): string {
  return count === undefined ? words : `${words} ${count}`;
}

/** Whether an answer holds back: Couldn't do it, or the second of two buttons. */
function toneOf(answers: InboxAnswers, ask: InboxReadAsk | undefined): AnswerTone {
  const pick = buttonPick(answers, ask);
  if (pick !== undefined) return pick.tone;
  return answers.reply === INBOX_REPLY.NOT_DONE || answers.reply === INBOX_REPLY.DECLINED
    ? ANSWER_TONE.BACK
    : ANSWER_TONE.AHEAD;
}

/** What each answer but a pick or a to-do's says it was, once sent. */
const SENT_WORDS = {
  [INBOX_REPLY.CHOSE]: "chose",
  [INBOX_REPLY.APPROVED]: "approved",
  [INBOX_REPLY.DECLINED]: "declined",
  [INBOX_REPLY.ANSWERED]: "answered",
  [INBOX_REPLY.DONE]: "done",
  [INBOX_REPLY.NOT_DONE]: "couldn't do it",
  [INBOX_REPLY.SUBMITTED]: "submitted",
  [INBOX_REPLY.ACKNOWLEDGED]: "acknowledged",
} as const satisfies Record<InboxReplyKind, string>;

/** What each press attached to a reply says, and what the send it renames reads. */
const PRESS_WORDS = {
  [INBOX_REPLY.CHOSE]: "Choose",
  [INBOX_REPLY.APPROVED]: "Approve",
  [INBOX_REPLY.DECLINED]: "Decline",
  [INBOX_REPLY.ANSWERED]: "Answer",
  [INBOX_REPLY.DONE]: "Mark done",
  [INBOX_REPLY.NOT_DONE]: "Couldn't do it",
  [INBOX_REPLY.SUBMITTED]: "Submit",
  [INBOX_REPLY.ACKNOWLEDGED]: "Got it",
} as const satisfies Record<InboxReplyKind, string>;

/**
 * What a sent answer's stamp says on the thread, in the past: "Approved",
 * "Requested changes", "Chose 7 days", "Done 3/3", "Couldn't do it 1/3",
 * "Submitted", or "Answered". The ask it answers is read where the thread
 * still carries it.
 */
export function sentStamp(answers: InboxAnswers, ask: InboxReadAsk | undefined): AnswerStamp {
  const tone = toneOf(answers, ask);
  const pick = buttonPick(answers, ask);
  const chose = `Chose ${(answers.choices ?? []).join(", ")}`;
  const words = (() => {
    switch (answers.reply) {
      case INBOX_REPLY.CHOSE:
        return pick === undefined ? chose : (DONE_WORDS.get(pick.label) ?? chose);
      case INBOX_REPLY.DONE:
        return counting("Done", stepCount(answers, ask));
      case INBOX_REPLY.NOT_DONE:
        return counting("Couldn't do it", stepCount(answers, ask));
      default:
        return sentenceCased(SENT_WORDS[answers.reply]);
    }
  })();
  return { tone, words };
}

/**
 * What an attached answer's stamp says over the box, and what the send it
 * renames reads: the button pressed, "Approve" or "Request changes", the
 * options picked, `Choose "7 days"`, or the press, "Mark done", "Submit".
 */
export function attachedStamp(answers: InboxAnswers, ask: InboxReadAsk | undefined): AnswerStamp {
  const tone = toneOf(answers, ask);
  const pick = buttonPick(answers, ask);
  if (pick !== undefined) return { tone, words: pick.label };
  if (answers.reply === INBOX_REPLY.CHOSE) {
    const picked = (answers.choices ?? []).map((choice) => `"${choice}"`).join(", ");
    return { tone, words: `${PRESS_WORDS[INBOX_REPLY.CHOSE]} ${picked}` };
  }
  return { tone, words: PRESS_WORDS[answers.reply] };
}

/**
 * What a settled ask's line says its answerer did, after who they are:
 * "requested changes", "chose 7 days", "marked it done", or what any other
 * answer is called on an item (`REPLY_WORDS`).
 */
export function answeredWords(answers: InboxAnswers, ask: InboxReadAsk | undefined): string {
  const pick = buttonPick(answers, ask);
  const done = pick === undefined ? undefined : DONE_WORDS.get(pick.label);
  if (done !== undefined) return done.toLowerCase();
  if (answers.reply === INBOX_REPLY.CHOSE) {
    return `${REPLY_WORDS[INBOX_REPLY.CHOSE]} ${(answers.choices ?? []).join(", ")}`;
  }
  return REPLY_WORDS[answers.reply];
}

/** The message that answers an ask, where the thread read carries it. */
export function answerOf(
  thread: readonly InboxMessage[],
  messageId: string,
): InboxMessage | undefined {
  return thread.find((message) => message.answers?.ask === messageId);
}

/** How many messages a thread's line counts, "1 message", "6 messages". */
export function messagesWords(count: number): string {
  return counted(count, "message");
}

/**
 * The two ways an approval and a to-do are decided, the one that holds
 * back and the one that goes ahead, and the nod a note is answered by:
 * the Inbox's cards in the question and a chat ask's presses (`chat-ask.tsx`)
 * name them alike, and a settled item keeps them as what it offered.
 */
export const INBOX_PRESSES = {
  [INBOX_RESPONSE.APPROVAL]: {
    back: { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  },
  [INBOX_RESPONSE.TODO]: {
    back: { reply: INBOX_REPLY.NOT_DONE, label: "Couldn't do it" },
    ahead: { reply: INBOX_REPLY.DONE, label: "Done" },
  },
  [INBOX_RESPONSE.NONE]: {
    back: undefined,
    ahead: { reply: INBOX_REPLY.ACKNOWLEDGED, label: "Got it" },
  },
} as const;

/** The presses a chat ask answers the response by, or nothing where words, a pick, or a form answer it. */
export function pressesOf(
  response: InboxReadResponse,
): (typeof INBOX_PRESSES)[keyof typeof INBOX_PRESSES] | undefined {
  if (!knownResponse(response)) return undefined;
  switch (response.type) {
    case INBOX_RESPONSE.APPROVAL:
    case INBOX_RESPONSE.TODO:
    case INBOX_RESPONSE.NONE:
      return INBOX_PRESSES[response.type];
    default:
      return undefined;
  }
}

/** One thing the agent offered, as a settled item keeps it: its words, whether it was recommended, and whether the developer picked it. */
export interface ProposedOption {
  readonly label: string;
  readonly detail?: string;
  readonly recommended: boolean;
  readonly picked: boolean;
}

/**
 * What a settled item offered, the developer's pick marked: a choice's
 * options, or the presses an approval, a task, or an item asking nothing
 * was answered by; nothing for words or a form, whose answer is what was
 * written. Note that an open item offers none here, because its options
 * are its controls while it waits.
 */
export function proposedOptions(item: InboxItem): readonly ProposedOption[] {
  if (item.status === INBOX_STATUS.OPEN || !knownResponse(item.response)) return [];
  const { response, answer } = item;
  if (response.type === INBOX_RESPONSE.CHOICE) {
    const chosen = answer?.reply === INBOX_REPLY.CHOSE ? (answer.choices ?? []) : [];
    return response.options.map((option) => ({
      label: option.label,
      ...(option.detail === undefined ? undefined : { detail: option.detail }),
      recommended: response.recommended === option.label,
      picked: chosen.includes(option.label),
    }));
  }
  const presses = pressesOf(response);
  if (presses === undefined) return [];
  return [presses.back, presses.ahead].flatMap((press) =>
    press === undefined
      ? []
      : [{ label: press.label, recommended: false, picked: answer?.reply === press.reply }],
  );
}

/** Who settled an item: the developer, by answering it; its agent, by taking it back; or a member, by closing it without an answer. */
export const SETTLED_BY = {
  DEVELOPER: "developer",
  AGENT: "agent",
  CLOSER: "closer",
} as const;

/** What each answer's kind says its answerer did, after who they are. */
const REPLY_WORDS = {
  [INBOX_REPLY.CHOSE]: "chose",
  [INBOX_REPLY.APPROVED]: "approved",
  [INBOX_REPLY.DECLINED]: "declined",
  [INBOX_REPLY.ANSWERED]: "answered",
  [INBOX_REPLY.DONE]: "marked it done",
  [INBOX_REPLY.NOT_DONE]: "couldn't do it",
  [INBOX_REPLY.SUBMITTED]: "filled it in",
  [INBOX_REPLY.ACKNOWLEDGED]: "acknowledged it",
} as const satisfies Record<InboxReplyKind, string>;

/**
 * How a settled item came to be settled: answered, by the item's
 * `answeredBy`, whom its line names before what they did in a few words
 * (`did`: "chose Postgres"), with a form's values one per line and the note
 * they wrote, which is Markdown as their box wrote it, its mentions links;
 * taken back by its agent, said whole, and why; or closed by a member
 * without an answer, by the item's `closedBy`.
 */
export type Settlement =
  | {
      readonly by: typeof SETTLED_BY.DEVELOPER;
      readonly did: string;
      readonly values?: string;
      readonly note?: string;
    }
  | { readonly by: typeof SETTLED_BY.AGENT; readonly lead: string; readonly words?: string }
  | { readonly by: typeof SETTLED_BY.CLOSER };

/**
 * Whether an item was closed by a member without an answer rather than taken
 * back by its agent. Note that the agent's close always says why, so a closed
 * item with no reason is a member's, whose account may be gone since.
 */
function closedByMember(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.CLOSED &&
    (item.closedBy !== undefined || item.closedReason === undefined)
  );
}

/** A form's values as the developer filled them, one per line; nothing where they filled none. */
function valueLines(answer: InboxReply): string | undefined {
  const values = (answer.values ?? []).map(
    ({ label, value }) => `${label}: ${fieldValueWords(value)}`,
  );
  return values.length === 0 ? undefined : values.join("\n");
}

/** How an item was settled, or nothing while it waits: what its answerer did and wrote, or the agent taking it back and why. */
export function settlementOf(item: InboxItem): Settlement | undefined {
  if (item.status === INBOX_STATUS.OPEN) return undefined;
  if (closedByMember(item)) return { by: SETTLED_BY.CLOSER };
  if (item.status === INBOX_STATUS.CLOSED) {
    return {
      by: SETTLED_BY.AGENT,
      lead: "Withdrawn by the agent",
      ...(item.closedReason === undefined ? undefined : { words: item.closedReason }),
    };
  }
  const answer = item.answer;
  if (answer === undefined)
    return { by: SETTLED_BY.DEVELOPER, did: REPLY_WORDS[INBOX_REPLY.ANSWERED] };
  const did =
    answer.reply === INBOX_REPLY.CHOSE
      ? `${REPLY_WORDS[INBOX_REPLY.CHOSE]} ${(answer.choices ?? []).join(", ")}`
      : REPLY_WORDS[answer.reply];
  const values = valueLines(answer);
  return {
    by: SETTLED_BY.DEVELOPER,
    did,
    ...(values === undefined ? undefined : { values }),
    ...(answer.note === undefined ? undefined : { note: answer.note }),
  };
}

/** A member named on an item, as an answer's or a message's writer. */
type InboxMember = NonNullable<InboxItem["answeredBy"]>;

/** What an item a member closed without an answer says of it, after who closed it. */
export const CLOSED_WORDS = "Closed without answering";

/** What parts a preview's words, as a menu's detail parts them. */
const PREVIEW_PART = " · ";

/** What each response an open item asks is called at the head of its row's preview. */
const ASKS_WORDS = {
  [INBOX_RESPONSE.CHOICE]: "Choice",
  [INBOX_RESPONSE.APPROVAL]: "Approval",
  [INBOX_RESPONSE.TEXT]: "Question",
  [INBOX_RESPONSE.TODO]: "To-do",
  [INBOX_RESPONSE.FORM]: "Form",
  [INBOX_RESPONSE.NONE]: "Note",
} as const satisfies Record<InboxResponse["type"], string>;

/** What a row's preview says of an item asking a response this build does not know. */
const ASKS_NEWER = "Open this in a newer Luke";

/** A count with its noun, "1 option", "3 options". */
function counted(count: number, one: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${one}s`;
}

/** The words of an item's first Markdown block on one line; nothing where it has none. */
function contextWords(item: InboxItem): string | undefined {
  for (const block of item.blocks) {
    if (!knownBlock(block) || block.type !== INBOX_BLOCK.MARKDOWN) continue;
    const words = plainWords(block.text);
    if (words !== "") return words;
  }
  return undefined;
}

/**
 * What an open item asks, as its row says it before anyone has written on
 * it: a choice by how many options it offers and whether one is
 * recommended, a form by its fields, and anything else by its kind and the
 * first words of its context.
 */
function asksWords(item: InboxItem): string {
  const response = item.response;
  if (!knownResponse(response)) return ASKS_NEWER;
  const kind = ASKS_WORDS[response.type];
  if (response.type === INBOX_RESPONSE.CHOICE) {
    const recommended = response.options.some((option) => option.label === response.recommended);
    const options = counted(response.options.length, "option");
    return `${kind}${PREVIEW_PART}${options}${recommended ? ", one recommended" : ""}`;
  }
  if (response.type === INBOX_RESPONSE.FORM) {
    return `${kind}${PREVIEW_PART}${counted(response.fields.length, "field")}`;
  }
  const context = contextWords(item);
  return context === undefined ? kind : `${kind}${PREVIEW_PART}${context}`;
}

/** What files alone say where a message or an answer carried no words. */
function filesWords(files: readonly unknown[] | undefined): string | undefined {
  const count = files?.length ?? 0;
  if (count === 0) return undefined;
  return count === 1 ? "Sent a file" : `Sent ${count} files`;
}

/** Words, then a note after them where there is one. */
function withNote(words: string, note: string | undefined): string {
  const said = note === undefined ? "" : plainWords(note);
  return said === "" ? words : `${words}${PREVIEW_PART}${said}`;
}

/**
 * What an answer says in a few words: the options picked, the developer's
 * own words, or what they did, "Approved", each with the note they wrote
 * beside it; files alone where they wrote nothing.
 */
function answerWords(item: InboxItem): string {
  const answer = item.answer;
  if (answer === undefined) return sentenceCased(REPLY_WORDS[INBOX_REPLY.ANSWERED]);
  if (answer.reply === INBOX_REPLY.CHOSE) {
    return withNote((answer.choices ?? []).join(", "), answer.note);
  }
  if (answer.reply === INBOX_REPLY.ANSWERED) {
    const words = answer.note === undefined ? "" : plainWords(answer.note);
    if (words !== "") return words;
    return filesWords(item.answerFiles) ?? sentenceCased(REPLY_WORDS[INBOX_REPLY.ANSWERED]);
  }
  return withNote(sentenceCased(REPLY_WORDS[answer.reply]), answer.note);
}

/** A word set as the start of a sentence. */
export function sentenceCased(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** What a row's media strip shows of an item: a picture by its attachment, or a page by its task and id. */
export const INBOX_MEDIA = {
  IMAGE: "image",
  PAGE: "page",
} as const;

export type InboxMedia =
  | {
      readonly kind: typeof INBOX_MEDIA.IMAGE;
      readonly attachmentId: string;
    }
  | {
      readonly kind: typeof INBOX_MEDIA.PAGE;
      readonly taskId: string;
      readonly pageId: string;
    };

/** How many of an item's media its row shows at most, so a row stays a row. */
const MAX_ROW_MEDIA = 4;

/** The picture types a file on the thread may be drawn as, the ones an image block's attachment is kept as. */
const PICTURE_TYPES: ReadonlySet<string> = new Set(Object.values(INBOX_IMAGE_TYPE));

/**
 * The media an item carries, as its row shows them, at most
 * {@link MAX_ROW_MEDIA}: its image blocks and the pages it names, in the
 * order its blocks hold them, a page named by a link block or by any link
 * in its words, labelled, an `@` mention, or bare, each page once; then the pictures
 * its answer carried, and the pages and pictures its thread's messages
 * name and carry, oldest first. A file that is no picture is no media.
 */
export function inboxMedia(item: InboxItem): readonly InboxMedia[] {
  const found: InboxMedia[] = [];
  const page = (target: string) => {
    const place = readLink(target)?.place;
    if (place?.kind !== LINK_PLACE.PAGE) return;
    const known = found.some(
      (each) =>
        each.kind === INBOX_MEDIA.PAGE &&
        each.taskId === place.planId &&
        each.pageId === place.pageId,
    );
    if (!known) {
      found.push({ kind: INBOX_MEDIA.PAGE, taskId: place.planId, pageId: place.pageId });
    }
  };
  const pictures = (files: readonly { attachmentId: string; mediaType: string }[]) => {
    for (const file of files) {
      if (PICTURE_TYPES.has(file.mediaType)) {
        found.push({ kind: INBOX_MEDIA.IMAGE, attachmentId: file.attachmentId });
      }
    }
  };
  for (const block of item.blocks) {
    if (!knownBlock(block)) continue;
    if (block.type === INBOX_BLOCK.IMAGE) {
      found.push({ kind: INBOX_MEDIA.IMAGE, attachmentId: block.attachmentId });
    } else if (block.type === INBOX_BLOCK.LINK) {
      page(block.url);
    } else if (block.type === INBOX_BLOCK.MARKDOWN) {
      for (const link of linksIn(block.text)) page(link.target);
    }
  }
  pictures(item.answerFiles ?? []);
  for (const message of item.messages ?? []) {
    for (const link of linksIn(message.text)) page(link.target);
    pictures(message.files ?? []);
  }
  return found.slice(0, MAX_ROW_MEDIA);
}

/**
 * The last word in an item's thread, as its row's second line says it,
 * led by who said it: a message on the thread by its writer, "Agent" for
 * the item's own and a member by `nameOf`, which says "You" for the
 * reader; the answer by its answerer, in a few words; the agent taking the
 * item back as "Withdrawn" and why; a member's close by who closed it;
 * and, on an open item nobody has
 * written on, what it asks, "Choice · 3 options, one recommended".
 */
export function inboxPreview(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
): string {
  const last = threadEntries(item).at(-1);
  if (last === undefined) return asksWords(item);
  if (last.kind === THREAD_ENTRY.MESSAGE) {
    const { message } = last;
    const who = message.author === INBOX_MESSAGE_AUTHOR.AGENT ? "Agent" : nameOf(message.member);
    const words = plainWords(message.text);
    return `${who}: ${words === "" ? (filesWords(message.files) ?? "") : words}`;
  }
  if (closedByMember(item)) return `${nameOf(item.closedBy)}: ${CLOSED_WORDS}`;
  if (item.status === INBOX_STATUS.CLOSED) {
    const why = item.closedReason === undefined ? "" : plainWords(item.closedReason);
    return why === "" ? "Withdrawn" : `Withdrawn: ${why}`;
  }
  return `${nameOf(item.answeredBy)}: ${answerWords(item)}`;
}

/**
 * The Inbox's one name for an item waiting on the developer's answer, in
 * each form its surfaces say it: the list's filter, a count's words after
 * its figure, and the line where nothing is listed. A settled item reads
 * as answered. Every surface reads its words here, so the name is changed in
 * this one place.
 */
export const NEEDS_YOU = {
  LABEL: "Needs you",
  COUNT: { one: "needs you", many: "need you" } satisfies CountNoun,
  NONE: "Nothing needs you",
} as const;

/** What an item is listed under: the task its agent works on, or, for an agent with no task, the automation that started it. */
export const INBOX_HOLDER = {
  TASK: "plan",
  AUTOMATION: "automation",
} as const;

/** An agent with no plan as main's read of what waits on the developer names it: its title, its model, the automation that started it, and the workspace it belongs to, where the service names it. */
type InboxAgentLine = Pick<
  AppInboxTasklessItem,
  "agentTitle" | "agentModel" | "automationId" | "workspaceId"
>;

/**
 * The task holding an item, or the automation holding an item of an agent
 * with no task, named as its group's header names it, and its agents as
 * main's read names them, by id; none for the agents no automation the
 * reader may read started.
 */
export type InboxHolder =
  | { readonly kind: typeof INBOX_HOLDER.TASK; readonly task: TaskSummary }
  | {
      readonly kind: typeof INBOX_HOLDER.AUTOMATION;
      readonly automationId: string | null;
      readonly name: string;
      readonly repository: string;
      readonly agents: ReadonlyMap<string, InboxAgentLine>;
    };

/** An agent with no plan as the Inbox groups it: what its group and row name it by, and the workspace whose list holds it; one with an item waiting, or one a link names whose items are all settled. */
export type TasklessInboxAgent = Pick<
  AppInboxTasklessItem,
  | "agentId"
  | "agentTitle"
  | "agentModel"
  | "automationId"
  | "automationName"
  | "repository"
  | "workspaceId"
>;

/** The key a holder's group is folded and drawn by: the task's id, the automation's, or one key for the agents no automation names. */
export function holderKey(holder: InboxHolder): string {
  if (holder.kind === INBOX_HOLDER.TASK) return holder.task.id;
  return holder.automationId ?? NO_AUTOMATION_KEY;
}

/** A task as the holder of its items. */
export function taskHolder(task: TaskSummary): InboxHolder {
  return { kind: INBOX_HOLDER.TASK, task };
}

/** Whether a holder is a task put away in the archive, whose items are read but not answered until it is brought back. */
export function archivedHolder(holder: InboxHolder): boolean {
  return holder.kind === INBOX_HOLDER.TASK && holder.task.archivedAt !== undefined;
}

/**
 * The workspace an item belongs to: its plan's, or, for an agent with no
 * plan, the agent's own, where the service named it; none where it did not,
 * since the Inbox may list an item whose workspace it does not know.
 */
export function itemWorkspaceId(holder: InboxHolder, agentId: string): string | undefined {
  return holder.kind === INBOX_HOLDER.TASK
    ? holder.task.workspaceId
    : holder.agents.get(agentId)?.workspaceId;
}

/** A holder's name as its header and a row's context say it: the task's, or the automation's. */
export function holderName(holder: InboxHolder): string {
  return holder.kind === INBOX_HOLDER.TASK ? holder.task.name : holder.name;
}

/** What one group of agents no readable automation started is keyed by. */
const NO_AUTOMATION_KEY = "no-automation";

/** What the group of agents no automation the reader may read started is called. */
const NO_AUTOMATION_NAME = "Other agents";

/**
 * Whether a waiting item of an agent with no task is listed in the workspace
 * given: one of that workspace's agents', or one whose workspace the service
 * does not name. Note that with no workspace listed every agent's items
 * stand, as every task's do.
 */
export function listedIn(
  entry: Pick<AppInboxTasklessItem, "workspaceId">,
  workspaceId: string | undefined,
): boolean {
  return (
    workspaceId === undefined ||
    entry.workspaceId === undefined ||
    entry.workspaceId === workspaceId
  );
}

/**
 * The groups the items of agents with no task stand in: one per automation
 * that started them, by its name, and one for the agents no automation the
 * reader may read names, each holding every item its agents' reads hold,
 * settled ones too; only the listed workspace's agents, where the service
 * names an agent's workspace, so another workspace's list holds none of
 * them.
 */
export function tasklessGroups(
  waiting: readonly TasklessInboxAgent[],
  read: ReadonlyMap<string, readonly InboxItem[]>,
  workspaceId: string | undefined,
): readonly InboxGroup[] {
  const groups = new Map<string, { holder: InboxHolder; agents: Map<string, InboxAgentLine> }>();
  for (const entry of waiting) {
    if (!listedIn(entry, workspaceId)) continue;
    const key = entry.automationId ?? NO_AUTOMATION_KEY;
    const agents = groups.get(key)?.agents ?? new Map<string, InboxAgentLine>();
    agents.set(entry.agentId, {
      agentTitle: entry.agentTitle,
      agentModel: entry.agentModel,
      automationId: entry.automationId,
      ...(entry.workspaceId === undefined ? undefined : { workspaceId: entry.workspaceId }),
    });
    const holder: InboxHolder = groups.get(key)?.holder ?? {
      kind: INBOX_HOLDER.AUTOMATION,
      automationId: entry.automationId,
      name: entry.automationName ?? NO_AUTOMATION_NAME,
      repository: entry.repository,
      agents,
    };
    groups.set(key, { holder, agents });
  }
  return [...groups.values()].map(({ holder, agents }) => ({
    holder,
    items: [...agents.keys()].flatMap((agentId) => read.get(agentId) ?? []),
  }));
}

/**
 * How the window's Inbox groups its items: under each task, under each
 * person, under where each stands, or in one list with no groups. Note that
 * None keeps the value "Newest first" was kept by, so a list kept that way
 * stays so.
 */
export const INBOX_GROUPING = {
  TASK: "plan",
  PERSON: "person",
  STATUS: "status",
  NONE: "newest",
} as const;

export type InboxGrouping = (typeof INBOX_GROUPING)[keyof typeof INBOX_GROUPING];

/**
 * Which items an Inbox lists, as the tabs under its title choose: what needs
 * the reader (`needsReader`), anything unread, anyone's, every open item, or
 * everything, open and settled; and, on the window's Inbox alone, the items
 * of the archived tasks, which no other tab lists (`desktop-inbox.tsx`).
 */
export const INBOX_SHOW = {
  NEEDS_YOU: "needs-you",
  UNREAD: "unread",
  OPEN: "open",
  ALL: "all",
  ARCHIVED: "archived",
} as const;

export type InboxShow = (typeof INBOX_SHOW)[keyof typeof INBOX_SHOW];

/**
 * How the window's Inbox orders its items: the latest changed first, or
 * the open items first, the one waiting longest first, as a triage reads
 * them, the settled ones after them the latest changed first.
 */
export const INBOX_SORT = {
  LATEST: "latest",
  WAITING: "waiting",
} as const;

export type InboxSort = (typeof INBOX_SORT)[keyof typeof INBOX_SORT];

/** Whose items the window's Inbox lists: everyone's, the reader's own, or one teammate's, by their account and the name they had when chosen, which names them once they leave. */
export const INBOX_WHOSE = {
  EVERYONE: "everyone",
  MINE: "mine",
  PERSON: "person",
} as const;

export type InboxWhose =
  | { readonly kind: typeof INBOX_WHOSE.EVERYONE }
  | { readonly kind: typeof INBOX_WHOSE.MINE }
  | { readonly kind: typeof INBOX_WHOSE.PERSON; readonly userId: string; readonly name: string };

/** Everyone's items, as an Inbox lists them until told otherwise. */
export const EVERYONES: InboxWhose = { kind: INBOX_WHOSE.EVERYONE };

/**
 * Where an item stands, as a list grouped by status heads it: needing the
 * reader, waiting on the teammate whose agent asks it, or answered, which
 * an item its agent took back stands under too.
 */
export const INBOX_STATUS_GROUP = {
  NEEDS_YOU: "needs-you",
  WAITING: "waiting",
  ANSWERED: "answered",
} as const;

export type InboxStatusGroupKind = (typeof INBOX_STATUS_GROUP)[keyof typeof INBOX_STATUS_GROUP];

/** What each status group is folded by, apart from any task's, automation's, or person's key, in the order the groups stand. */
const STATUS_KEY = {
  [INBOX_STATUS_GROUP.NEEDS_YOU]: "status:needs-you",
  [INBOX_STATUS_GROUP.WAITING]: "status:waiting",
  [INBOX_STATUS_GROUP.ANSWERED]: "status:answered",
} as const satisfies Record<InboxStatusGroupKind, string>;

/** How many items each tab lists, filtered out by the tab shown or not; Archived only on an Inbox that offers it. */
export interface InboxCounts {
  readonly [INBOX_SHOW.NEEDS_YOU]: number;
  readonly [INBOX_SHOW.UNREAD]: number;
  readonly [INBOX_SHOW.OPEN]: number;
  readonly [INBOX_SHOW.ALL]: number;
  readonly [INBOX_SHOW.ARCHIVED]?: number;
}

/** One holder, a task or an automation, and every item it holds, as the list is handed them. */
export interface InboxGroup {
  readonly holder: InboxHolder;
  readonly items: readonly InboxItem[];
}

/** One item the list draws, with what holds it. */
export interface InboxListed {
  readonly holder: InboxHolder;
  readonly item: InboxItem;
}

/** The member who started an item's agent, as the service names them. */
export type InboxStarter = NonNullable<InboxItem["startedBy"]>;

/** One person's items, by whoever started the agents that ask them; the reader's own where `starter` is none. */
export interface InboxPersonGroup {
  /** What the group is folded by, apart from any plan's or automation's key. */
  readonly key: string;
  readonly starter: InboxStarter | undefined;
  readonly items: readonly InboxListed[];
}

/** One status's items, as a list grouped by status heads them. */
export interface InboxStatusGroup {
  /** What the group is folded by. */
  readonly key: string;
  readonly status: InboxStatusGroupKind;
  readonly items: readonly InboxListed[];
}

/**
 * The list as it is drawn: a group for each task holding an item it shows,
 * one for each person whose agents ask one, one for each status, or every
 * item in one run; and the reader it was drawn for, whose items alone need
 * them.
 */
export type InboxListView = { readonly readerId: string | undefined } & (
  | { readonly grouping: typeof INBOX_GROUPING.TASK; readonly groups: readonly InboxGroup[] }
  | { readonly grouping: typeof INBOX_GROUPING.NONE; readonly items: readonly InboxListed[] }
  | {
      readonly grouping: typeof INBOX_GROUPING.PERSON;
      readonly groups: readonly InboxPersonGroup[];
    }
  | {
      readonly grouping: typeof INBOX_GROUPING.STATUS;
      readonly groups: readonly InboxStatusGroup[];
    }
);

/**
 * Whether an item is the reader's: its agent started by them, or by nobody
 * the service names, or read before the reader's own id is known, as main
 * counts what waits on the account and as every item read before.
 */
export function readersItem(item: InboxItem, readerId: string | undefined): boolean {
  const starter = item.startedBy?.userId;
  return starter === undefined || readerId === undefined || starter === readerId;
}

/**
 * Whether an open item of an agent with no task, as main lists it, waits on
 * the reader: its agent started by them, or by nobody the service names, or
 * listed before the reader's own id is known, as `readersItem` reads an item.
 * Main lists every member's, as the Inbox lists them, and counts only these.
 */
export function waitsOnReader(
  entry: Pick<AppInboxTasklessItem, "startedBy">,
  readerId: string | undefined,
): boolean {
  return entry.startedBy === undefined || readerId === undefined || entry.startedBy === readerId;
}

/** Whether an item needs the reader: open, and theirs (`readersItem`); a teammate's open item waits on the teammate. */
export function needsReader(item: InboxItem, readerId: string | undefined): boolean {
  return item.status === INBOX_STATUS.OPEN && readersItem(item, readerId);
}

/** Whether a listed item needs the reader (`needsReader`) where it stands: never on a task put away in the archive, which nothing answers until it is back. */
export function needsYou(listed: InboxListed, readerId: string | undefined): boolean {
  return needsReader(listed.item, readerId) && !archivedHolder(listed.holder);
}

/** What a person's group is folded by: their account's id, or one key for the reader's own. */
const PERSON_KEY = { PREFIX: "person:", YOU: "person:you" } as const;

/**
 * The items, in the order given, grouped by who started their agents: the
 * reader's own first, then each teammate's, the one whose first item stands
 * first, each group's items in the order given.
 */
function personGroups(
  items: readonly InboxListed[],
  readerId: string | undefined,
): readonly InboxPersonGroup[] {
  const groups = new Map<
    string,
    { key: string; starter: InboxStarter | undefined; items: InboxListed[] }
  >();
  for (const listed of items) {
    const starter = readersItem(listed.item, readerId) ? undefined : listed.item.startedBy;
    const key = starter === undefined ? PERSON_KEY.YOU : `${PERSON_KEY.PREFIX}${starter.userId}`;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { key, starter, items: [listed] });
    else held.items.push(listed);
  }
  // Note that the groups stand in the order their first item does, which a stable sort keeps behind the reader's own.
  return [...groups.values()].toSorted(
    (a, b) => Number(a.starter !== undefined) - Number(b.starter !== undefined),
  );
}

/** The latest change first. */
function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.updatedAt - a.updatedAt;
}

/** The open items first, the one posted longest ago first, then the settled ones the latest changed first. */
function waitingLongest(a: InboxItem, b: InboxItem): number {
  const aOpen = a.status === INBOX_STATUS.OPEN;
  const bOpen = b.status === INBOX_STATUS.OPEN;
  if (aOpen !== bOpen) return aOpen ? -1 : 1;
  return aOpen ? a.postedAt - b.postedAt : newestFirst(a, b);
}

/** The order a sort lists items in. */
const SORT_ORDER = {
  [INBOX_SORT.LATEST]: newestFirst,
  [INBOX_SORT.WAITING]: waitingLongest,
} as const satisfies Record<InboxSort, (a: InboxItem, b: InboxItem) => number>;

/** Where an item stands for the reader, as a list grouped by status heads it. */
function statusOf(item: InboxItem, readerId: string | undefined): InboxStatusGroupKind {
  if (item.status !== INBOX_STATUS.OPEN) return INBOX_STATUS_GROUP.ANSWERED;
  return readersItem(item, readerId) ? INBOX_STATUS_GROUP.NEEDS_YOU : INBOX_STATUS_GROUP.WAITING;
}

/** The items, in the order given, under where each stands: what needs the reader, what waits on others, and what is answered, a status with nothing in it left out. */
function statusGroups(
  items: readonly InboxListed[],
  readerId: string | undefined,
): readonly InboxStatusGroup[] {
  return Object.values(INBOX_STATUS_GROUP).flatMap((status) => {
    const held = items.filter(({ item }) => statusOf(item, readerId) === status);
    return held.length === 0 ? [] : [{ key: STATUS_KEY[status], status, items: held }];
  });
}

/** Whether an item is one the Whose choice lists: anyone's, the reader's own (`readersItem`), or one the teammate's agent asks. */
function whoseItem(whose: InboxWhose, item: InboxItem, readerId: string | undefined): boolean {
  switch (whose.kind) {
    case INBOX_WHOSE.EVERYONE:
      return true;
    case INBOX_WHOSE.MINE:
      return readersItem(item, readerId);
    case INBOX_WHOSE.PERSON:
      return item.startedBy?.userId === whose.userId;
  }
}

/**
 * The list from every task's items: each item in the sort's order, the
 * latest changed first or the one waiting longest first, under its plan,
 * under the person whose agent asks it, under where it stands, or in one
 * run, the tasks and the people in the order their first item stands and
 * the statuses in theirs. The tab shown lists only the items it takes
 * (`showsItem`) of the people Whose names, and the item chosen where one is given. Note that the rows a list draws are given none,
 * so a settled item leaves a list filtered to exclude it, while the steps
 * through the list are given the item the pane shows, which keeps its place
 * among them so K, J, and Next still reach the rows either side of it.
 */
export function inboxList(
  tasks: readonly InboxGroup[],
  view: {
    readonly grouping: InboxGrouping;
    readonly show: InboxShow;
    readonly chosen: string | undefined;
    /** The signed-in account's id, whose own open items alone need them; none counts every item as theirs. */
    readonly readerId: string | undefined;
    /** The order the items stand in; the latest changed first where none is given. */
    readonly sort?: InboxSort | undefined;
    /** Whose items are listed; everyone's where none is given. */
    readonly whose?: InboxWhose | undefined;
  },
): InboxListView {
  const { readerId, sort = INBOX_SORT.LATEST, whose = EVERYONES } = view;
  const order = SORT_ORDER[sort];
  const shows = (holder: InboxHolder) => (item: InboxItem) =>
    (showsItem(view.show, { holder, item }, readerId) && whoseItem(whose, item, readerId)) ||
    item.id === view.chosen;
  const groups = tasks
    .map(({ holder, items }) => ({ holder, items: items.filter(shows(holder)).toSorted(order) }))
    .filter((group) => group.items.length > 0)
    .toSorted((a, b) => firstOrder(a.items[0], b.items[0], order));
  if (view.grouping === INBOX_GROUPING.TASK) {
    return { grouping: INBOX_GROUPING.TASK, groups, readerId };
  }
  const items = groups
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .toSorted((a, b) => order(a.item, b.item));
  if (view.grouping === INBOX_GROUPING.NONE) {
    return { grouping: INBOX_GROUPING.NONE, items, readerId };
  }
  if (view.grouping === INBOX_GROUPING.STATUS) {
    return { grouping: INBOX_GROUPING.STATUS, groups: statusGroups(items, readerId), readerId };
  }
  return { grouping: INBOX_GROUPING.PERSON, groups: personGroups(items, readerId), readerId };
}

/** Two groups in the order their first items stand; a group with none, which the list never draws, last. */
function firstOrder(
  a: InboxItem | undefined,
  b: InboxItem | undefined,
  order: (a: InboxItem, b: InboxItem) => number,
): number {
  if (a === undefined || b === undefined) return Number(a === undefined) - Number(b === undefined);
  return order(a, b);
}

/** Whether an item is unread for the reader: changed since they last read it, or marked unread; an item from a service before read state reads as read. */
export function isUnread(item: InboxItem): boolean {
  return item.unread === true;
}

/** Whether a tab lists the item: Needs you the reader's own open items, Unread anyone's unread, All open every open one, and Everything and Archived all of them. */
function showsItem(show: InboxShow, listed: InboxListed, readerId: string | undefined): boolean {
  const { item } = listed;
  switch (show) {
    case INBOX_SHOW.NEEDS_YOU:
      return needsYou(listed, readerId);
    case INBOX_SHOW.UNREAD:
      return isUnread(item);
    case INBOX_SHOW.OPEN:
      return item.status === INBOX_STATUS.OPEN;
    // Note that the Archived tab is handed the archived tasks' groups alone, every item of which it lists.
    case INBOX_SHOW.ALL:
    case INBOX_SHOW.ARCHIVED:
      return true;
  }
}

/** How many of every task's items each tab lists, of the people Whose names. */
export function inboxCounts(
  tasks: readonly InboxGroup[],
  readerId: string | undefined,
  whose: InboxWhose = EVERYONES,
): InboxCounts {
  const items = tasks
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .filter(({ item }) => whoseItem(whose, item, readerId));
  const count = (show: InboxShow) =>
    items.filter((listed) => showsItem(show, listed, readerId)).length;
  return {
    [INBOX_SHOW.NEEDS_YOU]: count(INBOX_SHOW.NEEDS_YOU),
    [INBOX_SHOW.UNREAD]: count(INBOX_SHOW.UNREAD),
    [INBOX_SHOW.OPEN]: count(INBOX_SHOW.OPEN),
    [INBOX_SHOW.ALL]: count(INBOX_SHOW.ALL),
  };
}

/** Whether any task's item is unread, listed or filtered out. */
export function anyUnread(tasks: readonly InboxGroup[]): boolean {
  return tasks.some(({ items }) => items.some(isUnread));
}

/** Every item the list draws, in the order it draws them. */
export function listedItems(view: InboxListView): readonly InboxListed[] {
  if (view.grouping === INBOX_GROUPING.NONE) return view.items;
  if (view.grouping === INBOX_GROUPING.PERSON) return view.groups.flatMap(({ items }) => items);
  if (view.grouping === INBOX_GROUPING.STATUS) return view.groups.flatMap(({ items }) => items);
  return view.groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));
}

/** Where the chosen item stands among those listed, counted from one, and the items either side of it in the list's order. */
export interface InboxSteps {
  readonly at: number;
  readonly total: number;
  readonly previous: InboxListed | undefined;
  readonly next: InboxListed | undefined;
}

/**
 * The items a reader steps through, in the list's order: every one listed
 * but a folded group's, though the chosen item keeps its place where its
 * group folds, since it stays open, so the steps from it still reach the
 * rows either side.
 */
function rowedItems(
  view: InboxListView,
  folded: (key: string) => boolean,
  chosen: string | undefined,
): readonly InboxListed[] {
  if (view.grouping === INBOX_GROUPING.NONE) return view.items;
  if (view.grouping === INBOX_GROUPING.PERSON || view.grouping === INBOX_GROUPING.STATUS) {
    const keyed: readonly { readonly key: string; readonly items: readonly InboxListed[] }[] =
      view.groups;
    return keyed.flatMap(({ key, items }) =>
      folded(key) ? items.filter(({ item }) => item.id === chosen) : items,
    );
  }
  return view.groups.flatMap(({ holder, items }) => {
    const shut = folded(holderKey(holder));
    return items.filter((item) => !shut || item.id === chosen).map((item) => ({ holder, item }));
  });
}

/** The chosen item's place among the rows, in the list's own order, its grouping and filter as drawn and a folded group's other items left out; none where the list does not hold it. */
export function inboxSteps(
  view: InboxListView,
  chosen: string | undefined,
  folded: (key: string) => boolean,
): InboxSteps | undefined {
  const rowed = rowedItems(view, folded, chosen);
  const at = rowed.findIndex(({ item }) => item.id === chosen);
  if (at < 0) return undefined;
  return { at: at + 1, total: rowed.length, previous: rowed[at - 1], next: rowed[at + 1] };
}

/** The first row after the chosen one whose item needs the reader, in the list's order, wrapping round to its top, a folded group's left out; none where nothing else does. */
export function nextNeedingYou(
  view: InboxListView,
  chosen: string | undefined,
  folded: (key: string) => boolean,
): InboxListed | undefined {
  const listed = rowedItems(view, folded, chosen);
  const at = listed.findIndex(({ item }) => item.id === chosen);
  return [...listed.slice(at + 1), ...listed.slice(0, Math.max(at, 0))].find(
    (listed) => needsYou(listed, view.readerId) && listed.item.id !== chosen,
  );
}

/** The item that stands chosen where none is: the first listed that needs the reader, else the first listed. */
export function firstChoice(view: InboxListView): InboxListed | undefined {
  const listed = listedItems(view);
  return listed.find((each) => needsYou(each, view.readerId)) ?? listed[0];
}

/** How many lines of the file a code block's card draws above and below the lines it points at. */
const CODE_CONTEXT_LINES = 3;

/** Where a code block's card stands with its lines. */
export const CODE_READ = {
  READING: "reading",
  READY: "ready",
  /** The lines are not drawn, for the reason the card says. */
  NOTICE: "notice",
} as const;

export type CodeRead =
  | { readonly kind: typeof CODE_READ.READING }
  | { readonly kind: typeof CODE_READ.READY; readonly code: TaskCode }
  | {
      readonly kind: typeof CODE_READ.NOTICE;
      readonly line: string;
      /** Whether reading again may draw the lines, which the card offers. */
      readonly again: boolean;
    };

/** What a code block's card says where its lines did not come back. */
const CODE_UNREAD = "These lines could not be read.";

/**
 * The window a code block's card reads: the lines it points at with a few
 * of the file around them, at the block's commit. Note that the window may
 * run past the file's end, which the service answers with the lines it has.
 */
export function codeWindow(block: InboxCodeBlock): TaskFileRequest {
  return {
    path: block.path,
    firstLine: Math.max(1, block.startLine - CODE_CONTEXT_LINES),
    lastLine: block.endLine + CODE_CONTEXT_LINES,
    ref: block.sha,
  };
}

/**
 * Why a code block's lines are not read at all, or nothing where they are
 * read: the task reads its own repository alone, which the agent's
 * repository was when it started but may not be once the task names
 * another, and lines that run backwards or past the bound are no window
 * the File tab's read takes. Note that GitHub spells a repository's name in
 * any case.
 */
export function codeNotice(block: InboxCodeBlock, repository: string | null): string | undefined {
  if (repository === null || repository.toLowerCase() !== block.repo.toLowerCase()) {
    return `These lines are in ${block.repo}, which this task no longer reads.`;
  }
  if (!codeLinesReadable(block)) return "These lines cannot be read.";
  return undefined;
}

/**
 * A code block's lines as its card holds them once the read answered: the
 * window the service read at the block's commit, the block's lines lit in
 * it; or why they are not drawn, a file that ends before they do included, and
 * whether reading again may draw them.
 */
export function codeReadOf(block: InboxCodeBlock, answer: TasksFileAnswer): CodeRead {
  if ("refusal" in answer) {
    return {
      kind: CODE_READ.NOTICE,
      line: refusalLine(answer.refusal, answer.branch, block.sha),
      again: refusalPasses(answer.refusal),
    };
  }
  if (!("file" in answer)) return { kind: CODE_READ.NOTICE, line: CODE_UNREAD, again: true };
  const { file } = answer;
  // Note that a file ending inside the lines is said too, because a card
  // drawing some of them would read, and copy, as all the agent meant.
  if (file.firstLine + file.lines.length <= block.endLine) {
    return {
      kind: CODE_READ.NOTICE,
      line: "The file ends before these lines do at this commit.",
      again: false,
    };
  }
  return {
    kind: CODE_READ.READY,
    code: {
      ref: { path: block.path, startLine: block.startLine, endLine: block.endLine },
      repository: file.repository,
      firstLine: file.firstLine,
      lineCount: file.lineCount,
      lines: file.lines,
    },
  };
}

/** A code block's card where the read did not land at all, as main refusing the act leaves it. */
export const CODE_READ_FAILED: CodeRead = {
  kind: CODE_READ.NOTICE,
  line: CODE_UNREAD,
  again: true,
};
