import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentActionRequest,
  type DescriptionCommentEntry,
  type DescriptionCommentStart,
  type DescriptionCommentWriter,
} from "@repo/features/description-comment-wire";
import { descriptionSections } from "@repo/features/description-document";
import type {
  TasksCommentActParams,
  TasksCommentAnswer,
  TasksCommentStartParams,
} from "@repo/features/tasks-view";
import { carried } from "@repo/gateway";
import {
  type FieldChange,
  type Refused,
  ROW_GONE,
  type WriteDeclaration,
  type Written,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Effect } from "effect";
import { COMMENT_THREAD, type CommentThreadRow } from "./description-comment-reads.js";

/**
 * description-comment-writes.ts -- every write a window makes to a task's comments, declared once on the sync engine: a thread started, and a reply, an edit, a deletion, a resolve, or a reopen of one, each drawn over its thread in every subject that holds it the moment it is asked.
 *
 * A thread is started under the id its window minted, so the thread is
 * drawn in its subject, its first comment the reader's, before the service
 * answers (`description-comment-reads.ts` adopts it there). Every other write is a
 * change of the thread's own row: its status, its comments, or its going.
 * Each stands until the subject's read carries the transaction the service
 * answered it with, and is taken back where the service refused it, or
 * answered nothing, before its window hears so. Note that the last writer
 * wins: a change is drawn over whatever the read last answered, a
 * teammate's edit among it.
 *
 * What a write draws is what the window would read once it lands, but for
 * what only the service knows: a comment's files, which land with the read,
 * and the line a resolve or a reopen writes in the thread.
 */

/** Who writes a comment here: the member signed in. */
type CommentMember = NonNullable<DescriptionCommentWriter["by"]>;

export interface DescriptionCommentWritesDependencies {
  /** Carries a thread's start to the service, or answers that it went unanswered. */
  readonly start: (
    planId: string,
    start: DescriptionCommentStart,
  ) => Effect.Effect<TasksCommentAnswer>;
  /** Carries one thing done to one thread to the service, or answers that it went unanswered. */
  readonly act: (
    planId: string,
    threadId: string,
    action: DescriptionCommentActionRequest,
  ) => Effect.Effect<TasksCommentAnswer>;
  /** The member signed in, whose comment a write draws; none where nobody is. */
  readonly member: () => CommentMember | undefined;
  /** The host's own instant, which a comment drawn before the service names its own is written at. */
  readonly now: () => number;
}

/** The comment a member's write draws before the service answers it, under the key it was sent under. */
function drawnComment(
  member: CommentMember | undefined,
  clientKey: string,
  words: string,
  at: number,
): DescriptionCommentEntry {
  return {
    id: clientKey,
    kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
    writer: {
      actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
      ...(member === undefined ? undefined : { by: member }),
    },
    words,
    at,
  };
}

/** The heading of the section a place in the text stands in, as the service keeps it; empty before the first heading. */
function sectionAt(text: string, offset: number): string {
  return descriptionSections(text).findLast((section) => section.from <= offset)?.heading ?? "";
}

/** Where a thread being started stands, as the service will place it: on the plan's words its start measured, or on its page's element, or the whole page. */
function placed(start: DescriptionCommentStart) {
  if (!("page" in start)) {
    return {
      scope: start.scope,
      quote: start.quote,
      anchor: start.anchor,
      section: sectionAt(start.text, start.anchor.from),
    };
  }
  const { element } = start;
  const page = { id: start.page.id, version: start.page.version };
  if (element === undefined) {
    return { scope: DESCRIPTION_COMMENT_SCOPE.PAGE, quote: "", page, section: "" };
  }
  return {
    scope:
      element.words === true ? DESCRIPTION_COMMENT_SCOPE.WORDS : DESCRIPTION_COMMENT_SCOPE.ELEMENT,
    quote: element.quote,
    page: { ...page, element: element.path },
    section: element.section,
  };
}

/** A thread as its start draws it before the service answers: open, its one comment the member's. */
function drawnThread(
  { planId, start }: TasksCommentStartParams,
  member: CommentMember | undefined,
  at: number,
): CommentThreadRow {
  return {
    id: start.id ?? "",
    taskId: planId,
    ...placed(start),
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [drawnComment(member, start.clientKey, start.words, at)],
    createdAt: at,
    updatedAt: at,
    revision: 0,
  };
}

/**
 * Whether the thread already holds a reply the member sent with these words,
 * which the read answers before the reply stands down. Note that a comment
 * the service wrote names no key, so a reply is known by its writer and its
 * words, and the same words sent twice draw once until the read holds both.
 */
function holdsReply(
  row: CommentThreadRow,
  member: CommentMember | undefined,
  words: string,
): boolean {
  return row.entries.some(
    (entry) =>
      entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT &&
      entry.writer.by?.userId === member?.userId &&
      entry.words === words,
  );
}

/** What one thing done to a thread draws over its row, from the row as it is drawn now. */
function actChange(
  action: DescriptionCommentActionRequest,
  member: CommentMember | undefined,
  at: number,
): FieldChange<CommentThreadRow> {
  switch (action.action) {
    case DESCRIPTION_COMMENT_ACTION.REPLY:
      return (row) =>
        holdsReply(row, member, action.words)
          ? {}
          : {
              entries: [...row.entries, drawnComment(member, action.clientKey, action.words, at)],
            };
    case DESCRIPTION_COMMENT_ACTION.EDIT:
      return (row) => ({
        entries: row.entries.map((entry) =>
          entry.id !== action.entry || entry.words === action.words
            ? entry
            : { ...entry, words: action.words, editedAt: at },
        ),
      });
    case DESCRIPTION_COMMENT_ACTION.DELETE:
      // Note that deleting a thread's first comment deletes the thread, as the service does.
      return (row) =>
        row.entries.find((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT)?.id ===
        action.entry
          ? ROW_GONE
          : { entries: row.entries.filter((entry) => entry.id !== action.entry) };
    case DESCRIPTION_COMMENT_ACTION.RESOLVE:
      return () => ({ status: DESCRIPTION_COMMENT_STATUS.RESOLVED });
    case DESCRIPTION_COMMENT_ACTION.REOPEN:
      return () => ({ status: DESCRIPTION_COMMENT_STATUS.OPEN });
    case DESCRIPTION_COMMENT_ACTION.DELETE_THREAD:
      return () => ROW_GONE;
  }
}

/**
 * A comment write's answer as the engine takes it: the thread as it now
 * stands, or its deletion, kept until the read carries its transaction; a
 * refusal, or no answer at all, taken back. Where the read hands no wait,
 * the answer is taken in its place: a thread started as made, where the
 * read holds none yet, and any other thread as its answered fields.
 */
function writtenOf(
  planId: string,
  answer: TasksCommentAnswer,
  made: boolean,
): Written<FieldChange<CommentThreadRow>, WireValue> | Refused<WireValue> {
  if ("deleted" in answer) {
    return { answer: carried(answer), txid: answer.txid, taken: () => ROW_GONE };
  }
  if (!("thread" in answer)) return { refused: carried(answer) };
  const { thread } = answer;
  return {
    answer: carried(answer),
    txid: answer.txid,
    taken: made ? { made: { ...thread, taskId: planId } } : () => thread,
  };
}

/** The comment writes a window makes, each declared on the thread it changes. */
export function descriptionCommentWrites(dependencies: DescriptionCommentWritesDependencies) {
  const { member, now } = dependencies;
  const started: WriteDeclaration<
    CommentThreadRow,
    FieldChange<CommentThreadRow>,
    TasksCommentStartParams,
    WireValue
  > = {
    kind: COMMENT_THREAD,
    // Note that a start naming no id draws nothing, so it answers as the service does.
    keys: ({ start }) => (start.id === undefined ? [] : [start.id]),
    change: (params) => ({ made: drawnThread(params, member(), now()) }),
    send: ({ planId, start }) =>
      Effect.map(dependencies.start(planId, start), (answer) => writtenOf(planId, answer, true)),
  };
  const acted: WriteDeclaration<
    CommentThreadRow,
    FieldChange<CommentThreadRow>,
    TasksCommentActParams,
    WireValue
  > = {
    kind: COMMENT_THREAD,
    keys: ({ threadId }) => [threadId],
    change: ({ action }) => actChange(action, member(), now()),
    send: ({ planId, threadId, action }) =>
      Effect.map(dependencies.act(planId, threadId, action), (answer) =>
        writtenOf(planId, answer, false),
      ),
  };
  return { started, acted };
}
