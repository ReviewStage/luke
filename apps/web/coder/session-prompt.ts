import { defineState } from "eve/context";
import type { SessionPromptRecord } from "../server/hosted/brain-host/host.js";
import { NO_NOTES_TAKEN, type NotesTaken } from "../server/hosted/coder-host/plan-edit.js";

/**
 * The session's prompt as its content address, in eve's durable session
 * state: written by the instructions resolver that composes the prompt at
 * the session's start and read by the store hook as each turn starts, so the
 * turn row names the prompt the model reads rather than one composed again.
 */
export const sessionPrompt = defineState<SessionPromptRecord>("luke.coder.prompt", () => ({}));

/**
 * What the session's sandbox has been told, in eve's durable session state:
 * whether a sandbox tool has run, which is when a sandbox stands to be
 * stopped at the turn's end, and when the repository credential at its
 * firewall was last set, which is when it is next renewed.
 */
export interface SandboxRecord {
  /** The instant the first sandbox tool of the session was called, which is when the sandbox opened and the checkout set its credential. */
  readonly openedAt?: number;
  /** The instant the store hook last renewed the credential at the firewall. */
  readonly credentialAt?: number;
}

export const sandboxRecord = defineState<SandboxRecord>("luke.coder.sandbox", () => ({}));

/**
 * What a worker's session knows of the delegation it runs: eve's id for the
 * agent's call that started it, in the worker's own durable state. Every
 * hook is handed the session's lineage and a resolver none, so the worker's
 * hook pins the call here as the session starts and the model resolver
 * reads it at every step (`subagents/worker/`).
 */
export interface DelegationRecord {
  readonly parentCallId?: string;
}

export const delegationRecord = defineState<DelegationRecord>("luke.coder.delegation", () => ({}));

/**
 * How many notes the turn under way has taken on the plan, in eve's durable
 * session state, which is what holds a turn to its cap
 * (`server/hosted/coder-host/plan-edit.ts`): the tool reads it before saving
 * and counts what was taken once saved.
 */
export const planNotesTaken = defineState<NotesTaken>(
  "luke.coder.plan-notes",
  () => NO_NOTES_TAKEN,
);
