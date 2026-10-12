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
  type InboxReply,
  type InboxReplyKind,
  inboxReplyRefusal,
  knownResponse,
} from "@sidecar/hosted/inbox-wire";
import type { PlanFileRequest } from "@sidecar/hosted/plan-wire";
import type { PlanCode, PlanningFileAnswer } from "@sidecar/hosted/planning-view";
import { isWireString } from "@sidecar/wire";
import { refusalLine, refusalPasses } from "./file-tab-model";

/**
 * inbox-model.ts -- the plan's Inbox tab as pure decisions: which items wait on the developer and which are settled, what a card's answer is, and how a settled one reads.
 *
 * What waits stands first, the oldest posted first, since it has held its
 * agent longest; what is settled, answered or taken back by its agent,
 * follows, the latest changed first. Every item the plan's inbox holds is
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

/** What each answer's kind says on a settled card. */
const REPLY_WORDS = {
  [INBOX_REPLY.CHOSE]: "Chose",
  [INBOX_REPLY.APPROVED]: "Approved",
  [INBOX_REPLY.DECLINED]: "Declined",
  [INBOX_REPLY.ANSWERED]: "Answered",
  [INBOX_REPLY.DONE]: "Done",
  [INBOX_REPLY.NOT_DONE]: "Not done",
  [INBOX_REPLY.SUBMITTED]: "Filled in",
  [INBOX_REPLY.ACKNOWLEDGED]: "Acknowledged",
} as const satisfies Record<InboxReplyKind, string>;

/** What a settled card says of what came of it: a lead in strong words, and the lines after it where there are any. */
interface SettledWords {
  readonly lead: string;
  readonly note?: string;
}

/** A settled card's lines: a form's values one per line, then the note. */
function settledNote(answer: InboxReply): string | undefined {
  const values = (answer.values ?? []).map(
    ({ label, value }) => `${label}: ${fieldValueWords(value)}`,
  );
  const lines = [...values, ...(answer.note === undefined ? [] : [answer.note])];
  return lines.length === 0 ? undefined : lines.join("\n");
}

/** How a settled card says what came of it: the answer and its note, or why the agent took it back. */
export function settledWords(item: InboxItem): SettledWords {
  if (item.status === INBOX_STATUS.CLOSED) {
    return {
      lead: "Closed by the agent",
      ...(item.closedReason === undefined ? undefined : { note: item.closedReason }),
    };
  }
  const answer = item.answer;
  if (answer === undefined) return { lead: REPLY_WORDS[INBOX_REPLY.ANSWERED] };
  const lead =
    answer.reply === INBOX_REPLY.CHOSE
      ? `${REPLY_WORDS[INBOX_REPLY.CHOSE]} ${(answer.choices ?? []).join(", ")}`
      : REPLY_WORDS[answer.reply];
  const note = settledNote(answer);
  return { lead, ...(note === undefined ? undefined : { note }) };
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
