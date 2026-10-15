import type { PlanCallResult } from "./plan-client.js";

/**
 * workspace-call.ts -- why a workspace call did not happen, and the result a call answers.
 *
 * Its own module, apart from the client, so the planning view, which the
 * window reads, takes the words without taking the client and the account
 * call behind it into the window's bundle.
 */

/** Why a workspace call did not happen. */
export const WORKSPACE_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a refusal not named here, a shape not read. */
  UNANSWERED: "unanswered",
  /** The account's role in the workspace does not allow it: connecting or disconnecting GitHub or removing a member takes an owner or admin, and an owner neither leaves nor is removed. */
  NOT_PERMITTED: "not-permitted",
  /** The workspace is not one the account is a member of. */
  NOT_FOUND: "not-found",
  /** The address is already a member of the workspace, or already holds a pending invitation to it. */
  ALREADY_INVITED: "already-invited",
  /** The workspace's Linear could not be read: none is connected, Linear refused its grant, or it reaches no such issue. */
  LINEAR_UNAVAILABLE: "linear-unavailable",
} as const;

export type WorkspaceCallFailure =
  (typeof WORKSPACE_CALL_FAILURE)[keyof typeof WORKSPACE_CALL_FAILURE];

/** One workspace call's answer, or why there is none. */
export type WorkspaceCallResult<Answer> = PlanCallResult<Answer, WorkspaceCallFailure>;
