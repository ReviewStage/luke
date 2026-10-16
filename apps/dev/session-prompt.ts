import type { SandboxRecord } from "@luke/service/agents/agent-runtime/sandbox";
import type { CoderSessionPromptRecord } from "@luke/service/agents/coder-host/host";
import { NO_NOTES_TAKEN, type NotesTaken } from "@luke/service/agents/coder-host/plan-edit";
import { defineState } from "eve/context";

/**
 * The session's prompt as its content address, and the facts it was
 * composed on (`CoderSessionPromptRecord`), in eve's durable session state: written by
 * the instructions resolver that composes the prompt at the session's start
 * and read by the store hook as each turn starts, so the turn row names the
 * prompt the model reads rather than one composed again.
 */
export const sessionPrompt = defineState<CoderSessionPromptRecord>("luke.coder.prompt", () => ({}));

/** What the session's sandbox has been told, in eve's durable session state (`packages/service/src/agents/agent-runtime/sandbox.ts`). */
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
 * (`packages/service/src/agents/coder-host/plan-edit.ts`): the tool reads it before saving
 * and counts what was taken once saved.
 */
export const planNotesTaken = defineState<NotesTaken>(
  "luke.coder.plan-notes",
  () => NO_NOTES_TAKEN,
);
