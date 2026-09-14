import type { WireRecord } from "@sidecar/wire";
import type { ChildSpawnReceipt } from "./child-records.js";

/**
 * What a delegation answers, in the words the brain's session tools read back
 * to the model: a spawn accepted with its receipt or refused with a named
 * reason, a cancellation that ended every named child or says which did not,
 * and the requester's context as a fork offers it. The service that once
 * carried a delegation from spawn to delivery, ported from OpenClaw
 * `b7528507`'s sub-agent service, went with the Mac-side brain (LUKE-206);
 * the hosted brain host answers this vocabulary from its own seams.
 */

/** The requester's active context, offered for a fork: the items and their estimated size. */
export interface ForkSnapshot {
  readonly items: readonly WireRecord[];
  readonly estimatedTokens: number;
}

export const CHILD_SPAWN_REFUSAL = {
  EMPTY_TASK: "empty_task",
  DEPTH_CAP: "depth_cap",
  REQUESTER_LIMIT: "requester_limit",
  GLOBAL_LIMIT: "global_limit",
  BLOCKED_COMPLETIONS: "blocked_completions",
  FORK_OTHER_AGENT: "fork_other_agent",
  PERSISTENCE: "persistence",
  STOPPED: "stopped",
} as const;

export type ChildSpawnRefusal = (typeof CHILD_SPAWN_REFUSAL)[keyof typeof CHILD_SPAWN_REFUSAL];

export type ChildSpawnOutcome =
  | { readonly accepted: true; readonly receipt: ChildSpawnReceipt }
  | { readonly accepted: false; readonly reason: ChildSpawnRefusal; readonly detail?: string };

/** What a cancellation amounted to: every named child ended, or the ones that did not. */
export interface ChildCancellation {
  readonly ok: boolean;
  readonly remaining: readonly string[];
}
