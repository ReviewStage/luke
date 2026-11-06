import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import type { AgentAttachment, AgentSummary } from "@repo/features/agent-wire";
import { ATTACHMENT_VIEW, attachmentView, type FileChip } from "@repo/features/attachment-model";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import {
  INBOX_PICTURE_IN_WORDS,
  inboxAttachmentOf,
  inboxPictureDestination,
} from "@repo/features/inbox-attachment-link";
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
  type InboxAsking,
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
  inboxWaitsOn,
  openAskOf,
  recommendedLabels,
  threadNeedsReader,
} from "@repo/features/inbox-wire";
import { insideCode } from "@repo/features/mention-link";
import type { TaskFileRequest, TaskSummary } from "@repo/features/task-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import type { AppInboxTasklessItem, AppInboxWaitingItem } from "@repo/host/app-state";
import { markdownTree } from "@repo/ui/markdown-words";
import { matchesTokens } from "@repo/ui/search-tokens";
import { isWireString } from "@repo/wire";
import type { CountNoun } from "../desktop/sidebar-fold.js";
import { UNHEARD_OFFLINE } from "./agent-model.js";
import type { SnippetLines } from "./code-snippet-model.js";
import { refusalLine, refusalPasses } from "./file-tab-model.js";
import {
  fillInWords,
  INBOX_MISSING,
  type InboxMissing,
  WRITE_AN_ANSWER,
} from "./inbox-ask-words.js";
import { plainWords } from "./tool-call-model.js";

export interface InboxDraft {
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly note: string;
  readonly attachments: readonly AgentAttachment[];
  readonly steps?: readonly number[] | undefined;
  readonly press?: InboxReplyKind | undefined;
  readonly resolving?: true | undefined;
}

export const EMPTY_INBOX_DRAFT: InboxDraft = { choices: [], values: [], note: "", attachments: [] };

export interface InboxNote {
  readonly words: string;
  readonly failure?: AgentCallFailure | undefined;
}

export interface InboxNoteReading {
  readonly words: string;
  readonly unarchive: boolean;
}

const AGENT_ARCHIVED_NOTE = "This agent is archived.";

export function inboxNoteReading(
  note: InboxNote,
  agent: AgentSummary | undefined,
  connected: boolean,
): InboxNoteReading {
  const archived = note.failure === AGENT_CALL_FAILURE.NOT_FOUND && agent?.archivedAt !== undefined;
  if (archived) return { words: AGENT_ARCHIVED_NOTE, unarchive: true };
  const offline = !connected && note.failure === AGENT_CALL_FAILURE.UNANSWERED;
  return { words: offline ? UNHEARD_OFFLINE.ALONE : note.words, unarchive: false };
}

type InboxFile = NonNullable<InboxMessage["files"]>[number];

export function inboxFileChips(
  files: readonly InboxFile[],
  urls: ReadonlyMap<string, string>,
): FileChip[] {
  return files.map((file) => ({
    name: file.name,
    mediaType: file.mediaType,
    url: urls.get(file.attachmentId) ?? "",
  }));
}

export interface InboxCommentFiles {
  readonly pictures: readonly InboxFile[];
  readonly others: readonly InboxFile[];
}

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

export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  readonly waiting: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

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

export function keyedItem(
  board: InboxBoardView,
  key: string,
  agentId: string | undefined,
): InboxItem | undefined {
  return [...board.open, ...board.settled]
    .filter((item) => item.key === key && (agentId === undefined || item.agentId === agentId))
    .reduce<InboxItem | undefined>(
      (latest, item) => (latest === undefined || item.postedAt > latest.postedAt ? item : latest),
      undefined,
    );
}

export function fieldValueOf(draft: InboxDraft, label: string): InboxFieldValue | undefined {
  return draft.values.find((each) => each.label === label)?.value;
}

export function withValue(
  draft: InboxDraft,
  label: string,
  value: InboxFieldValue | undefined,
): InboxDraft {
  const others = draft.values.filter((each) => each.label !== label);
  return { ...draft, values: value === undefined ? others : [...others, { label, value }] };
}

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

function formFilledIn(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const held = new Set(draft.values.map((value) => value.label));
  return sentValues(form, draft).some((value) => held.has(value.label));
}

function formSendable(form: Pick<InboxForm, "fields">, draft: InboxDraft): boolean {
  const sent = new Set(sentValues(form, draft).map((value) => value.label));
  if (form.fields.every((field) => field.required !== true || sent.has(field.label))) return true;
  if (draft.note.trim() !== "" || draft.attachments.length > 0) return true;
  return formFilledIn(form, draft);
}

export function inboxReply(
  response: InboxResponse,
  draft: InboxDraft,
  press?: InboxReplyKind,
): InboxReply | undefined {
  const reply = replyKindOf(response, draft, press);
  if (reply === undefined) return undefined;
  const note = draft.note.trim();
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

export function inboxMissing(
  thread: readonly InboxMessage[],
  draft: InboxDraft,
): InboxMissing | undefined {
  if (inboxThreadSend(thread, draft) !== undefined) return undefined;
  if (draft.note.trim() !== "" || draft.attachments.length > 0) return undefined;
  const asking = openAskOf(thread);
  if (asking === undefined || !knownAsk(asking.ask)) return undefined;
  const { ask } = asking;
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
    case INBOX_ASK.DO:
      return { kind: INBOX_MISSING.OPTION };
    case INBOX_ASK.ANSWER: {
      if (ask.fields === undefined) return { kind: INBOX_MISSING.WORDS };
      const sent = new Set(sentValues({ fields: ask.fields }, draft).map((value) => value.label));
      const empty = ask.fields.filter((field) => !sent.has(field.label));
      const first = empty.find((field) => field.required === true) ?? empty[0];
      return first === undefined ? undefined : { kind: INBOX_MISSING.FIELD, label: first.label };
    }
  }
}

type InboxDecided = Extract<
  InboxResponse,
  { type: typeof INBOX_RESPONSE.APPROVAL | typeof INBOX_RESPONSE.TODO }
>;

function decisionsOf(
  response: InboxDecided,
): readonly { readonly reply: InboxReplyKind; readonly label: string }[] {
  const { ahead, back } = INBOX_PRESSES[response.type];
  return [ahead, back];
}

function decidedOf(response: InboxDecided, draft: InboxDraft): InboxReplyKind | undefined {
  const held = draft.choices[0];
  return decisionsOf(response).find((decision) => decision.reply === held)?.reply;
}

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

export type InboxKnownAsk = Extract<InboxReadAsk, { type: InboxAsk["type"] }>;

export type InboxDecideAsk = Extract<InboxKnownAsk, { type: typeof INBOX_ASK.DECIDE }>;

export type InboxDoAsk = Extract<InboxKnownAsk, { type: typeof INBOX_ASK.DO }>;

export function knownAsk(ask: InboxReadAsk): ask is InboxKnownAsk {
  return Object.values<string>(INBOX_ASK).includes(ask.type);
}

export function awaitsNod(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) === undefined;
}

export const RECOMMENDED = "Recommended";

const BUTTON_OPTION_CHARS = 24;

export function decideButtons(ask: Pick<InboxDecideAsk, "options" | "multiple">): boolean {
  return (
    ask.multiple !== true &&
    ask.options.length === 2 &&
    ask.options.every(
      (option) => option.detail === undefined && option.label.length <= BUTTON_OPTION_CHARS,
    )
  );
}

function shownSteps(ask: Pick<InboxDoAsk, "steps">): number {
  return Math.max(ask.steps.length, 1);
}

interface StepFence {
  readonly code: string;
  readonly lang: string | undefined;
}

export function stepParts(step: string): {
  readonly say: string;
  readonly fences: readonly StepFence[];
} {
  const fences = markdownTree(step).children.filter(
    (node): node is Extract<typeof node, { type: "code" }> => node.type === "code",
  );
  const ends = [
    0,
    ...fences.flatMap((fence) => [
      fence.position?.start.offset ?? 0,
      fence.position?.end.offset ?? 0,
    ]),
    step.length,
  ];
  const runs = Array.from({ length: ends.length / 2 }, (_, at) =>
    step.slice(ends[2 * at], ends[2 * at + 1]).trim(),
  );
  return {
    say: runs.filter((run) => run !== "").join("\n\n"),
    fences: fences.map((fence) => ({ code: fence.value, lang: fence.lang ?? undefined })),
  };
}

function tickedSteps(draft: Pick<InboxDraft, "steps">): readonly number[] {
  return [...new Set(draft.steps ?? [])].toSorted((a, b) => a - b);
}

function everyStep(ask: Pick<InboxDoAsk, "steps">): readonly number[] {
  return Array.from({ length: shownSteps(ask) }, (_, at) => at);
}

function everyStepTicked(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps">,
): boolean {
  const ticked = new Set(tickedSteps(draft));
  return everyStep(ask).every((at) => ticked.has(at));
}

export function doDecision(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps" | "press">,
): InboxReplyKind | undefined {
  if (draft.press === INBOX_REPLY.DONE || draft.press === INBOX_REPLY.NOT_DONE) return draft.press;
  return everyStepTicked(ask, draft) ? INBOX_REPLY.DONE : undefined;
}

export function shownTicks(
  ask: Pick<InboxDoAsk, "steps">,
  draft: Pick<InboxDraft, "steps" | "press">,
): readonly number[] {
  return draft.press === INBOX_REPLY.DONE ? everyStep(ask) : tickedSteps(draft);
}

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
      return ticked.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.ANSWERED, steps: ticked };
    }
    case INBOX_ASK.ANSWER:
      if (ask.fields !== undefined) {
        return formFilledIn({ fields: ask.fields }, draft)
          ? {
              ask: id,
              reply: INBOX_REPLY.SUBMITTED,
              values: sentValues({ fields: ask.fields }, draft),
            }
          : undefined;
      }
      return draft.note.trim() === "" && draft.attachments.length === 0
        ? undefined
        : { ask: id, reply: INBOX_REPLY.ANSWERED };
  }
}

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

export function askNumberedPick(
  ask: InboxReadAsk,
  draft: InboxDraft,
  number: number,
): InboxDraft | undefined {
  if (!knownAsk(ask) || ask.type !== INBOX_ASK.DECIDE) return undefined;
  const option = ask.options[number - 1];
  return option === undefined ? undefined : withChoice(ask, draft, option.label);
}

export interface InboxThreadSend {
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly answers?: InboxAnswers;
}

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

export const ANSWER_TONE = {
  AHEAD: "ahead",
  BACK: "back",
} as const;

export type AnswerTone = (typeof ANSWER_TONE)[keyof typeof ANSWER_TONE];

export interface AnswerStamp {
  readonly tone: AnswerTone;
  readonly words: string;
}

const DONE_WORDS: ReadonlyMap<string, string> = new Map([
  ["Approve", "Approved"],
  ["Decline", "Declined"],
  ["Request changes", "Changes requested"],
]);

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

function stepCount(answers: InboxAnswers, ask: InboxReadAsk | undefined): string | undefined {
  if (ask === undefined || !knownAsk(ask) || ask.type !== INBOX_ASK.DO) return undefined;
  if (ask.steps.length === 0) return undefined;
  return `${(answers.steps ?? []).length}/${ask.steps.length}`;
}

function counting(words: string, count: string | undefined): string {
  return count === undefined ? words : `${words} ${count}`;
}

function toneOf(answers: InboxAnswers, ask: InboxReadAsk | undefined): AnswerTone {
  const pick = buttonPick(answers, ask);
  if (pick !== undefined) return pick.tone;
  return answers.reply === INBOX_REPLY.NOT_DONE || answers.reply === INBOX_REPLY.DECLINED
    ? ANSWER_TONE.BACK
    : ANSWER_TONE.AHEAD;
}

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
        const count = answers.steps === undefined ? undefined : stepCount(answers, ask);
        return count === undefined ? sentenceCased(SENT_WORDS[answers.reply]) : `Ticked ${count}`;
      }
      default:
        return sentenceCased(SENT_WORDS[answers.reply]);
    }
  })();
  return { tone, words };
}

export function answerOf(
  thread: readonly InboxMessage[],
  messageId: string,
): InboxMessage | undefined {
  return thread.find((message) => message.answers?.ask === messageId);
}

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

function closedByMember(item: InboxItem): boolean {
  return (
    item.status === INBOX_STATUS.CLOSED &&
    (item.closedBy !== undefined || item.closedReason === undefined)
  );
}

type InboxMember = NonNullable<InboxItem["answeredBy"]>;

export const CLOSED_WORDS = "Resolved without an answer";

const PREVIEW_PART = " · ";

function filesWords(files: readonly unknown[] | undefined): string | undefined {
  const count = files?.length ?? 0;
  if (count === 0) return undefined;
  return count === 1 ? "Sent a file" : `Sent ${count} files`;
}

function sentenceCased(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

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

export function inboxPreview(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
  ticked?: readonly number[],
): string {
  const line = itemLine(item);
  return previewOf(line, nameOf, ticked, line.words);
}

export function inboxPreviewHeard(
  item: InboxItem,
  nameOf: (member: InboxMember | undefined) => string,
  ticked?: readonly number[],
): string {
  const line = itemLine(item);
  return previewOf(line, nameOf, ticked, line.heard);
}

export const INBOX_LINE = {
  DECIDE: "decide",
  DO: "do",
  ANSWER: "answer",
  SETTLED: "settled",
  SAID: "said",
} as const;

export type InboxLineKind = (typeof INBOX_LINE)[keyof typeof INBOX_LINE];

export function inboxLineKind(item: InboxItem): InboxLineKind {
  return itemLine(item).kind;
}

export function inboxCardWords(item: InboxItem): string {
  const said = (item.thread ?? []).findLast((each) => each.author === INBOX_MESSAGE_AUTHOR.AGENT);
  return said === undefined ? "" : plainWords(said.text);
}

export function inboxShownTicks(
  item: InboxItem,
  draft: Pick<InboxDraft, "steps" | "press"> | undefined,
): readonly number[] {
  if (draft === undefined) return [];
  const { ask } = itemLine(item);
  if (ask === undefined || ask.type !== INBOX_ASK.DO) return draft.steps ?? [];
  return shownTicks(ask, draft);
}

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
  if (item.closedBy !== undefined) return `${nameOf(item.closedBy)}: ${CLOSED_WORDS}`;
  const withdrawn = thread.findLast((each) => each.ask?.status === INBOX_ASK_STATUS.WITHDRAWN);
  if (withdrawn?.ask !== undefined) {
    const why = plainWords(withdrawn.ask.withdrawnReason ?? "");
    return why === "" ? "Withdrawn" : `Withdrawn: ${why}`;
  }
  if (closedByMember(item)) return `${nameOf(item.closedBy)}: ${CLOSED_WORDS}`;
  return undefined;
}

export const INBOX_SETTLED_STANDING = {
  ANSWERED: "Answered",
  STARTED: "Sent",
  RESOLVED: "Resolved",
  WITHDRAWN: "Withdrawn",
} as const;

export function inboxSettledStanding(
  item: InboxItem,
): (typeof INBOX_SETTLED_STANDING)[keyof typeof INBOX_SETTLED_STANDING] {
  if (item.status === INBOX_STATUS.ANSWERED) {
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

function askLine(ask: InboxKnownAsk, ticked: readonly number[]): string {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      return ask.options
        .map((option) =>
          recommendedLabels(ask).includes(option.label)
            ? `${option.label} (${RECOMMENDED.toLowerCase()})`
            : option.label,
        )
        .join(" / ");
    case INBOX_ASK.DO: {
      const steps = ask.steps.map((step) => plainWords(step));
      if (steps.length === 0) return "Mark done";
      const done = new Set(ticked.filter((at) => at < steps.length));
      const next = steps.find((_, at) => !done.has(at));
      if (next === undefined) return "Every step ticked · Mark done";
      const left = steps.length - done.size;
      return `${left} ${left === 1 ? "step" : "steps"} left${PREVIEW_PART}${next}`;
    }
    case INBOX_ASK.ANSWER:
      return ask.fields === undefined
        ? WRITE_AN_ANSWER
        : fillInWords(ask.fields.map((field) => field.label));
  }
}

const ASK_LINE = {
  [INBOX_ASK.DECIDE]: INBOX_LINE.DECIDE,
  [INBOX_ASK.DO]: INBOX_LINE.DO,
  [INBOX_ASK.ANSWER]: INBOX_LINE.ANSWER,
} as const satisfies Record<InboxKnownAsk["type"], InboxLineKind>;

interface ItemLine {
  readonly kind: InboxLineKind;
  readonly ask: InboxKnownAsk | undefined;
  readonly words: string;
  readonly heard: string;
  readonly byAgent: boolean;
  readonly member: InboxMember | undefined;
}

const itemLines = new WeakMap<InboxItem, ItemLine>();

function itemLine(item: InboxItem): ItemLine {
  const held = itemLines.get(item);
  if (held !== undefined) return held;
  const thread = item.thread ?? [];
  const asking = openAskOf(thread);
  const last = thread.at(-1);
  const line =
    asking !== undefined && knownAsk(asking.ask)
      ? {
          kind: ASK_LINE[asking.ask.type],
          ask: asking.ask,
          words: askLine(asking.ask, []),
          heard: askLine(asking.ask, []),
          byAgent: true,
          member: undefined,
        }
      : {
          kind: last?.answers === undefined ? INBOX_LINE.SAID : INBOX_LINE.SETTLED,
          ask: undefined,
          words: last === undefined ? "" : lastWords(thread, last, plainWords),
          heard: last === undefined ? "" : lastWords(thread, last, firstWords),
          byAgent: last === undefined || last.author === INBOX_MESSAGE_AUTHOR.AGENT,
          member: last?.member,
        };
  itemLines.set(item, line);
  return line;
}

function previewOf(
  line: ItemLine,
  nameOf: (member: InboxMember | undefined) => string,
  ticked: readonly number[] | undefined,
  words: string,
): string {
  if (line.ask !== undefined) {
    return ticked === undefined || ticked.length === 0 ? line.words : askLine(line.ask, ticked);
  }
  return line.byAgent ? words : `${nameOf(line.member)}: ${words}`;
}

function firstWords(text: string): string {
  return (
    text
      .split("\n")
      .map(plainWords)
      .find((line) => line !== "") ?? ""
  );
}

function lastWords(
  thread: readonly InboxMessage[],
  last: InboxMessage,
  read: (text: string) => string,
): string {
  const words = read(last.text);
  const answers = last.answers;
  if (answers === undefined) return words === "" ? (filesWords(last.files) ?? "") : words;
  const stamp = sentStamp(answers, thread.find((each) => each.id === answers.ask)?.ask).words;
  return words === "" ? stamp : `${stamp}${PREVIEW_PART}${words}`;
}

export const NEEDS_YOU = {
  LABEL: "Needs you",
  COUNT: { one: "needs you", many: "need you" } satisfies CountNoun,
  NONE: "Nothing needs you",
} as const;

export const INBOX_NOT_READ = "The inbox could not be read.";

export function needsYouWords(count: number): string {
  return `${count} ${count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`;
}

export function threadsWaitingWords(waiting: number): string {
  return waiting === 1
    ? `1 thread ${NEEDS_YOU.COUNT.one}`
    : `${waiting} threads ${NEEDS_YOU.COUNT.many}`;
}

export function waitingByAgent(
  waiting: readonly InboxItem[],
): ReadonlyMap<string, readonly InboxItem[]> {
  const byAgent = new Map<string, InboxItem[]>();
  for (const item of waiting)
    byAgent.set(item.agentId, [...(byAgent.get(item.agentId) ?? []), item]);
  return byAgent;
}

export const INBOX_HOLDER = {
  TASK: "plan",
  AGENT: "agent",
} as const;

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

export function inboxAgentOf(agent: {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly automationId?: string | null | undefined;
  readonly automationName?: string | undefined;
  readonly repository?: string | null | undefined;
  readonly workspaceId?: string | undefined;
}): TasklessInboxAgent {
  return {
    agentId: agent.id,
    agentTitle: agent.title,
    agentModel: agent.model,
    automationId: agent.automationId ?? null,
    automationName: agent.automationName ?? null,
    repository: agent.repository ?? null,
    ...(agent.workspaceId === undefined ? undefined : { workspaceId: agent.workspaceId }),
  };
}

export type InboxHolder =
  | { readonly kind: typeof INBOX_HOLDER.TASK; readonly task: TaskSummary }
  | { readonly kind: typeof INBOX_HOLDER.AGENT; readonly agent: TasklessInboxAgent };

const keptHolders = new WeakMap<TaskSummary | TasklessInboxAgent, InboxHolder>();

export function agentHolder(agent: TasklessInboxAgent): InboxHolder {
  const kept = keptHolders.get(agent);
  if (kept !== undefined) return kept;
  const holder: InboxHolder = { kind: INBOX_HOLDER.AGENT, agent };
  keptHolders.set(agent, holder);
  return holder;
}

export function holderAutomationId(holder: InboxHolder): string | null {
  if (holder.kind === INBOX_HOLDER.TASK) return null;
  return holder.agent.automationId;
}

export function taskHolder(task: TaskSummary): InboxHolder {
  const kept = keptHolders.get(task);
  if (kept !== undefined) return kept;
  const holder: InboxHolder = { kind: INBOX_HOLDER.TASK, task };
  keptHolders.set(task, holder);
  return holder;
}

export function itemWorkspaceId(holder: InboxHolder): string | undefined {
  return holder.kind === INBOX_HOLDER.TASK ? holder.task.workspaceId : holder.agent.workspaceId;
}

export function holderName(holder: InboxHolder): string {
  if (holder.kind === INBOX_HOLDER.TASK) return holder.task.name;
  const { automationId, automationName } = holder.agent;
  return automationId === null ? NO_AUTOMATION_NAME : (automationName ?? NO_AUTOMATION_NAME);
}

function optionWords(options: readonly { label: string; detail?: string }[]): readonly string[] {
  return options.flatMap((option) => [option.label, option.detail ?? ""]);
}

function fieldWords(fields: readonly InboxForm["fields"][number][]): readonly string[] {
  return fields.flatMap((field) => [field.label, ...(field.options ?? [])]);
}

function valueWords(values: readonly InboxFormValue[] | undefined): readonly string[] {
  return (values ?? []).flatMap((each) => [each.label, fieldValueWords(each.value)]);
}

function askWords(ask: InboxReadAsk | undefined): readonly string[] {
  if (ask === undefined || !knownAsk(ask)) return [];
  if (ask.type === INBOX_ASK.DECIDE) return optionWords(ask.options);
  if (ask.type === INBOX_ASK.DO) return ask.steps.map(plainWords);
  return fieldWords(ask.fields ?? []);
}

const itemWords = new WeakMap<InboxItem, readonly string[]>();

export function inboxItemWords(item: InboxItem): readonly string[] {
  const kept = itemWords.get(item);
  if (kept !== undefined) return kept;
  const said = (item.thread ?? []).flatMap((message) => [
    plainWords(message.text),
    ...askWords(message.ask),
    ...(message.answers?.choices ?? []),
    ...valueWords(message.answers?.values),
  ]);
  const words = [item.title, ...said].filter((each) => each.length > 0);
  itemWords.set(item, words);
  return words;
}

function searchedItem(holder: InboxHolder, item: InboxItem, search: readonly string[]): boolean {
  return (
    search.length === 0 || matchesTokens([holderName(holder), ...inboxItemWords(item)], search)
  );
}

const NO_AUTOMATION_NAME = "Other agents";

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

export function agentGroups(
  agents: readonly TasklessInboxAgent[],
  read: ReadonlyMap<string, readonly InboxItem[]>,
  workspaceId: string | undefined,
): readonly InboxGroup[] {
  const holders = new Map<string, InboxHolder>();
  for (const agent of agents) {
    if (listedIn(agent, workspaceId) && !holders.has(agent.agentId)) {
      holders.set(agent.agentId, agentHolder(agent));
    }
  }
  return [...holders].map(([agentId, holder]) => inboxGroup(holder, read.get(agentId) ?? NO_ITEMS));
}

export const INBOX_SHOW = {
  NEEDS_ME: "needs-me",
  OPEN: "to-do",
  ALL: "all",
  REMINDERS: "reminders",
} as const;

export type InboxShow = (typeof INBOX_SHOW)[keyof typeof INBOX_SHOW];

export const INBOX_WHOSE = {
  EVERYONE: "everyone",
  MINE: "mine",
  PERSON: "person",
} as const;

export type InboxWhose =
  | { readonly kind: typeof INBOX_WHOSE.EVERYONE }
  | { readonly kind: typeof INBOX_WHOSE.MINE }
  | { readonly kind: typeof INBOX_WHOSE.PERSON; readonly userId: string; readonly name: string };

export const EVERYONES: InboxWhose = { kind: INBOX_WHOSE.EVERYONE };

export const MINE: InboxWhose = { kind: INBOX_WHOSE.MINE };

export interface InboxCounts {
  readonly [INBOX_SHOW.NEEDS_ME]: number;
  readonly [INBOX_SHOW.OPEN]: number;
  readonly [INBOX_SHOW.ALL]: number;
  readonly [INBOX_SHOW.REMINDERS]: number;
}

export interface InboxGroup {
  readonly holder: InboxHolder;
  readonly items: readonly InboxItem[];
}

export interface InboxListed {
  readonly holder: InboxHolder;
  readonly item: InboxItem;
}

export const NO_ITEMS: readonly InboxItem[] = [];

const keptGroups = new WeakMap<InboxHolder, InboxGroup>();

export function inboxGroup(holder: InboxHolder, items: readonly InboxItem[]): InboxGroup {
  const kept = keptGroups.get(holder);
  if (kept?.items === items) return kept;
  const group = { holder, items };
  keptGroups.set(holder, group);
  return group;
}

const keptListed = new WeakMap<InboxItem, InboxListed>();

function inboxListed(holder: InboxHolder, item: InboxItem): InboxListed {
  const kept = keptListed.get(item);
  if (kept?.holder === holder) return kept;
  const listed = { holder, item };
  keptListed.set(item, listed);
  return listed;
}

export interface InboxListView {
  readonly readerId: string | undefined;
  readonly items: readonly InboxListed[];
}

export function readersItem(item: InboxItem, readerId: string | undefined): boolean {
  const waitsOn = inboxWaitsOn(item)?.userId;
  return waitsOn === undefined || readerId === undefined || waitsOn === readerId;
}

export function waitsOnReader(
  entry: Pick<AppInboxTasklessItem, "startedBy" | "waitsOn">,
  readerId: string | undefined,
): boolean {
  const waitsOn = entry.waitsOn ?? entry.startedBy;
  return waitsOn === undefined || readerId === undefined || waitsOn === readerId;
}

export function holdsAsk(item: Pick<AppInboxWaitingItem, "asking">): boolean {
  return item.asking !== false;
}

function needsReader(item: InboxItem, readerId: string | undefined): boolean {
  return item.status === INBOX_STATUS.OPEN && readersItem(item, readerId);
}

export function acknowledgedOnOpen(item: InboxItem, readerId: string | undefined): boolean {
  return (
    readerId !== undefined && needsReader(item, readerId) && awaitsNod(item) && !item.needsReply
  );
}

export function needsYou(listed: InboxListed, readerId: string | undefined): boolean {
  return needsReader(listed.item, readerId);
}

export function taskGroups(groups: readonly InboxGroup[], taskId: string): readonly InboxGroup[] {
  return groups.filter(
    ({ holder }) => holder.kind === INBOX_HOLDER.TASK && holder.task.id === taskId,
  );
}

export function openItems(groups: readonly InboxGroup[]): readonly InboxListed[] {
  return groups
    .flatMap(({ holder, items }) => items.map((item) => inboxListed(holder, item)))
    .filter((listed) => needsYou(listed, undefined))
    .toSorted((a, b) => newestFirst(a.item, b.item));
}

function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.updatedAt - a.updatedAt;
}

export interface InboxPlace {
  readonly at: number;
}

export const NO_PLACES: ReadonlyMap<string, InboxPlace> = new Map();

const NO_SEARCH: readonly string[] = [];

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

export function narrowedByWhose(show: InboxShow): boolean {
  return show !== INBOX_SHOW.NEEDS_ME;
}

function scopedItem(
  show: InboxShow,
  whose: InboxWhose,
  item: InboxItem,
  readerId: string | undefined,
): boolean {
  return (
    showsItem(show, item, readerId) && (!narrowedByWhose(show) || whoseItem(whose, item, readerId))
  );
}

export function inboxList(
  tasks: readonly InboxGroup[],
  view: {
    readonly show: InboxShow;
    readonly chosen: string | undefined;
    readonly readerId: string | undefined;
    readonly whose?: InboxWhose | undefined;
    readonly search?: readonly string[] | undefined;
    readonly places?: ReadonlyMap<string, InboxPlace> | undefined;
  },
): InboxListView {
  const { readerId, whose = EVERYONES, search = NO_SEARCH, places = NO_PLACES } = view;
  const at = (item: InboxItem): number => places.get(item.id)?.at ?? item.updatedAt;
  const items = tasks
    .flatMap(({ holder, items }) =>
      items
        .filter(
          (item) =>
            (scopedItem(view.show, whose, item, readerId) && searchedItem(holder, item, search)) ||
            item.id === view.chosen,
        )
        .map((item) => inboxListed(holder, item)),
    )
    .toSorted((a, b) => at(b.item) - at(a.item));
  return { items, readerId };
}

export function inboxPlaces(
  view: InboxListView,
  held: ReadonlyMap<string, InboxPlace>,
): ReadonlyMap<string, InboxPlace> {
  return new Map(
    view.items.map(({ item }) => [item.id, held.get(item.id) ?? { at: item.updatedAt }]),
  );
}

export function isUnread(item: InboxItem): boolean {
  return item.unread === true;
}

export function hasReminder(item: InboxItem): boolean {
  return item.remindAt !== undefined;
}

function itemAtNow(item: InboxItem, now: number): InboxItem {
  const { remindAt, ...rest } = item;
  if (remindAt === undefined || remindAt > now) return item;
  return { ...rest, updatedAt: Math.max(item.updatedAt, remindAt) };
}

export function inboxAtNow(groups: readonly InboxGroup[], now: number): readonly InboxGroup[] {
  return groups.map((group) => {
    const items = group.items.map((item) => itemAtNow(item, now));
    return items.every((item, index) => item === group.items[index]) ? group : { ...group, items };
  });
}

function closedQuietly(item: InboxItem): boolean {
  if (item.status !== INBOX_STATUS.CLOSED || item.markedUnread === true) return false;
  return item.updatedAt <= (item.settledAt ?? item.updatedAt);
}

export function isDone(item: InboxItem): boolean {
  return item.status !== INBOX_STATUS.OPEN && (!isUnread(item) || closedQuietly(item));
}

function showsItem(show: InboxShow, item: InboxItem, readerId: string | undefined): boolean {
  switch (show) {
    case INBOX_SHOW.NEEDS_ME:
      return threadNeedsReader(item, readerId) && !hasReminder(item);
    case INBOX_SHOW.OPEN:
      return !isDone(item) && !hasReminder(item);
    case INBOX_SHOW.ALL:
      return !hasReminder(item);
    case INBOX_SHOW.REMINDERS:
      return hasReminder(item);
  }
}

export function inboxCounts(
  tasks: readonly InboxGroup[],
  readerId: string | undefined,
  whose: InboxWhose = EVERYONES,
): InboxCounts {
  const items = tasks.flatMap(({ holder, items }) =>
    items.map((item) => inboxListed(holder, item)),
  );
  const count = (show: InboxShow) =>
    items.filter(({ item }) => scopedItem(show, whose, item, readerId)).length;
  return {
    [INBOX_SHOW.NEEDS_ME]: count(INBOX_SHOW.NEEDS_ME),
    [INBOX_SHOW.OPEN]: count(INBOX_SHOW.OPEN),
    [INBOX_SHOW.ALL]: count(INBOX_SHOW.ALL),
    [INBOX_SHOW.REMINDERS]: count(INBOX_SHOW.REMINDERS),
  };
}

export function anyUnread(tasks: readonly InboxGroup[]): boolean {
  return tasks.some(({ items }) => items.some(isUnread));
}

export function listedItems(view: InboxListView): readonly InboxListed[] {
  return view.items;
}

export interface InboxSteps {
  readonly at: number;
  readonly total: number;
  readonly previous: InboxListed | undefined;
  readonly next: InboxListed | undefined;
}

export function inboxSteps(
  view: InboxListView,
  chosen: string | undefined,
): InboxSteps | undefined {
  const rowed = view.items;
  const at = rowed.findIndex(({ item }) => item.id === chosen);
  if (at < 0) return undefined;
  return { at: at + 1, total: rowed.length, previous: rowed[at - 1], next: rowed[at + 1] };
}

export function inboxEnds(
  view: InboxListView,
): { readonly first: InboxListed; readonly last: InboxListed } | undefined {
  const first = view.items[0];
  const last = view.items.at(-1);
  return first === undefined || last === undefined ? undefined : { first, last };
}

const CODE_CONTEXT_LINES = 3;

export const CODE_READ = {
  READING: "reading",
  READY: "ready",
  NOTICE: "notice",
} as const;

export type CodeRead =
  | { readonly kind: typeof CODE_READ.READING }
  | { readonly kind: typeof CODE_READ.READY; readonly code: SnippetLines }
  | {
      readonly kind: typeof CODE_READ.NOTICE;
      readonly line: string;
      readonly again: boolean;
    };

const CODE_UNREAD = "These lines could not be read.";

export function codeWindow(block: InboxCodeBlock): TaskFileRequest {
  return {
    path: block.path,
    firstLine: Math.max(1, block.startLine - CODE_CONTEXT_LINES),
    lastLine: block.endLine + CODE_CONTEXT_LINES,
    ref: block.sha,
  };
}

export function codeNotice(block: InboxCodeBlock, repository: string | null): string | undefined {
  if (repository === null || repository.toLowerCase() !== block.repo.toLowerCase()) {
    return `These lines are in ${block.repo}, which this task no longer reads.`;
  }
  if (!codeLinesReadable(block)) return "These lines cannot be read.";
  return undefined;
}

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

export const CODE_READ_FAILED: CodeRead = {
  kind: CODE_READ.NOTICE,
  line: CODE_UNREAD,
  again: true,
};
