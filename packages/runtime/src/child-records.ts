import type { SessionKey } from "./identifiers.js";

/**
 * The vocabulary of delegation: a child is one agent run a conversation
 * asked for, in a conversation of its own. The child's id is that
 * conversation's uuid, and its session key
 * (`agent:<agentId>:subagent:<childId>`) is derived from it, so a child has
 * one identifier and nothing else to mint. A child's context is isolated: a
 * clean transcript that starts with its task. Nothing here runs a child or
 * tells a parent of its end; these are the record the hosted brain reads
 * back to a parent that lists its children and the receipt a spawn hands
 * back. What a parent is told of a child's end is the record's own terminal
 * slice: its status, its failure detail, and the instant it settled.
 */

/**
 * Where a child stands, in the words the store derives it from the child's
 * latest turn. Accepted is the spawn recorded and acknowledged; running is
 * the child's turn under way; the terminal statuses say how it ended.
 */
export const CHILD_RUN_STATUS = {
  ACCEPTED: "accepted",
  RUNNING: "running",
  SETTLED: "settled",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

type ChildRunStatus = (typeof CHILD_RUN_STATUS)[keyof typeof CHILD_RUN_STATUS];

/** One child as its parent lists it: the id, the label the spawn gave it, and where it stands. */
export interface ChildRunRecord {
  readonly childId: string;
  readonly label?: string;
  readonly status: ChildRunStatus;
  readonly acceptedAt: number;
  readonly settledAt?: number;
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
