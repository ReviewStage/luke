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

type CommentMember = NonNullable<DescriptionCommentWriter["by"]>;

export interface DescriptionCommentWritesDependencies {
  readonly start: (
    planId: string,
    start: DescriptionCommentStart,
  ) => Effect.Effect<TasksCommentAnswer>;
  readonly act: (
    planId: string,
    threadId: string,
    action: DescriptionCommentActionRequest,
  ) => Effect.Effect<TasksCommentAnswer>;
  readonly member: () => CommentMember | undefined;
  readonly now: () => number;
}

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

function sectionAt(text: string, offset: number): string {
  return descriptionSections(text).findLast((section) => section.from <= offset)?.heading ?? "";
}

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

export function descriptionCommentWrites(dependencies: DescriptionCommentWritesDependencies) {
  const { member, now } = dependencies;
  const started: WriteDeclaration<
    CommentThreadRow,
    FieldChange<CommentThreadRow>,
    TasksCommentStartParams,
    WireValue
  > = {
    kind: COMMENT_THREAD,
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
