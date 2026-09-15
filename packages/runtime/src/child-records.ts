import type { AgentId, SessionKey } from "./identifiers.js";

/**
 * The vocabulary of delegation: a child is one agent run a conversation
 * asked for, in a conversation of its own. The child's id is that
 * conversation's uuid, and its session key
 * (`agent:<agentId>:subagent:<childId>`) is derived from it, so a child has
 * one identifier and nothing else to mint. A child's context is isolated: a
 * clean transcript that starts with its task. Nothing here runs a child or
 * tells a parent of its end; these are the record the hosted brain keeps and
 * the receipt a spawn hands back. What a parent is told of a child's end is
 * the record's own terminal slice: its status, its result text or failure
 * detail, and the instant it settled.
 */

/**
 * Where a child stands. Accepted is the spawn recorded and acknowledged;
 * running is the child's turn under way; the terminal statuses say how it
 * ended.
 */
export const CHILD_RUN_STATUS = {
  ACCEPTED: "accepted",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

type ChildRunStatus = (typeof CHILD_RUN_STATUS)[keyof typeof CHILD_RUN_STATUS];

const CHILD_RUN_TERMINAL_STATUS: ReadonlySet<ChildRunStatus> = new Set([
  CHILD_RUN_STATUS.COMPLETED,
  CHILD_RUN_STATUS.FAILED,
  CHILD_RUN_STATUS.CANCELLED,
]);

export function isTerminalChildRunStatus(status: ChildRunStatus): boolean {
  return CHILD_RUN_TERMINAL_STATUS.has(status);
}

/**
 * One spawn as the store keeps it. The requester is the conversation and
 * the run that asked; the child is the conversation that answers, and its
 * completion, when one is owed, goes back to the requester's conversation.
 */
export interface ChildRunRecord {
  readonly childId: string;
  readonly agentId: AgentId;
  readonly requesterSessionKey: SessionKey;
  readonly requesterRunId?: string;
  readonly childSessionKey: SessionKey;
  readonly task: string;
  readonly label?: string;
  /** Whether the requester is owed a completion at all; false for fire-and-forget children. */
  readonly expectsCompletion: boolean;
  readonly status: ChildRunStatus;
  readonly acceptedAt: number;
  readonly startedAt?: number;
  readonly settledAt?: number;
  /** The child's final visible reply, for a completed child. */
  readonly resultText?: string;
  readonly failureDetail?: string;
}

/**
 * What a spawn hands back once the record is durable: the child's
 * identifiers. Acceptance is not completion; the completion arrives in the
 * requester's conversation on its own.
 */
export interface ChildSpawnReceipt {
  readonly childId: string;
  readonly childSessionKey: SessionKey;
}
