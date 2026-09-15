import type { ChildSpawnReceipt } from "./child-records.js";

/**
 * What a delegation answers, in the words the brain's session tools read back
 * to the model: a spawn accepted with its receipt or refused with a named
 * reason, and a cancellation that ended every named child or says which did
 * not. The hosted brain host answers this vocabulary from its own seams.
 */

export const CHILD_SPAWN_REFUSAL = {
  EMPTY_TASK: "empty_task",
  DEPTH_CAP: "depth_cap",
  REQUESTER_LIMIT: "requester_limit",
  GLOBAL_LIMIT: "global_limit",
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
