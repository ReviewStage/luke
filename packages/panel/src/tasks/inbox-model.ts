import { ATTACHMENT_VIEW, attachmentView, type FileChip } from "@luke/features/attachment-model";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@luke/features/coding-agent-view";
import type { CodingAgentAttachment, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import {
  INBOX_PICTURE_IN_WORDS,
  inboxAttachmentOf,
  inboxPictureDestination,
} from "@luke/features/inbox-attachment-link";
import {
  codeLinesReadable,
  fieldValueWords,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_FIELD,
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
  type InboxReply,
  type InboxReplyKind,
  type InboxResponse,
  inboxAnswersRefusal,
  inboxReplyRefusal,
  recommendedLabels,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, type ReadLink, readLink } from "@luke/features/link-grammar";
import { insideCode, linksIn } from "@luke/features/mention-link";
import { type PagePlace, pagePlaceId } from "@luke/features/page-wire";
import type { TaskFileRequest, TaskSummary } from "@luke/features/task-wire";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { matchesTokens } from "@luke/ui/search-tokens";
import { isWireString } from "@luke/wire";
import type { CountNoun } from "../desktop/sidebar-group-header.js";
import type { SnippetLines } from "./code-snippet-model.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";
import { plainWords } from "./tool-call-model.js";

/**
 * inbox-model.ts -- the Inbox as pure decisions: which items it lists and how, what an item's answer is, and how a settled one reads.
 *
 * The list holds every item of every plan it is handed, the latest changed
 * first, under its plan, under the person it waits on, or in one
 * run with no groups, the items its tab takes: what needs the reader, what
 * is unread, every open item, or everything, each tab counting its own.
 * An item is the reader's where it waits on them: they are its task's
 * assignee, or, on a task nobody is assigned or an agent's with no task,
 * they started the agent that asks it; or where the service does not say, as main counts what waits on
 * the account (`agent-notices.ts`), and only the reader's open items need
 * them: Needs you lists only those, though the steps through any tab keep the
 * item chosen, while a teammate's open item stands in the list as waiting
 * on them. An item is its title and its thread, each answer a member's
 * message under the ask it answers, and a settled one says how it ended.
 * A task's board, which counts what waits, holds what waits the
 * oldest posted first, since it has held its agent longest, and what is
 * settled, answered or taken back by its agent, the latest changed first.
 * Every item the task's inbox holds is
 * drawn, whether or not the window's list of agents has caught up with the
 * agent that posted it, since the service reads the inbox by task and an
 * agent's items go with it. A reply's answer is held to the same rule the
 * service holds it to (`inbox-wire.ts`'s `inboxAnswersRefusal`), so a press
 * the service would refuse is never sent, and a chat ask's version 4
 * answer to its own (`inboxReplyRefusal`). A code block's lines
 * are read as the File tab reads a file, at the block's commit, with a few
 * of the file around them, the lines it points at lit. Nothing here draws.
 */

/**
 * What the developer has put on a card so far: the options picked on a
 * choice, the fields filled on a form, their note, and the files they
 * attached to it; the steps ticked in its open `do` ask and the
 * answer pressed in it and attached to the reply (Mark done or Couldn't
 * do it), a `decide`'s pick being its choices and an `answer`'s fields
 * filled its values.
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

/** Why a card's last send did not go, or was not taken: its words, and the refusal they say where the service refused it. */
export interface InboxNote {
  readonly words: string;
  readonly failure?: CodingAgentCallFailure | undefined;
}

/** What a card says under its box: the note's words, and whether Unarchive follows them. */
export interface InboxNoteReading {
  readonly words: string;
  readonly unarchive: boolean;
}

/** What a card says of a send refused because its agent is archived on its own. */
const AGENT_ARCHIVED_NOTE = "This agent is archived.";

/**
 * What a card says of its last send, by its agent as the window lists it.
 * Note that the service refuses a send to an agent archived on its own as
 * one that names nothing, so a refusal naming no agent says the agent is
 * archived, with Unarchive after it, where the list reads it archived, and
 * that the agent no longer exists only where it does not.
 */
export function inboxNoteReading(
  note: InboxNote,
  agent: CodingAgentSummary | undefined,
): InboxNoteReading {
  const archived =
    note.failure === CODING_AGENT_CALL_FAILURE.NOT_FOUND && agent?.archivedAt !== undefined;
  return archived
    ? { words: AGENT_ARCHIVED_NOTE, unarchive: true }
    : { words: note.words, unarchive: false };
}

/** One file a message on the thread carried, as an item read names it. */
type InboxFile = NonNullable<InboxMessage["files"]>[number];

/**
 * The files a message on the thread carried as chips, in the
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

/** A comment's files as they are drawn after its words: its pictures, and every other file. */
export interface InboxCommentFiles {
  readonly pictures: readonly InboxFile[];
  readonly others: readonly InboxFile[];
}

/**
 * A comment's files as they are drawn after its words, each in the order
 * attached: a picture its words already draw left out, since it stands
 * where they draw it, as an agent's pictures do, then the pictures and
 * every other file apart, as each is drawn in its own way. A WebM an agent
 * recorded is drawn as a picture is, played in its place (`inbox-pictures.tsx`),
 * so one the words draw is not named again as a file. Note that only
 * a picture the words draw as one is left out (`picturesDrawn`): a file
 * they only link to, quote in code, or name as a picture though it is
 * none is still drawn here, so it can still be opened.
 */
export function inboxCommentFiles(
  files: readonly InboxFile[],
  words: string | undefined,
  itemId: string,
): InboxCommentFiles {
  const picture = (file: InboxFile) =>
    attachmentView({ name: file.name, mediaType: file.mediaType, url: "" }) ===
      ATTACHMENT_VIEW.IMAGE || file.mediaType === CONVERSATION_MEDIA_TYPE.WEBM;
  const drawn = new Set(
    words === undefined ? [] : picturesDrawn(words, itemId).map((each) => each.attachmentId),
  );
  const after = files.filter((file) => !(picture(file) && drawn.has(file.attachmentId)));
  return {
    pictures: after.filter(picture),
    others: after.filter((file) => !picture(file)),
  };
}

/** The board as the tab draws it. */
export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  /** The open items that wait on the reader (`readersItem`), in the order of `open`: what the task's Inbox counts, since a teammate's open item waits on the teammate. */
  readonly waiting: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

/** The task's board from its inbox: what waits the oldest posted first, and what is settled the latest changed first; `readerId` says which of what waits waits on the reader. */
export function inboxBoard(
  items: readonly InboxItem[],
  readerId: string | undefined,
): InboxBoardView {
  const open = items
    .filter((item) => item.status === INBOX_STATUS.OPEN)
    .toSorted((a, b) => a.postedAt - b.postedAt);
  return {
    open,
    waiting: open.filter((item) => readersItem(item, readerId)),
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
  response: InboxResponse,
  draft: InboxDraft,
  press: InboxReplyKind | undefined,
): InboxReplyKind | undefined {
  if (press !== undefined) return press;
  if (response.type === INBOX_RESPONSE.APPROVAL || response.type === INBOX_RESPONSE.TODO) {
    return decidedOf(response, draft);
  }
  if (response.type === INBOX_RESPONSE.NONE) return INBOX_REPLY.ACKNOWLEDGED;
  if (response.type === INBOX_RESPONSE.CHOICE && draft.choices.length > 0) return INBOX_REPLY.CHOSE;
  if (response.type === INBOX_RESPONSE.FORM) {
    return formSendable(response, draft) ? INBOX_REPLY.SUBMITTED : undefined;
  }
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
 * Whether the developer filled any field of a form: a value of theirs it
 * sends. Note that a switch left alone fills nothing, though it is sent as no.
 */
function formFilledIn(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const held = new Set(draft.values.map((value) => value.label));
  return sentValues(form, draft).some((value) => held.has(value.label));
}

/**
 * Whether a form holds something to send: every required field filled, or,
 * where some are left empty, a field the developer filled, or words or
 * files of their own, since a form filled in part sends what was filled.
 */
function formSendable(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const sent = new Set(sentValues(form, draft).map((value) => value.label));
  if (form.fields.every((field) => field.required !== true || sent.has(field.label))) return true;
  if (draft.note.trim() !== "" || draft.attachments.length > 0) return true;
  return formFilledIn(form, draft);
}

/**
 * The answer the card holds, or nothing where it holds none the response
 * takes, as a chat ask's version 4 response is answered (`chat-ask-model.ts`): a choice is answered by its options, with the note beside them,
 * or by the developer's own words; an approval and a task by the decision
 * picked, or a press given, and an item asking nothing by its nod, with the
 * note beside them; words by words; a
 * form by its fields, with the note beside them. The files attached go
 * beside any of these, and stand for the developer's own words where they
 * wrote none, as a message's do; they travel apart from the answer.
 */
export function inboxReply(
  response: InboxResponse,
  draft: InboxDraft,
  press?: InboxReplyKind,
): InboxReply | undefined {
  const reply = replyKindOf(response, draft, press);
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
  return inboxReplyRefusal(response, answer, draft.attachments) === undefined ? answer : undefined;
}

/** What an open ask's answer still lacks: an option picked, a required field filled, or the developer's own words. */
export const INBOX_MISSING = {
  OPTION: "option",
  FIELD: "field",
  WORDS: "words",
} as const;

/** What the answer lacks; a field's by its label. */
export type InboxMissing =
  | { readonly kind: typeof INBOX_MISSING.OPTION }
  | { readonly kind: typeof INBOX_MISSING.FIELD; readonly label: string }
  | { readonly kind: typeof INBOX_MISSING.WORDS };

/**
 * What the card's answer still lacks, the first thing in the response's order,
 * or nothing where it lacks nothing it can be told to fill: a choice with
 * no pick and no words of the developer's own lacks an option, a form with
 * nothing to send its first required field left empty, an approval or a
 * to-do its decision, and words their words. A note lacks nothing, its nod
 * being its answer.
 */
export function inboxMissing(response: InboxResponse, draft: InboxDraft): InboxMissing | undefined {
  const ownWords = draft.note.trim() !== "" || draft.attachments.length > 0;
  switch (response.type) {
    case INBOX_RESPONSE.CHOICE:
      return draft.choices.length > 0 || ownWords ? undefined : { kind: INBOX_MISSING.OPTION };
    case INBOX_RESPONSE.FORM: {
      if (formSendable(response, draft)) return undefined;
      const sent = new Set(sentValues(response, draft).map((value) => value.label));
      const empty = response.fields.find(
        (field) => field.required === true && !sent.has(field.label),
      );
      return empty === undefined ? undefined : { kind: INBOX_MISSING.FIELD, label: empty.label };
    }
    case INBOX_RESPONSE.TEXT:
      return ownWords ? undefined : { kind: INBOX_MISSING.WORDS };
    case INBOX_RESPONSE.APPROVAL:
    case INBOX_RESPONSE.TODO:
      return decidedOf(response, draft) === undefined ? { kind: INBOX_MISSING.OPTION } : undefined;
    default:
      return undefined;
  }
}

/** A response decided by a pick of two, the one going ahead and the one holding back: an approval, or a to-do. */
type InboxDecided = Extract<
  InboxResponse,
  { type: typeof INBOX_RESPONSE.APPROVAL | typeof INBOX_RESPONSE.TODO }
>;

/** What an approval or a to-do may be decided as, the one going ahead first, as its cards stand. */
function decisionsOf(
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

/**
 * Whether an ask is a form of several fields, which Enter alone must not
 * send: it only picks, or breaks a line, since the rest may not be filled in
 * yet, and ⌘ or Ctrl with Enter sends.
 */
export function severalFields(ask: InboxAsk): boolean {
  return ask.type === INBOX_ASK.ANSWER && (ask.fields?.length ?? 0) > 1;
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

/**
 * Whether the item is a notice waiting on the reader's nod: open, and its
 * thread holding no ask open, so Got it settles it and reaches nobody, and
 * a reply settles it as it reaches the agent.
 */
export function awaitsNod(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) === undefined;
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
function shownSteps(ask: Pick<InboxDoAsk, "steps">): number {
  return Math.max(ask.steps.length, 1);
}

/** The steps the draft ticks, in order, each once. */
function tickedSteps(draft: Pick<InboxDraft, "steps">): readonly number[] {
  return [...new Set(draft.steps ?? [])].toSorted((a, b) => a - b);
}

/** Every step a `do` ask shows, by place, in order. */
function everyStep(ask: Pick<InboxDoAsk, "steps">): readonly number[] {
  return Array.from({ length: shownSteps(ask) }, (_, at) => at);
}

/** Whether the reader ticked every step a `do` ask shows by hand. */
function everyStepTicked(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps">,
): boolean {
  const ticked = new Set(tickedSteps(draft));
  return everyStep(ask).every((at) => ticked.has(at));
}

/**
 * The decision a `do` ask's draft holds: the press given, Mark done or
 * Couldn't do it, or else Mark done where every step is ticked by hand,
 * which nothing stores, so letting a step go takes it back off. Note that
 * a press given wins, so Couldn't do it stands with every step ticked.
 */
export function doDecision(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps" | "press">,
): InboxReplyKind | undefined {
  if (draft.press === INBOX_REPLY.DONE || draft.press === INBOX_REPLY.NOT_DONE) return draft.press;
  return everyStepTicked(ask, draft) ? INBOX_REPLY.DONE : undefined;
}

/**
 * The steps a `do` ask's card shows ticked: every one while Mark done is
 * pressed, which ticks them all, or else those the reader ticked by hand,
 * which the draft keeps apart so Couldn't do it still sends only those.
 */
export function shownTicks(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps" | "press">,
): readonly number[] {
  return draft.press === INBOX_REPLY.DONE ? everyStep(ask) : tickedSteps(draft);
}

/**
 * The draft with the step at `at` ticked, or let go where the card shows
 * it ticked. Note that letting a step go under Mark done takes the press
 * off and keeps the others ticked, as the card showed them.
 */
export function withStep(
  ask: Pick<InboxDoAsk, "steps">,
  draft: InboxDraft,
  at: number,
): InboxDraft {
  const ticked = shownTicks(ask, draft);
  if (!ticked.includes(at)) return { ...draft, steps: [...ticked, at] };
  const steps = ticked.filter((each) => each !== at);
  return draft.press === INBOX_REPLY.DONE
    ? { ...draft, steps, press: undefined }
    : { ...draft, steps };
}

/**
 * The draft after a `do` ask's Mark done or Couldn't do it is pressed: the
 * decision it holds (`doDecision`) taken off where it is the one pressed,
 * or else given. Note that taking off a Mark done every step's hand tick
 * stands for lets those ticks go, or it would stand again at once.
 */
export function withDoPress(
  ask: Pick<InboxDoAsk, "steps">,
  draft: InboxDraft,
  reply: typeof INBOX_REPLY.DONE | typeof INBOX_REPLY.NOT_DONE,
): InboxDraft {
  if (doDecision(ask, draft) !== reply) return { ...draft, press: reply };
  const released = { ...draft, press: undefined };
  return reply === INBOX_REPLY.DONE && everyStepTicked(ask, released)
    ? { ...released, steps: [] }
    : released;
}

/**
 * The answer the draft attaches to the reply for the open ask, or none: a
 * `decide`'s options picked, a `do`'s Mark done with every step ticked,
 * pressed or every step ticked by hand, Couldn't do it with the steps
 * ticked, or, with no press, the steps ticked as an answer deciding
 * nothing, an `answer`'s fields' values once
 * any is filled, as a form filled in part sends what was filled, or its
 * Answer, whose words are the reply's own. Note that the title standing as a `do`'s
 * one step is ticked on the card alone, since the ask names no such step.
 */
function attachedAnswers(asking: InboxAsking, draft: InboxDraft): InboxAnswers | undefined {
  const { ask } = asking;
  if (!knownAsk(ask)) return undefined;
  const id = asking.message.id;
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return draft.choices.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.CHOSE, choices: draft.choices };
    case INBOX_ASK.DO: {
      const decision = doDecision(ask, draft);
      const named = (steps: readonly number[]) => steps.filter((at) => at < ask.steps.length);
      if (decision === INBOX_REPLY.DONE) {
        return { ask: id, reply: decision, steps: named(everyStep(ask)) };
      }
      const ticked = named(tickedSteps(draft));
      if (decision === INBOX_REPLY.NOT_DONE) return { ask: id, reply: decision, steps: ticked };
      // Steps ticked with no press go as they stand, an answer that decides nothing.
      return ticked.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.ANSWERED, steps: ticked };
    }
    case INBOX_ASK.ANSWER:
      // A form's fields attach as they are filled, with no press, any filled in part sending what was filled.
      if (ask.fields !== undefined) {
        return formFilledIn({ fields: ask.fields }, draft)
          ? {
              ask: id,
              reply: INBOX_REPLY.SUBMITTED,
              values: sentValues({ fields: ask.fields }, draft),
            }
          : undefined;
      }
      // An ask of words alone is answered by the reply's own words or files, which the box holds as its one field.
      return draft.note.trim() === "" && draft.attachments.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.ANSWERED };
  }
}

/**
 * A settled ask's answer as the draft its controls held when it was sent,
 * which its box draws them filled in with: a `decide`'s picks, a `do`'s
 * steps ticked and its press, the title standing as the one step of a
 * `do` that names none ticked where it was marked done, and an `answer`'s
 * values. A field or a step the answer left empty stands empty.
 */
export function answeredDraft(ask: InboxAsk, answers: InboxAnswers): InboxDraft {
  const titleStep = ask.type === INBOX_ASK.DO && ask.steps.length === 0;
  const done = answers.reply === INBOX_REPLY.DONE;
  return {
    ...EMPTY_INBOX_DRAFT,
    choices: answers.choices ?? [],
    values: answers.values ?? [],
    steps: titleStep ? (done ? [0] : []) : (answers.steps ?? []),
    press: answers.reply,
  };
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

export type AnswerTone = (typeof ANSWER_TONE)[keyof typeof ANSWER_TONE];

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

/**
 * What a sent answer's stamp says on the thread, in the past: "Approved",
 * "Requested changes", "Chose 7 days", "Done 3/3", "Couldn't do it 1/3",
 * a to-do's steps ticked with no press, "Ticked 2/3", "Submitted", or
 * "Answered". The ask it answers is read where the thread
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
      case INBOX_REPLY.ANSWERED: {
        // A to-do's steps ticked with no press decided nothing, so they say what was ticked.
        const count = answers.steps === undefined ? undefined : stepCount(answers, ask);
        return count === undefined ? sentenceCased(SENT_WORDS[answers.reply]) : `Ticked ${count}`;
      }
      default:
        return sentenceCased(SENT_WORDS[answers.reply]);
    }
  })();
  return { tone, words };
}

/** The message that answers an ask, where the thread read carries it. */
export function answerOf(
  thread: readonly InboxMessage[],
  messageId: string,
): InboxMessage | undefined {
  return thread.find((message) => message.answers?.ask === messageId);
}

/**
 * The two ways an approval and a to-do are decided, the one that holds
 * back and the one that goes ahead, as a chat ask's version 4 response
 * names them.
 */
const INBOX_PRESSES = {
  [INBOX_RESPONSE.APPROVAL]: {
    back: { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  },
  [INBOX_RESPONSE.TODO]: {
    back: { reply: INBOX_REPLY.NOT_DONE, label: "Couldn't do it" },
    ahead: { reply: INBOX_REPLY.DONE, label: "Done" },
  },
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

/** What an answer's answerer did, in a few words after who they are: "chose Postgres", "marked it done". */
export function answerDid(answer: InboxReply): string {
  return answer.reply === INBOX_REPLY.CHOSE
    ? `${REPLY_WORDS[INBOX_REPLY.CHOSE]} ${(answer.choices ?? []).join(", ")}`
    : REPLY_WORDS[answer.reply];
}

/** A member named on an item, as an answer's or a message's writer. */
type InboxMember = NonNullable<InboxItem["answeredBy"]>;

/** What an item a member closed without an answer says of it, after who closed it. */
export const CLOSED_WORDS = "Resolved without an answer";

/** What parts a preview's words, as a menu's detail parts them. */
const PREVIEW_PART = " · ";

/** What files alone say where a message or an answer carried no words. */
function filesWords(files: readonly unknown[] | undefined): string | undefined {
  const count = files?.length ?? 0;
  if (count === 0) return undefined;
  return count === 1 ? "Sent a file" : `Sent ${count} files`;
}

/** A word set as the start of a sentence. */
export function sentenceCased(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** What a row's media strip shows of an item: a picture by its attachment, or a page by its place, a task or an agent with no task, and id. */
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
      /** What the page stands on: a task, or an agent with no task. */
      readonly place: PagePlace;
      readonly pageId: string;
    };

/** How many of an item's media its row shows at most, so a row stays a row. */
const MAX_ROW_MEDIA = 4;

/** The types a file on the thread may be drawn as a picture by: the ones an image block's attachment is kept as, or a WebM an agent recorded, played where a picture is drawn. */
const PICTURE_TYPES: ReadonlySet<string> = new Set(Object.values(CONVERSATION_MEDIA_TYPE));

/** The page a link's place names as media: a task's, or an agent with no task's; none for a place that is no page. */
function pageMediaOf(place: ReadLink["place"] | undefined): InboxMedia | undefined {
  if (place?.kind !== LINK_PLACE.PAGE) return undefined;
  const owner = "planId" in place ? { taskId: place.planId } : { agentId: place.agentId };
  return { kind: INBOX_MEDIA.PAGE, place: owner, pageId: place.pageId };
}

/** Whether two media are one picture, or one page of one place. */
function sameMedia(a: InboxMedia, b: InboxMedia): boolean {
  if (a.kind === INBOX_MEDIA.IMAGE) {
    return b.kind === INBOX_MEDIA.IMAGE && b.attachmentId === a.attachmentId;
  }
  return (
    b.kind === INBOX_MEDIA.PAGE &&
    b.pageId === a.pageId &&
    pagePlaceId(b.place) === pagePlaceId(a.place)
  );
}

/**
 * The media an item carries, as its row shows them, at most
 * {@link MAX_ROW_MEDIA}: each message's of its thread in turn, oldest
 * first, the pictures its words draw by their addresses (`picturesDrawn`)
 * and the pages it links to, outside code, labelled, an `@` mention, or
 * bare, in the order its words name them, each once, then the pictures
 * among its files. A file that is no picture is no media.
 */
export function inboxMedia(item: InboxItem): readonly InboxMedia[] {
  const found: InboxMedia[] = [];
  const add = (media: InboxMedia) => {
    if (!found.some((each) => sameMedia(each, media))) found.push(media);
  };
  for (const message of item.thread ?? []) {
    const named: { readonly at: number; readonly media: InboxMedia }[] = [];
    for (const { at, attachmentId } of picturesDrawn(message.text, item.id)) {
      named.push({ at, media: { kind: INBOX_MEDIA.IMAGE, attachmentId } });
    }
    for (const link of linksIn(message.text)) {
      const media = pageMediaOf(readLink(link.target)?.place);
      if (media !== undefined) named.push({ at: link.start, media });
    }
    for (const each of named.toSorted((a, b) => a.at - b.at)) add(each.media);
    for (const file of message.files ?? []) {
      if (PICTURE_TYPES.has(file.mediaType)) {
        add({ kind: INBOX_MEDIA.IMAGE, attachmentId: file.attachmentId });
      }
    }
  }
  return found.slice(0, MAX_ROW_MEDIA);
}

/**
 * The item's own pictures a message's words draw, where each is drawn: a
 * picture, `![alt](address)`, whose address names one of the item's, as
 * the pane draws it (`inbox-pictures.tsx`). Note that one written in code
 * is code, which the pane draws as words, and a bare address is a link.
 */
function picturesDrawn(
  text: string,
  itemId: string,
): readonly { readonly at: number; readonly attachmentId: string }[] {
  return [...text.matchAll(INBOX_PICTURE_IN_WORDS)].flatMap((match) => {
    if (insideCode(text, match.index)) return [];
    const named = inboxAttachmentOf(inboxPictureDestination(match[2] ?? ""));
    return named?.itemId === itemId ? [{ at: match.index, attachmentId: named.attachmentId }] : [];
  });
}

/**
 * An item's row's second line, what it asks or how it ended rather than who
 * said it last, since the row's tile names the agent and its title asks the
 * question. While an ask waits, the ask itself (`askLine`): a choice's
 * options, the recommended one starred, "7 days ★ / 14 days"; a to-do's
 * steps left and the next, as the reader's draft ticks them (`ticked`), "2
 * steps left · Open Vercel"; a form's fields, "Fill in Name, Domain"; or
 * "Write an answer". Else the thread's latest message: an answer by its
 * answerer and its stamp, "You: Chose 7 days · and say it in the docs", a
 * member's words by their writer, and the agent's words alone, its tile
 * saying who.
 */
export function inboxPreview(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
  ticked?: readonly number[],
): string {
  const thread = item.thread ?? [];
  const asking = openAskOf(thread);
  if (asking !== undefined && knownAsk(asking.ask)) return askLine(asking.ask, ticked ?? []);
  return lastSaid(thread, nameOf);
}

/** What an item's second line leads with, as its glyph says it: the kind of ask that waits, an answer that settled it, or words alone. */
export const INBOX_LINE = {
  DECIDE: "decide",
  DO: "do",
  ANSWER: "answer",
  SETTLED: "settled",
  SAID: "said",
} as const;

export type InboxLineKind = (typeof INBOX_LINE)[keyof typeof INBOX_LINE];

/** Which glyph leads an item's second line (`inboxPreview`): its open ask's kind, an answer where its latest message carries one, or none. */
export function inboxLineKind(item: InboxItem): InboxLineKind {
  const thread = item.thread ?? [];
  const asking = openAskOf(thread);
  if (asking !== undefined && knownAsk(asking.ask)) {
    switch (asking.ask.type) {
      case INBOX_ASK.DECIDE:
        return INBOX_LINE.DECIDE;
      case INBOX_ASK.DO:
        return INBOX_LINE.DO;
      case INBOX_ASK.ANSWER:
        return INBOX_LINE.ANSWER;
    }
  }
  return thread.at(-1)?.answers === undefined ? INBOX_LINE.SAID : INBOX_LINE.SETTLED;
}

/** What an item's hover card reads of its thread: the ask that waits, where one does, and the agent's latest words, plain. */
export interface InboxCardThread {
  readonly ask: InboxKnownAsk | undefined;
  readonly words: string;
}

/** An item's thread as its hover card reads it (`InboxCardThread`). */
export function inboxCardThread(item: InboxItem): InboxCardThread {
  const thread = item.thread ?? [];
  const asking = openAskOf(thread);
  const said = thread.findLast((each) => each.author === INBOX_MESSAGE_AUTHOR.AGENT);
  return {
    ask: asking !== undefined && knownAsk(asking.ask) ? asking.ask : undefined,
    words: said === undefined ? "" : plainWords(said.text),
  };
}

/**
 * The steps of an item's open to-do its row and card show ticked, as its box
 * shows them (`shownTicks`): every one while Mark done is pressed in its
 * draft, else those ticked by hand; none where no draft stands.
 */
export function inboxShownTicks(
  item: InboxItem,
  draft: Pick<InboxDraft, "steps" | "press"> | undefined,
): readonly number[] {
  if (draft === undefined) return [];
  const ask = openAskOf(item.thread ?? [])?.ask;
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DO) return draft.steps ?? [];
  return shownTicks(ask, draft);
}

/**
 * How a settled item ended, as its hover card says it, whatever its row's
 * glyph: the latest answer on its thread by its answerer, even with words
 * after it; an ask the agent took back, and why; or a member's close. None
 * while it is open, or where its thread says nothing of how it ended, as a
 * notice nodded to with Got it.
 */
export function inboxSettledWords(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
): string | undefined {
  if (item.status === INBOX_STATUS.OPEN) return undefined;
  const thread = item.thread ?? [];
  const answering = thread.findLast((each) => each.answers !== undefined);
  if (answering?.answers !== undefined) {
    const { answers } = answering;
    const stamp = sentStamp(answers, thread.find((each) => each.id === answers.ask)?.ask).words;
    const words = plainWords(answering.text);
    return `${nameOf(answering.member)}: ${words === "" ? stamp : `${stamp}${PREVIEW_PART}${words}`}`;
  }
  // Note that a close naming its closer is a member's, though it withdrew the ask it left open; otherwise an ask the agent took back says so before a close is read as a member's, since a close naming no closer reads as one.
  if (item.closedBy !== undefined) return `${nameOf(item.closedBy)}: ${CLOSED_WORDS}`;
  const withdrawn = thread.findLast((each) => each.ask?.status === INBOX_ASK_STATUS.WITHDRAWN);
  if (withdrawn?.ask !== undefined) {
    const why = plainWords(withdrawn.ask.withdrawnReason ?? "");
    return why === "" ? "Withdrawn" : `Withdrawn: ${why}`;
  }
  if (closedByMember(item)) return `${nameOf(item.closedBy)}: ${CLOSED_WORDS}`;
  return undefined;
}

/** A settled item's standing in one word: answered, sent by the member who started it, resolved by a member without an answer, or withdrawn by its agent. */
export const INBOX_SETTLED_STANDING = {
  ANSWERED: "Answered",
  STARTED: "Sent",
  RESOLVED: "Resolved",
  WITHDRAWN: "Withdrawn",
} as const;

/**
 * Where a settled item stands, as its row's card says it over how it ended
 * (`inboxSettledWords`), in that line's own word, read in that line's
 * order: a close naming its closer is a member's, though it withdrew the
 * ask it left open, then an ask the agent took back, so the card never
 * calls one ending two names.
 */
export function inboxSettledStanding(
  item: InboxItem,
): (typeof INBOX_SETTLED_STANDING)[keyof typeof INBOX_SETTLED_STANDING] {
  if (item.status === INBOX_STATUS.ANSWERED) {
    // A thread a member started stands settled on their own nod until its agent writes on it.
    const thread = item.thread ?? [];
    const sent =
      thread.length > 0 &&
      thread.every((message) => message.author === INBOX_MESSAGE_AUTHOR.MEMBER);
    return sent ? INBOX_SETTLED_STANDING.STARTED : INBOX_SETTLED_STANDING.ANSWERED;
  }
  if (item.closedBy !== undefined) return INBOX_SETTLED_STANDING.RESOLVED;
  const withdrawn = (item.thread ?? []).some(
    (each) => each.ask?.status === INBOX_ASK_STATUS.WITHDRAWN,
  );
  return !withdrawn && closedByMember(item)
    ? INBOX_SETTLED_STANDING.RESOLVED
    : INBOX_SETTLED_STANDING.WITHDRAWN;
}

/** What an open ask asks, as its row's second line says it (`inboxPreview`). */
function askLine(ask: InboxKnownAsk, ticked: readonly number[]): string {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return ask.options
        .map((option) =>
          recommendedLabels(ask).includes(option.label) ? `${option.label} ★` : option.label,
        )
        .join(" / ");
    case INBOX_ASK.DO: {
      const steps = ask.steps.map((step) => plainWords(step));
      if (steps.length === 0) return "Mark it done";
      const done = new Set(ticked.filter((at) => at < steps.length));
      const next = steps.find((_, at) => !done.has(at));
      if (next === undefined) return "Every step ticked · Mark done";
      const left = steps.length - done.size;
      return `${left} ${left === 1 ? "step" : "steps"} left${PREVIEW_PART}${next}`;
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined
        ? "Write an answer"
        : `Fill in ${ask.fields.map((field) => field.label).join(", ")}`;
  }
}

/**
 * A thread's latest message as its row says it: an answer by its answerer,
 * its stamp's words first, "You: Chose 7 days · and say it in the docs", a
 * member's words by their writer, and the agent's words alone, its tile
 * saying who; its files where it said nothing.
 */
function lastSaid(
  thread: readonly InboxMessage[],
  nameOf: (member: InboxMember | undefined) => string,
): string {
  const last = thread.at(-1);
  if (last === undefined) return "";
  const agent = last.author === INBOX_MESSAGE_AUTHOR.AGENT;
  const words = plainWords(last.text);
  const answers = last.answers;
  const said =
    answers === undefined
      ? words === ""
        ? (filesWords(last.files) ?? "")
        : words
      : (() => {
          const stamp = sentStamp(
            answers,
            thread.find((each) => each.id === answers.ask)?.ask,
          ).words;
          return words === "" ? stamp : `${stamp}${PREVIEW_PART}${words}`;
        })();
  return agent ? said : `${nameOf(last.member)}: ${said}`;
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

/** The words options say: each one's label and the trade-off written under it. */
function optionWords(options: readonly { label: string; detail?: string }[]): readonly string[] {
  return options.flatMap((option) => [option.label, option.detail ?? ""]);
}

/** The words a form's fields say: each one's label and a select's options. */
function fieldWords(fields: readonly InboxForm["fields"][number][]): readonly string[] {
  return fields.flatMap((field) => [field.label, ...(field.options ?? [])]);
}

/** The words a filled form says: each field's label and its value as words. */
function valueWords(values: readonly InboxFormValue[] | undefined): readonly string[] {
  return (values ?? []).flatMap((each) => [each.label, fieldValueWords(each.value)]);
}

/** The words an ask offers: a decision's options, a to-do's steps, and an answer's fields; none of an ask this build does not know. */
function askWords(ask: InboxReadAsk | undefined): readonly string[] {
  if (ask === undefined || !knownAsk(ask)) return [];
  if (ask.type === INBOX_ASK.DECIDE) return optionWords(ask.options);
  if (ask.type === INBOX_ASK.DO) return ask.steps.map(plainWords);
  return fieldWords(ask.fields ?? []);
}

/**
 * Every line of words an item says, as a search reads it: its title, and
 * each message of its thread and what that asks, picks, or fills in. Note
 * that it names no address, id, or member, because a query typed is about
 * what was said, and an address holds letters enough to match almost
 * anything.
 */
export function inboxItemWords(item: InboxItem): readonly string[] {
  const said = (item.thread ?? []).flatMap((message) => [
    plainWords(message.text),
    ...askWords(message.ask),
    ...(message.answers?.choices ?? []),
    ...valueWords(message.answers?.values),
  ]);
  return [item.title, ...said].filter((words) => words.length > 0);
}

/** Whether an item answers a list's search: every word of it somewhere in the item's words (`inboxItemWords`) or its holder's name; any item answers none. */
function searchedItem(holder: InboxHolder, item: InboxItem, search: readonly string[]): boolean {
  return (
    search.length === 0 || matchesTokens([holderName(holder), ...inboxItemWords(item)], search)
  );
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
 * Which items an Inbox lists, as its view's menu chooses: To do, the
 * reader's own items not done with (`toDo`), or All, every item, open and
 * settled. Note that no scope asks where the item's task stands: an item
 * of a task done or canceled is listed and counted as any other, the
 * Inbox being a feed of what the agents got done.
 */
export const INBOX_SHOW = {
  TO_DO: "to-do",
  ALL: "all",
} as const;

export type InboxShow = (typeof INBOX_SHOW)[keyof typeof INBOX_SHOW];

/** How the window's Inbox orders its items: the latest changed first, or the oldest changed first. */
export const INBOX_SORT = {
  LATEST: "latest",
  OLDEST: "oldest",
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

/** How many items each scope lists, filtered out by the scope shown or not. */
export interface InboxCounts {
  readonly [INBOX_SHOW.TO_DO]: number;
  readonly [INBOX_SHOW.ALL]: number;
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

/** A member an item names, as the service names them: who it waits on (`inboxWaitsOn`), or who started its agent. */
export type InboxPerson = NonNullable<InboxItem["startedBy"]>;

/** One person's items, by whoever they wait on (`inboxWaitsOn`); the reader's own where `person` is none. */
export interface InboxPersonGroup {
  /** What the group is folded by, apart from any plan's or automation's key. */
  readonly key: string;
  readonly person: InboxPerson | undefined;
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
 * one for each person items wait on, one for each status, or every
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
 * The member an item waits on: its task's assignee, or its agent's starter
 * where the task has nobody assigned or the agent works on no task, as the
 * service resolves it; its starter from a service before it said; none where
 * it names neither.
 */
export function inboxWaitsOn(item: InboxItem): InboxPerson | undefined {
  return item.waitsOn ?? item.startedBy;
}

/**
 * Whether an item is the reader's: it waits on them (`inboxWaitsOn`), or on
 * nobody the service names, or is read before the reader's own id is known,
 * as main counts what waits on the account and as every item read before.
 */
export function readersItem(item: InboxItem, readerId: string | undefined): boolean {
  const waitsOn = inboxWaitsOn(item)?.userId;
  return waitsOn === undefined || readerId === undefined || waitsOn === readerId;
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
function needsReader(item: InboxItem, readerId: string | undefined): boolean {
  return item.status === INBOX_STATUS.OPEN && readersItem(item, readerId);
}

/**
 * Whether opening the item acknowledges it, as Got it did: a notice waiting
 * on a nod (`awaitsNod`), the reader's own (`needsReader`) by an id already
 * known, since an acknowledgement settles it for every member, and one
 * whose agent does not wait to hear back (`needsReply`), since a notice
 * that asks to be heard back would reach its agent on a mere open. A box
 * holding no words or files for it offers no Got it.
 */
export function acknowledgedOnOpen(item: InboxItem, readerId: string | undefined): boolean {
  return (
    readerId !== undefined && needsReader(item, readerId) && awaitsNod(item) && !item.needsReply
  );
}

/** Whether a listed item needs the reader (`needsReader`), whatever its task's status. */
export function needsYou(listed: InboxListed, readerId: string | undefined): boolean {
  return needsReader(listed.item, readerId);
}

/**
 * Whether a listed item is one the reader is not done with, as To do lists
 * it: one that needs them (`needsYou`), or one of theirs (`readersItem`)
 * still unread, such as a settled thread its agent wrote on again.
 */
function toDo(listed: InboxListed, readerId: string | undefined): boolean {
  return (
    needsYou(listed, readerId) || (readersItem(listed.item, readerId) && isUnread(listed.item))
  );
}

/**
 * Every open item, whoever's, the latest changed first, as Home and a
 * person's page list what waits (`use-waiting-items.ts`).
 */
export function openItems(groups: readonly InboxGroup[]): readonly InboxListed[] {
  return groups
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .filter((listed) => needsYou(listed, undefined))
    .toSorted((a, b) => newestFirst(a.item, b.item));
}

/** What a person's group is folded by: their account's id, or one key for the reader's own. */
const PERSON_KEY = { PREFIX: "person:", YOU: "person:you" } as const;

/**
 * The items, in the order given, grouped by who they wait on: the
 * reader's own first, then each teammate's, the one whose first item stands
 * first, each group's items in the order given.
 */
function personGroups(
  items: readonly InboxListed[],
  readerId: string | undefined,
): readonly InboxPersonGroup[] {
  const groups = new Map<
    string,
    { key: string; person: InboxPerson | undefined; items: InboxListed[] }
  >();
  for (const listed of items) {
    const person = readersItem(listed.item, readerId) ? undefined : inboxWaitsOn(listed.item);
    const key = person === undefined ? PERSON_KEY.YOU : `${PERSON_KEY.PREFIX}${person.userId}`;
    const held = groups.get(key);
    if (held === undefined) groups.set(key, { key, person, items: [listed] });
    else held.items.push(listed);
  }
  // Note that the groups stand in the order their first item does, which a stable sort keeps behind the reader's own.
  return [...groups.values()].toSorted(
    (a, b) => Number(a.person !== undefined) - Number(b.person !== undefined),
  );
}

/** The latest change first. */
function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.updatedAt - a.updatedAt;
}

/** The order a sort lists items in, by when each changed: the latest first, or the oldest first. */
const SORT_ORDER = {
  [INBOX_SORT.LATEST]: (a: number, b: number) => b - a,
  [INBOX_SORT.OLDEST]: (a: number, b: number) => a - b,
} as const satisfies Record<InboxSort, (a: number, b: number) => number>;

/** Where an item stands for the reader, as a list grouped by status heads it. */
function statusOf(item: InboxItem, readerId: string | undefined): InboxStatusGroupKind {
  if (item.status !== INBOX_STATUS.OPEN) return INBOX_STATUS_GROUP.ANSWERED;
  return readersItem(item, readerId) ? INBOX_STATUS_GROUP.NEEDS_YOU : INBOX_STATUS_GROUP.WAITING;
}

/**
 * Where a listed item stands in a list's order: when it changed and the
 * status it is grouped under, as the list first drew them. A list held
 * still while it is shown is drawn from these rather than from the item as
 * it is now, so an answer, which changes both, moves no row (`inboxPlaces`).
 */
export interface InboxPlace {
  readonly at: number;
  readonly status: InboxStatusGroupKind;
}

/** No item's place held: every item stands where it is now. */
export const NO_PLACES: ReadonlyMap<string, InboxPlace> = new Map();

/** The items, in the order given, under where each stands: what needs the reader, what waits on others, and what is answered, a status with nothing in it left out. */
function statusGroups(
  items: readonly InboxListed[],
  statusOfItem: (item: InboxItem) => InboxStatusGroupKind,
): readonly InboxStatusGroup[] {
  return Object.values(INBOX_STATUS_GROUP).flatMap((status) => {
    const held = items.filter(({ item }) => statusOfItem(item) === status);
    return held.length === 0 ? [] : [{ key: STATUS_KEY[status], status, items: held }];
  });
}

/** No search: every item answers it. */
const NO_SEARCH: readonly string[] = [];

/** Whether an item is one the Whose choice lists: anyone's, the reader's own (`readersItem`), or one that waits on the teammate (`inboxWaitsOn`). */
function whoseItem(whose: InboxWhose, item: InboxItem, readerId: string | undefined): boolean {
  switch (whose.kind) {
    case INBOX_WHOSE.EVERYONE:
      return true;
    case INBOX_WHOSE.MINE:
      return readersItem(item, readerId);
    case INBOX_WHOSE.PERSON:
      return inboxWaitsOn(item)?.userId === whose.userId;
  }
}

/**
 * The list from every task's items: each item in the sort's order, the
 * latest changed first or the oldest changed first, under its plan,
 * under the person it waits on, under where it stands, or in one
 * run, the tasks and the people in the order their first item stands and
 * the statuses in theirs. The scope shown lists only the items it takes
 * (`showsItem`) of the people Whose names that its search finds (`searchedItem`), and the item chosen where one is given. Note that the rows a list draws are given
 * only the chosen item they drew already, kept while it stays chosen
 * (`use-held-inbox-list.ts`), so a settled item leaves a list filtered to
 * exclude it once another is chosen, while the steps through the list are
 * given the item the pane shows, which keeps its place among them so K, J,
 * and Next still reach the rows either side of it. An item whose place is
 * held (`places`) stands there, rather than where it changed last.
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
    /** The words of the list's search (`searchTokens`), each somewhere in every item listed; none narrows nothing. */
    readonly search?: readonly string[] | undefined;
    /** Where the items held still stand (`inboxPlaces`), each other item where it is now; none holds every item where it is now. */
    readonly places?: ReadonlyMap<string, InboxPlace> | undefined;
  },
): InboxListView {
  const {
    readerId,
    sort = INBOX_SORT.LATEST,
    whose = EVERYONES,
    search = NO_SEARCH,
    places = NO_PLACES,
  } = view;
  const placed = (item: InboxItem): InboxPlace =>
    places.get(item.id) ?? { at: item.updatedAt, status: statusOf(item, readerId) };
  const order = (a: InboxItem, b: InboxItem) => SORT_ORDER[sort](placed(a).at, placed(b).at);
  const shows = (holder: InboxHolder) => (item: InboxItem) =>
    (showsItem(view.show, { holder, item }, readerId) &&
      whoseItem(whose, item, readerId) &&
      searchedItem(holder, item, search)) ||
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
    const groups = statusGroups(items, (item) => placed(item).status);
    return { grouping: INBOX_GROUPING.STATUS, groups, readerId };
  }
  return { grouping: INBOX_GROUPING.PERSON, groups: personGroups(items, readerId), readerId };
}

/**
 * Where each row of a list stands, to hold it still while the list is
 * shown: the place held for it where it has one, else where it is now. An
 * item the list no longer draws holds no place, so once it is listed again
 * it stands where it is then.
 */
export function inboxPlaces(
  view: InboxListView,
  held: ReadonlyMap<string, InboxPlace>,
): ReadonlyMap<string, InboxPlace> {
  return new Map(
    listedItems(view).map(({ item }) => [
      item.id,
      held.get(item.id) ?? { at: item.updatedAt, status: statusOf(item, view.readerId) },
    ]),
  );
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

/** Whether the reader is done with an item, as its row is drawn gray: settled, answered or closed, and read since. */
export function isDone(item: InboxItem): boolean {
  return item.status !== INBOX_STATUS.OPEN && !isUnread(item);
}

/** Whether a scope lists the item: To do the reader's own not done with (`toDo`), and All all of them. */
function showsItem(show: InboxShow, listed: InboxListed, readerId: string | undefined): boolean {
  switch (show) {
    case INBOX_SHOW.TO_DO:
      return toDo(listed, readerId);
    case INBOX_SHOW.ALL:
      return true;
  }
}

/** How many of every task's items each scope lists, of the people Whose names. */
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
    [INBOX_SHOW.TO_DO]: count(INBOX_SHOW.TO_DO),
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

/** Which way the reader last stepped through the list, K up and J down, which Next follows. */
export const INBOX_DIRECTION = {
  UP: "up",
  DOWN: "down",
} as const;

export type InboxDirection = (typeof INBOX_DIRECTION)[keyof typeof INBOX_DIRECTION];

/**
 * The nearest row past the chosen one, the way the reader is moving, whose
 * item the reader is not done with (`toDo`), a folded group's left out;
 * none where nothing else is. Down it reads the rows below and wraps round
 * to the list's top; up, the rows above, nearest first, and wraps round
 * from the list's foot.
 */
export function nextNeedingYou(
  view: InboxListView,
  chosen: string | undefined,
  folded: (key: string) => boolean,
  direction: InboxDirection = INBOX_DIRECTION.DOWN,
): InboxListed | undefined {
  const listed = rowedItems(view, folded, chosen);
  const at = listed.findIndex(({ item }) => item.id === chosen);
  const below = listed.slice(at + 1);
  const above = listed.slice(0, Math.max(at, 0));
  const ahead =
    direction === INBOX_DIRECTION.UP
      ? [...above.reverse(), ...below.reverse()]
      : [...below, ...above];
  return ahead.find((listed) => toDo(listed, view.readerId) && listed.item.id !== chosen);
}

/** The item that stands chosen where none is: the first listed the reader is not done with (`toDo`), else the first listed. */
export function firstChoice(view: InboxListView): InboxListed | undefined {
  const listed = listedItems(view);
  return listed.find((each) => toDo(each, view.readerId)) ?? listed[0];
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
  | { readonly kind: typeof CODE_READ.READY; readonly code: SnippetLines }
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
      firstLine: file.firstLine,
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
