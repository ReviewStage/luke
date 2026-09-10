import type { ActionOutputEnvelope, ValidatedAction } from "@sidecar/actions";
import type { Session, SessionIdentity } from "@sidecar/session";
import type { ActionAdmissionReads } from "./tools/action-tools.js";
import type { ToolContext } from "./tools/tool-module.js";

/**
 * The roster as the host renders it, with the identities every tool argument
 * is validated against, and the sessions themselves for the scheduled look to
 * choose which transcripts to read.
 */
export interface BrainRoster {
  text: string;
  identities: readonly SessionIdentity[];
  sessions?: readonly Session[];
}

/**
 * The standing a turn hands an action with each call: which conversation,
 * turn, and run it belongs to and who opened it — attribution, so
 * Conversation can say whether the developer asked for the action or Luke
 * took it on his own judgment — and whether the turn still stands. Admission
 * and the performer each ask `isRevoked()` after every step they awaited and
 * once more just before the effect, so an action prepared inside a turn that
 * has since ended is refused rather than dispatched; the signal fires the
 * moment the standing is revoked, so a read awaited before the effect
 * settles at once, while an effect already dispatched is awaited for its
 * result whatever the signal says. Whether the action may run at all was
 * decided by the tool policy before the call reached its module.
 */
export type BrainActionExecution = ToolContext;

/**
 * The host's two halves of carrying an action, which the action tool's own
 * `execute` joins with `admit()` between them: the readers admission
 * consults for an execution, and the carrier, which takes only what
 * admission minted and answers in the one envelope every action tool shares —
 * the status, the target as the roster held it at execution, and the session
 * a creation named. The host never sees a call before admission has read it.
 */
export interface BrainActionPerformer {
  admission(execution: BrainActionExecution): ActionAdmissionReads;
  carry(action: ValidatedAction, execution: BrainActionExecution): Promise<ActionOutputEnvelope>;
}
