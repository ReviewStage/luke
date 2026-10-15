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
  type InboxReadResponse,
  type InboxReply,
  type InboxReplyKind,
  inboxReplyRefusal,
  knownResponse,
} from "@luke/features/inbox-wire";
import type { PlanFileRequest, PlanSummary } from "@luke/features/plan-wire";
import type { PlanCode, PlanningFileAnswer } from "@luke/features/planning-view";
import type { AppInboxPlanlessItem } from "@luke/host/app-state";
import { isWireString } from "@luke/wire";
import type { CountNoun } from "../desktop/sidebar-group-header";
import { refusalLine, refusalPasses } from "./file-tab-model";

/**
 * inbox-model.ts -- the Inbox as pure decisions: which items it lists and how, what an item's answer is, and how a settled one reads.
 *
 * The list holds every item of every plan it is handed, the latest changed
 * first, under its plan or in one run, and Needs you lists only what waits
 * and the item chosen. A settled item keeps everything its agent offered,
 * the developer's pick marked, and says who settled it and what they
 * wrote. A plan's board, which counts what waits, holds what waits the
 * oldest posted first, since it has held its agent longest, and what is
 * settled, answered or taken back by its agent, the latest changed first.
 * Every item the plan's inbox holds is
 * drawn, whether or not the window's list of agents has caught up with the
 * agent that posted it, since the service reads the inbox by plan and an
 * agent's items go with it. A card's answer is held to the same rule the
 * service holds it to (`inbox-wire.ts`'s `inboxReplyRefusal`), so a press
 * the service would refuse is never offered; an item asking a response
 * this build does not know holds no answer at all. A code block's lines
 * are read as the File tab reads a file, at the block's commit, with a few
 * of the file around them, the lines it points at lit. Nothing here draws.
 */

/** What the developer has put on a card so far: the options picked on a choice, the fields filled on a form, and their note. */
export interface InboxDraft {
  readonly choices: readonly string[];
  readonly values: readonly InboxFormValue[];
  readonly note: string;
}

export const EMPTY_INBOX_DRAFT: InboxDraft = { choices: [], values: [], note: "" };

/** The board as the tab draws it. */
export interface InboxBoardView {
  readonly open: readonly InboxItem[];
  readonly settled: readonly InboxItem[];
}

/** The plan's board from its inbox: what waits the oldest posted first, and what is settled the latest changed first. */
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

/** The answer's kind for what the card holds: a press where the response is answered by one, else the options picked, the form filled, or the developer's words. */
function replyKindOf(
  item: InboxItem,
  draft: InboxDraft,
  press: InboxReplyKind | undefined,
): InboxReplyKind | undefined {
  if (press !== undefined) return press;
  const response = item.response;
  if (response.type === INBOX_RESPONSE.CHOICE && draft.choices.length > 0) return INBOX_REPLY.CHOSE;
  if (response.type === INBOX_RESPONSE.FORM) return INBOX_REPLY.SUBMITTED;
  return draft.note.trim() === "" ? undefined : INBOX_REPLY.ANSWERED;
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
 * form by its fields, with the note beside them.
 */
export function inboxReply(
  item: InboxItem,
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
  return inboxReplyRefusal(item, answer) === undefined ? answer : undefined;
}

/** The presses each response answered by a press offers: the one that holds back where there is one, then the one that goes ahead. */
export const INBOX_PRESSES = {
  [INBOX_RESPONSE.APPROVAL]: {
    back: { reply: INBOX_REPLY.DECLINED, label: "Decline" },
    ahead: { reply: INBOX_REPLY.APPROVED, label: "Approve" },
  },
  [INBOX_RESPONSE.TASK]: {
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
    case INBOX_RESPONSE.TASK:
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

/** How an answer's member is named where the service names nobody: their account is gone, or the answer predates answerers being kept. */
const UNNAMED_ANSWERER = "Someone";

/**
 * Who answered an item, as its settled line names them: "You" only for the
 * reader, a teammate by name, and someone where nobody can be named or the
 * reader's id is not known.
 */
export function answererOf(
  item: Pick<InboxItem, "answeredBy">,
  readerId: string | undefined,
): string {
  const by = item.answeredBy;
  if (by === undefined) return UNNAMED_ANSWERER;
  return readerId !== undefined && by.userId === readerId ? "You" : by.name;
}

/** How a settled item came to be settled: who settled it, what they did in a few words, and what they wrote. */
export interface Settlement {
  readonly by: (typeof SETTLED_BY)[keyof typeof SETTLED_BY];
  readonly lead: string;
  readonly words?: string;
}

/** What the developer wrote: a form's values one per line, then the note. */
function answerWords(answer: InboxReply): string | undefined {
  const values = (answer.values ?? []).map(
    ({ label, value }) => `${label}: ${fieldValueWords(value)}`,
  );
  const lines = [...values, ...(answer.note === undefined ? [] : [answer.note])];
  return lines.length === 0 ? undefined : lines.join("\n");
}

/** How an item was settled, or nothing while it waits: who answered and what they did and wrote, or the agent taking it back and why. */
export function settlementOf(
  item: InboxItem,
  readerId: string | undefined,
): Settlement | undefined {
  if (item.status === INBOX_STATUS.OPEN) return undefined;
  if (item.status === INBOX_STATUS.CLOSED) {
    return {
      by: SETTLED_BY.AGENT,
      lead: "Withdrawn by the agent",
      ...(item.closedReason === undefined ? undefined : { words: item.closedReason }),
    };
  }
  const answer = item.answer;
  const who = answererOf(item, readerId);
  if (answer === undefined)
    return { by: SETTLED_BY.DEVELOPER, lead: `${who} ${REPLY_WORDS[INBOX_REPLY.ANSWERED]}` };
  const lead =
    answer.reply === INBOX_REPLY.CHOSE
      ? `${who} ${REPLY_WORDS[INBOX_REPLY.CHOSE]} ${(answer.choices ?? []).join(", ")}`
      : `${who} ${REPLY_WORDS[answer.reply]}`;
  const words = answerWords(answer);
  return { by: SETTLED_BY.DEVELOPER, lead, ...(words === undefined ? undefined : { words }) };
}

/**
 * The Inbox's one name for an item waiting on the developer's answer, in
 * each form its surfaces say it: the list's filter, a count's words after
 * its figure, and the line where nothing is listed. A settled item reads as
 * answered. Every surface reads its words here, so the name is changed in
 * this one place.
 */
export const NEEDS_YOU = {
  LABEL: "Needs you",
  COUNT: { one: "needs you", many: "need you" } satisfies CountNoun,
  NONE: "Nothing needs you",
} as const;

/** What an item is listed under: the plan its agent works on, or, for an agent with no plan, the automation that started it. */
export const INBOX_HOLDER = {
  PLAN: "plan",
  AUTOMATION: "automation",
} as const;

/** The plan holding an item, or the automation holding an item of an agent with no plan, named as its group's header names it; none for the agents no automation the reader may read started. */
export type InboxHolder =
  | { readonly kind: typeof INBOX_HOLDER.PLAN; readonly plan: PlanSummary }
  | {
      readonly kind: typeof INBOX_HOLDER.AUTOMATION;
      readonly automationId: string | null;
      readonly name: string;
      readonly repository: string;
    };

/** The key a holder's group is folded and drawn by: the plan's id, the automation's, or one key for the agents no automation names. */
export function holderKey(holder: InboxHolder): string {
  if (holder.kind === INBOX_HOLDER.PLAN) return holder.plan.id;
  return holder.automationId ?? NO_AUTOMATION_KEY;
}

/** A plan as the holder of its items. */
export function planHolder(plan: PlanSummary): InboxHolder {
  return { kind: INBOX_HOLDER.PLAN, plan };
}

/** A holder's name as its header and a row's context say it: the plan's, or the automation's. */
export function holderName(holder: InboxHolder): string {
  return holder.kind === INBOX_HOLDER.PLAN ? holder.plan.name : holder.name;
}

/** What one group of agents no readable automation started is keyed by. */
const NO_AUTOMATION_KEY = "no-automation";

/** What the group of agents no automation the reader may read started is called. */
const NO_AUTOMATION_NAME = "Other agents";

/**
 * The groups the items of agents with no plan stand in: one per automation
 * that started them, by its name, and one for the agents no automation the
 * reader may read names, each holding every item its agents' reads hold,
 * settled ones too; only the listed workspace's agents, where the service
 * names an agent's workspace, so another workspace's list holds none of
 * them.
 */
export function planlessGroups(
  waiting: readonly AppInboxPlanlessItem[],
  read: ReadonlyMap<string, readonly InboxItem[]>,
  workspaceId: string | undefined,
): readonly InboxGroup[] {
  const groups = new Map<string, { holder: InboxHolder; agents: Set<string> }>();
  for (const entry of waiting) {
    // Note that with no workspace listed every agent's items stand, as every plan's do.
    const elsewhere =
      workspaceId !== undefined &&
      entry.workspaceId !== undefined &&
      entry.workspaceId !== workspaceId;
    if (elsewhere) continue;
    const holder: InboxHolder = {
      kind: INBOX_HOLDER.AUTOMATION,
      automationId: entry.automationId,
      name: entry.automationName ?? NO_AUTOMATION_NAME,
      repository: entry.repository,
    };
    const key = holderKey(holder);
    const group = groups.get(key) ?? { holder, agents: new Set<string>() };
    group.agents.add(entry.agentId);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ holder, agents }) => ({
    holder,
    items: [...agents].flatMap((agentId) => read.get(agentId) ?? []),
  }));
}

/** How the window's Inbox lists its items: under each plan, or in one list. */
export const INBOX_GROUPING = {
  PLAN: "plan",
  NEWEST: "newest",
} as const;

export type InboxGrouping = (typeof INBOX_GROUPING)[keyof typeof INBOX_GROUPING];

/** One holder, a plan or an automation, and every item it holds, as the list is handed them. */
export interface InboxGroup {
  readonly holder: InboxHolder;
  readonly items: readonly InboxItem[];
}

/** One item the list draws, with what holds it. */
export interface InboxListed {
  readonly holder: InboxHolder;
  readonly item: InboxItem;
}

/** The list as it is drawn: a group for each plan holding an item it shows, or every item in one run. */
export type InboxListView =
  | { readonly grouping: typeof INBOX_GROUPING.PLAN; readonly groups: readonly InboxGroup[] }
  | { readonly grouping: typeof INBOX_GROUPING.NEWEST; readonly items: readonly InboxListed[] };

/** The latest change first. */
function newestFirst(a: InboxItem, b: InboxItem): number {
  return b.updatedAt - a.updatedAt;
}

/**
 * The list from every plan's items: each item the latest changed first,
 * under its plan or in one run, the plans in the order their latest item
 * changed. Needs you lists only what waits on the developer, and the item
 * chosen, so the item answered does not slip away from under them.
 */
export function inboxList(
  plans: readonly InboxGroup[],
  view: {
    readonly grouping: InboxGrouping;
    readonly waitingOnly: boolean;
    readonly chosen: string | undefined;
  },
): InboxListView {
  const shows = (item: InboxItem) =>
    !view.waitingOnly || item.status === INBOX_STATUS.OPEN || item.id === view.chosen;
  const groups = plans
    .map(({ holder, items }) => ({ holder, items: items.filter(shows).toSorted(newestFirst) }))
    .filter((group) => group.items.length > 0)
    .toSorted((a, b) => (b.items[0]?.updatedAt ?? 0) - (a.items[0]?.updatedAt ?? 0));
  if (view.grouping === INBOX_GROUPING.PLAN) return { grouping: INBOX_GROUPING.PLAN, groups };
  const items = groups
    .flatMap(({ holder, items }) => items.map((item) => ({ holder, item })))
    .toSorted((a, b) => newestFirst(a.item, b.item));
  return { grouping: INBOX_GROUPING.NEWEST, items };
}

/** Whether any plan's item needs the developer, listed or filtered out. */
export function anyNeedsYou(plans: readonly InboxGroup[]): boolean {
  return plans.some(({ items }) => items.some((item) => item.status === INBOX_STATUS.OPEN));
}

/** Every item the list draws, in the order it draws them. */
export function listedItems(view: InboxListView): readonly InboxListed[] {
  if (view.grouping === INBOX_GROUPING.NEWEST) return view.items;
  return view.groups.flatMap(({ holder, items }) => items.map((item) => ({ holder, item })));
}

/** The item that stands chosen where none is: the first listed that waits, else the first listed. */
export function firstChoice(view: InboxListView): InboxListed | undefined {
  const listed = listedItems(view);
  return listed.find(({ item }) => item.status === INBOX_STATUS.OPEN) ?? listed[0];
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
  | { readonly kind: typeof CODE_READ.READY; readonly code: PlanCode }
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
export function codeWindow(block: InboxCodeBlock): PlanFileRequest {
  return {
    path: block.path,
    firstLine: Math.max(1, block.startLine - CODE_CONTEXT_LINES),
    lastLine: block.endLine + CODE_CONTEXT_LINES,
    ref: block.sha,
  };
}

/**
 * Why a code block's lines are not read at all, or nothing where they are
 * read: the plan reads its own repository alone, which the agent's
 * repository was when it started but may not be once the plan names
 * another, and lines that run backwards or past the bound are no window
 * the File tab's read takes. Note that GitHub spells a repository's name in
 * any case.
 */
export function codeNotice(block: InboxCodeBlock, repository: string | null): string | undefined {
  if (repository === null || repository.toLowerCase() !== block.repo.toLowerCase()) {
    return `These lines are in ${block.repo}, which this plan no longer reads.`;
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
export function codeReadOf(block: InboxCodeBlock, answer: PlanningFileAnswer): CodeRead {
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
