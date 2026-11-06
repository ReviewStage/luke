import type { TaskCallResult } from "./task-client.js";

export const WORKSPACE_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  NOT_PERMITTED: "not-permitted",
  NOT_FOUND: "not-found",
  ALREADY_INVITED: "already-invited",
  SLUG_MALFORMED: "slug-malformed",
  SLUG_RESERVED: "slug-reserved",
  SLUG_TAKEN: "slug-taken",
} as const;

export type WorkspaceCallFailure =
  (typeof WORKSPACE_CALL_FAILURE)[keyof typeof WORKSPACE_CALL_FAILURE];

export type WorkspaceCallResult<Answer> = TaskCallResult<Answer, WorkspaceCallFailure>;
