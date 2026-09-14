import type { UnparsedWireValue } from "@sidecar/wire";
import type { AgentId, SessionKey } from "./identifiers.js";

/**
 * The vocabulary of delegation: a child is one agent run a conversation
 * asked for, in a conversation of its own (`agent:<agentId>:subagent:<uuid>`,
 * OpenClaw `b7528507`'s shape), with a record that outlives the parent's
 * turn and a completion that is persisted before anyone is told of it.
 * Nothing here runs a child or delivers a completion; these are the records
 * a child store keeps and the receipt a spawn hands back.
 */

/**
 * How a child's context starts. Isolated is a clean transcript; fork branches
 * the requester's active context into the child before it starts. Non-thread
 * children default to isolated, thread-bound forks to fork, and a fork whose
 * inherited context is over the cap starts isolated and says so in the receipt.
 */
export const CHILD_CONTEXT_MODE = {
  ISOLATED: "isolated",
  FORK: "fork",
} as const;

export type ChildContextMode = (typeof CHILD_CONTEXT_MODE)[keyof typeof CHILD_CONTEXT_MODE];

export function isChildContextMode(value: UnparsedWireValue): value is ChildContextMode {
  return value === CHILD_CONTEXT_MODE.ISOLATED || value === CHILD_CONTEXT_MODE.FORK;
}

/** What happens to a child's conversation once it has completed. */
export const CHILD_CLEANUP = {
  /** Kept, and archived after the retention delay. */
  KEEP: "keep",
  /** Archived as soon as the completion is recorded. */
  DELETE: "delete",
} as const;

export type ChildCleanup = (typeof CHILD_CLEANUP)[keyof typeof CHILD_CLEANUP];

export function isChildCleanup(value: UnparsedWireValue): value is ChildCleanup {
  return value === CHILD_CLEANUP.KEEP || value === CHILD_CLEANUP.DELETE;
}

/**
 * Where a child stands. Accepted is the spawn recorded and acknowledged;
 * running is the child's turn under way; the terminal statuses say how it
 * ended. Unknown is the honest end of a child whose run a relaunch found
 * unfinished and could not resume: what it did before is what its journal
 * kept, and nothing is repeated to find out.
 */
export const CHILD_RUN_STATUS = {
  ACCEPTED: "accepted",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
} as const;

export type ChildRunStatus = (typeof CHILD_RUN_STATUS)[keyof typeof CHILD_RUN_STATUS];

const CHILD_RUN_TERMINAL_STATUS: ReadonlySet<ChildRunStatus> = new Set([
  CHILD_RUN_STATUS.COMPLETED,
  CHILD_RUN_STATUS.FAILED,
  CHILD_RUN_STATUS.TIMED_OUT,
  CHILD_RUN_STATUS.CANCELLED,
  CHILD_RUN_STATUS.UNKNOWN,
]);

export function isTerminalChildRunStatus(status: ChildRunStatus): boolean {
  return CHILD_RUN_TERMINAL_STATUS.has(status);
}

/** The effective tool policy a child ran under, as metadata on its record: names, never schemas. */
export interface ChildPolicyMetadata {
  readonly allowed: readonly string[];
  readonly denied: readonly string[];
}

/**
 * One spawn as the store keeps it. The requester is the conversation and
 * the run that asked; the child is the conversation and run that answer.
 * The completion destination is the requester's conversation unless the
 * spawn named another, and it is where the completion is delivered, whether
 * or not the requester's run still stands.
 */
export interface ChildRunRecord {
  readonly childId: string;
  readonly agentId: AgentId;
  readonly requesterSessionKey: SessionKey;
  readonly requesterRunId?: string;
  readonly childSessionKey: SessionKey;
  readonly childRunId: string;
  readonly task: string;
  readonly label?: string;
  /** How many spawns deep this child is: a conversation's direct child is 1. */
  readonly depth: number;
  readonly model?: string;
  readonly requestedContext: ChildContextMode;
  /** The context the child actually started with; isolated when a requested fork exceeded the cap. */
  readonly context: ChildContextMode;
  readonly contextNote?: string;
  readonly policy: ChildPolicyMetadata;
  /** Zero is no child-specific deadline, the default. */
  readonly timeoutMs: number;
  readonly cleanup: ChildCleanup;
  readonly completionDestination: SessionKey;
  /** Whether the requester is owed a completion at all; false for fire-and-forget children. */
  readonly expectsCompletion: boolean;
  readonly status: ChildRunStatus;
  readonly acceptedAt: number;
  readonly startedAt?: number;
  readonly settledAt?: number;
  /** The child's final visible reply, for a completed child. */
  readonly resultText?: string;
  readonly failureDetail?: string;
  readonly performedActions?: number;
  readonly unknownActions?: number;
  readonly archivedAt?: number;
}

/**
 * Where a completion's delivery stands. Pending is recorded and not yet
 * handed over; delivered is the requester's conversation having taken it;
 * blocked is the retry window spent with the result still owed, retained
 * for the operator; dismissed is a blocked result let go of on purpose.
 */
export const COMPLETION_DELIVERY_STATUS = {
  PENDING: "pending",
  DELIVERED: "delivered",
  BLOCKED: "blocked",
  DISMISSED: "dismissed",
  /** The child expected no completion handoff; nothing is owed. */
  NOT_REQUIRED: "not_required",
} as const;

type CompletionDeliveryStatus =
  (typeof COMPLETION_DELIVERY_STATUS)[keyof typeof COMPLETION_DELIVERY_STATUS];

/**
 * One child's completion, persisted independently of its delivery. Its id
 * is stable — one per child — so the requester's conversation can tell a
 * retry from a second completion and take the same one once.
 */
export interface ChildCompletionRecord {
  readonly completionId: string;
  readonly childId: string;
  readonly destination: SessionKey;
  readonly status: ChildRunStatus;
  readonly resultText?: string;
  readonly failureDetail?: string;
  readonly createdAt: number;
  readonly delivery: CompletionDeliveryStatus;
  readonly attempts: number;
  readonly firstAttemptAt?: number;
  readonly nextAttemptAt?: number;
  readonly deliveredAt?: number;
  readonly blockedAt?: number;
  readonly lastError?: string;
}

/**
 * What a spawn hands back once the record is durable: the child's actual
 * identifiers, the model it resolved to, and the context it actually
 * started with. Acceptance is not completion; the completion arrives in the
 * requester's conversation on its own.
 */
export interface ChildSpawnReceipt {
  readonly childId: string;
  readonly childSessionKey: SessionKey;
  readonly childRunId: string;
  readonly model?: string;
  readonly context: ChildContextMode;
  readonly contextNote?: string;
  readonly depth: number;
}
