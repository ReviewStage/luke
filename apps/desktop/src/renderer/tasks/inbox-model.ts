import type { FileChip } from "@luke/features/attachment-model";
import type { CodingAgentAttachment } from "@luke/features/coding-agent-wire";
import {
  codeLinesReadable,
  fieldValueWords,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxCodeBlock,
  type InboxFieldValue,
  type InboxForm,
  type InboxFormValue,
  type InboxItem,
  type InboxMessage,
  type InboxReadResponse,
  type InboxReply,
  type InboxReplyKind,
  inboxReplyRefusal,
  knownResponse,
} from "@luke/features/inbox-wire";
import type { TaskFileRequest, TaskSummary } from "@luke/features/task-wire";
import type { TaskCode, TasksFileAnswer } from "@luke/features/tasks-view";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { isWireString } from "@luke/wire";
import type { CountNoun } from "../desktop/sidebar-group-header";
import { refusalLine, refusalPasses } from "./file-tab-model";

/**
 * inbox-model.ts -- the Inbox as pure decisions: which items it lists and how, what an item's answer is, and how a settled one reads.
 *
 * The list holds every item of every plan it is handed, the latest changed
 * first, under its plan, under the person whose agent asks it, or in one
 * run. An item is the reader's where they started the agent that asks it,
 * or where the service does not say who did, as main counts what waits on
 * the account (`agent-notices.ts`), and only the reader's open items need
 * them: Needs you lists only those, though the steps through it keep the
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

/** What the developer has put on a card so far: the options picked on a choice, the fields filled on a form, their note, and the files they attached to it. */
export interface InboxDraft {
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly note: string;
  readonly attachments: readonly CodingAgentAttachment[];
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

/** The draft with the option pressed: picked where it was not, let go where it was; one at a time unless the choice allows several. */
export function withChoice(draft: InboxDraft, label: string, multiple: boolean): InboxDraft {
  const picked = draft.choices.includes(label);
  if (picked) return { ...draft, choices: draft.choices.filter((each) => each !== label) };
  return { ...draft, choices: multiple ? [...draft.choices, label] : [label] };
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

/** The answer's kind for what the card holds: a press where the response is answered by one, else the options picked, the form filled, or the developer's words or files. */
function replyKindOf(
  item: Pick<InboxItem, "response">,
  draft: InboxDraft,
  press: InboxReplyKind | undefined,
): InboxReplyKind | undefined {
  if (press !== undefined) return press;
  const response = item.response;
  if (response.type === INBOX_RESPONSE.CHOICE && draft.choices.length > 0) return INBOX_REPLY.CHOSE;
  if (response.type === INBOX_RESPONSE.FORM) return INBOX_REPLY.SUBMITTED;
  return draft.note.trim() === "" && draft.attachments.length === 0
    ? undefined
    : INBOX_REPLY.ANSWERED;
}

/** A form's values as sent, in the form's own order: words trimmed, a field left blank left out, and a switch left alone sent as no. */
function sentValues(form: InboxForm, draft: InboxDraft): readonly InboxFormValue[] {
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
 * or by the developer's own words; an approval, a task, and an item asking
 * nothing by their presses, with the note beside them; words by words; a
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

/** The presses each response answered by a press offers: the one that holds back where there is one, then the one that goes ahead. */
export const INBOX_PRESSES = {
  [INBOX_RESPONSE.APPROVAL]: {
    back: { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  },
  [INBOX_RESPONSE.TODO]: {
    back: { reply: INBOX_REPLY.NOT_DONE, label: "Can't do this" },
    ahead: { reply: INBOX_REPLY.DONE, label: "Done" },
  },
  [INBOX_RESPONSE.NONE]: {
    back: undefined,
    ahead: { reply: INBOX_REPLY.ACKNOWLEDGED, label: "Got it" },
  },
} as const;

/** The presses that answer the response, or nothing where words, a pick, or a form answer it. */
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

/** Who settled an item: the developer, by answering it, or its agent, by taking it back. */
export const SETTLED_BY = {
  DEVELOPER: "developer",
  AGENT: "agent",
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
 * or taken back by its agent, said whole, and why.
 */
export type Settlement =
  | {
      readonly by: typeof SETTLED_BY.DEVELOPER;
      readonly did: string;
      readonly values?: string;
      readonly note?: string;
    }
  | { readonly by: typeof SETTLED_BY.AGENT; readonly lead: string; readonly words?: string };

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

/**
 * The Inbox's one name for an item waiting on the developer's answer, in
 * each form its surfaces say it: the list's filter, a count's words after
 * its figure, the line where nothing is listed, and the line under it where
 * the filter leaves out every item listed. A settled item reads as
 * answered. Every surface reads its words here, so the name is changed in
 * this one place.
 */
export const NEEDS_YOU = {
  LABEL: "Needs you",
  COUNT: { one: "needs you", many: "need you" } satisfies CountNoun,
  NONE: "Nothing needs you",
  ANSWERED: "You've answered everything",
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

/** How the window's Inbox lists its items: under each task, or in one list. */
export const INBOX_GROUPING = {
  TASK: "plan",
  NEWEST: "newest",
  PERSON: "person",
} as const;

export type InboxGrouping = (typeof INBOX_GROUPING)[keyof typeof INBOX_GROUPING];

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

/**
 * The list as it is drawn: a group for each task holding an item it shows,
 * one for each person whose agents ask one, or every item in one run; and
 * the reader it was drawn for, whose items alone need them.
 */
export type InboxListView = { readonly readerId: string | undefined } & (
  | { readonly grouping: typeof INBOX_GROUPING.TASK; readonly groups: readonly InboxGroup[] }
  | { readonly grouping: typeof INBOX_GROUPING.NEWEST; readonly items: readonly InboxListed[] }
  | {
      readonly grouping: typeof INBOX_GROUPING.PERSON;
      readonly groups: readonly InboxPersonGroup[];
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

/** Whether an item needs the reader: open, and theirs (`readersItem`); a teammate's open item waits on the teammate. */
export function needsReader(item: InboxItem, readerId: string | undefined): boolean {
  return item.status === INBOX_STATUS.OPEN && readersItem(item, readerId);
}

/** What a person's group is folded by: their account's id, or one key for the reader's own. */
const PERSON_KEY = { PREFIX: "person:", YOU: "person:you" } as const;

/**
 * The items, the latest changed first, grouped by who started their agents:
 * the reader's own first, then each teammate's, the one whose item changed
 * latest first, each group's items in the order given.
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
  // Note that the groups stand in the order their latest item changed, which a stable sort keeps behind the reader's own.
  return [...groups.values()].toSorted(
    (a, b) => Number(a.starter !== undefined) - Number(b.starter !== undefined),
  );
}

/** The latest change first. */
function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.updatedAt - a.updatedAt;
}

/**
 * The list from every task's items: each item the latest changed first,
 * under its plan, under the person whose agent asks it, or in one run, the
 * tasks in the order their latest item changed and the people as
 * `personGroups` orders them. Needs you lists only what needs the reader,
 * and the item chosen where one is given. Note that the rows a list draws are given none,
 * so a settled item leaves a list filtered to exclude it, while the steps
 * through the list are given the item the pane shows, which keeps its place
 * among them so K, J, and Next still reach the rows either side of it.
 */
export function inboxList(
  tasks: readonly InboxGroup[],
  view: {
    readonly grouping: InboxGrouping;
    readonly waitingOnly: boolean;
    readonly chosen: string | undefined;
    /** The signed-in account's id, whose own open items alone need them; none counts every item as theirs. */
    readonly readerId: string | undefined;
  },
): InboxListView {
  const { readerId } = view;
  const shows = (item: InboxItem) =>
    !view.waitingOnly || needsReader(item, readerId) || item.id === view.chosen;
  const groups = tasks
    .map(({ holder, items }) => ({ holder, items: items.filter(shows).toSorted(newestFirst) }))
    .filter((group) => group.items.length > 0)
    .toSorted((a, b) => (b.items[0]?.updatedAt ?? 0) - (a.items[0]?.updatedAt ?? 0));
  if (view.grouping === INBOX_GROUPING.TASK) {
    return { grouping: INBOX_GROUPING.TASK, groups, readerId };
  }
  const items = groups
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .toSorted((a, b) => newestFirst(a.item, b.item));
  if (view.grouping === INBOX_GROUPING.NEWEST) {
    return { grouping: INBOX_GROUPING.NEWEST, items, readerId };
  }
  return { grouping: INBOX_GROUPING.PERSON, groups: personGroups(items, readerId), readerId };
}

/** Whether any task's item needs the reader, listed or filtered out. */
export function anyNeedsYou(tasks: readonly InboxGroup[], readerId: string | undefined): boolean {
  return tasks.some(({ items }) => items.some((item) => needsReader(item, readerId)));
}

/** Every item the list draws, in the order it draws them. */
export function listedItems(view: InboxListView): readonly InboxListed[] {
  if (view.grouping === INBOX_GROUPING.NEWEST) return view.items;
  if (view.grouping === INBOX_GROUPING.PERSON) return view.groups.flatMap(({ items }) => items);
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
  if (view.grouping === INBOX_GROUPING.NEWEST) return view.items;
  if (view.grouping === INBOX_GROUPING.PERSON) {
    return view.groups.flatMap(({ key, items }) =>
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
    ({ item }) => needsReader(item, view.readerId) && item.id !== chosen,
  );
}

/** The item that stands chosen where none is: the first listed that needs the reader, else the first listed. */
export function firstChoice(view: InboxListView): InboxListed | undefined {
  const listed = listedItems(view);
  return listed.find(({ item }) => needsReader(item, view.readerId)) ?? listed[0];
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
