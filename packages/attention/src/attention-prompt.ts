import {
  boundedText,
  maximumSessionDetailLength,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  SESSION_STATUS,
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";
import {
  ATTENTION_TRIGGER,
  type AttentionContext,
  type AttentionTrigger,
  attentionRequestText,
} from "./attention.js";

const NONE_LABEL = "none";

const ATTENTION_INSTRUCTION_LINES: readonly string[] = [
  "Decide whether Luke should speak about an update from one of the developer's coding agents.",
  "- When speaking, make the summary natural and conversational, not a formal status report.",
  "- When the agent asks a concrete question, summarize the question directly. Do not preface it by saying the agent needs input, needs a decision, is waiting, or cannot continue; the question already makes that clear.",
  '- Speak naturally about the agent as the person doing the work, identifying them only from the running activity or work recap. When a label is needed, use "your agent," not teammate. Never use the provider title, session name, workspace or worktree name, repository, or branch to refer to them. If the work is not clear, say what happened without naming it. Never use agent mechanics such as session, turn, context window, or tool call in the summary, and never tell the developer to inspect or manage the agent themselves; state only what they need to know.',
  "- Default to silence when the update is routine, ambiguous, or merely continues work already underway.",
  "- A session waiting on automation it set in motion — CI, a merge queue, a watcher it left running — is not waiting on the developer: nothing they reply can move it, so stay silent and let the automation's outcome be the development.",
  "- A waiting status means the turn has stopped, not that the developer must reply. Speak only when the recap or context shows the session cannot continue without them — a question, a permission, or an approval. A settled turn that merely leaves the next prompt to them is silence.",
  "- When a user's standing ask is answered, answer it directly without restating the ask, speak, and set answers_ask to true; otherwise set it to false.",
];

/**
 * The fields of an update that enter the evaluator's prompt, and nothing else.
 * `AttentionUpdate` satisfies this structurally; the narrowing exists so a
 * hosted review can be asked with exactly what the prompt reads — a session's
 * identifiers and clock never need to travel, because they never enter the
 * rendered input.
 */
export interface AttentionPromptUpdate {
  trigger: AttentionTrigger;
  providerName: string;
  title: string;
  workspace?: string;
  status: SessionStatus;
  previousStatus?: SessionStatus;
  recap?: string;
  context?: AttentionContext;
  noticeRequest?: string;
}

/** Renders one bounded update as the only session material a model receives. */
export function attentionUpdateInput(update: AttentionPromptUpdate): string {
  return [
    `Provider: ${update.providerName}`,
    `Trigger: ${update.trigger}`,
    `Previous status: ${update.previousStatus ?? NONE_LABEL}`,
    `Status: ${update.status}`,
    `Repository: ${update.context?.repository ?? NONE_LABEL}`,
    `Branch: ${update.context?.branch ?? NONE_LABEL}`,
    `Running: ${update.context?.activity ?? NONE_LABEL}`,
    `Error: ${update.context?.error ?? NONE_LABEL}`,
    `Work recap: ${update.recap ?? NONE_LABEL}`,
    `Developer's ask: ${update.noticeRequest ?? NONE_LABEL}`,
  ].join("\n");
}

/**
 * Builds the standing instructions for the attention evaluator.
 */
export function attentionInstructions(): string {
  return ATTENTION_INSTRUCTION_LINES.join("\n");
}

const SESSION_STATUS_VALUES: readonly SessionStatus[] = Object.values(SESSION_STATUS);
const ATTENTION_TRIGGER_VALUES: readonly AttentionTrigger[] = Object.values(ATTENTION_TRIGGER);

function isListedSessionStatus(value: UnparsedWireValue): value is SessionStatus {
  if (!isWireString(value)) return false;
  // SAFETY: value is a string; list membership is the session-status vocabulary contract check.
  return SESSION_STATUS_VALUES.includes(value as SessionStatus);
}

function sessionStatusFromWire(value: UnparsedWireValue): SessionStatus | undefined {
  return isListedSessionStatus(value) ? value : undefined;
}

function isListedAttentionTrigger(value: UnparsedWireValue): value is AttentionTrigger {
  if (!isWireString(value)) return false;
  // SAFETY: value is a string; list membership is the attention-trigger vocabulary contract check.
  return ATTENTION_TRIGGER_VALUES.includes(value as AttentionTrigger);
}

function attentionTriggerFromWire(value: UnparsedWireValue): AttentionTrigger | undefined {
  return isListedAttentionTrigger(value) ? value : undefined;
}

type OptionalWireTextResult = { valid: boolean; text?: string };

/**
 * An optional wire field: absent is fine, a string is trimmed and cut to the
 * same bound the local surface holds it to, and anything else marks the whole
 * update malformed rather than being repaired into silence.
 */
function optionalWireText(value: UnparsedWireValue, maximumLength: number): OptionalWireTextResult {
  if (value === undefined) return { valid: true };
  if (!isWireString(value)) return { valid: false };
  const bounded = boundedText(value, maximumLength);
  if (!bounded) return { valid: true };
  return { valid: true, text: bounded };
}

/**
 * Validates an update arriving as untrusted JSON — a hosted review request —
 * down to the fields the prompt reads, each held to the same bound the local
 * roster holds it to. A value set is checked against the set itself, a
 * malformed field refuses the whole update rather than being repaired, and the
 * developer's ask is refused outright when it fails the registry's own rule,
 * because a cut ask asks for something its author did not.
 */
export function attentionPromptUpdateFromWire(
  value: UnparsedWireValue,
): AttentionPromptUpdate | undefined {
  if (!isRecord(value)) return undefined;

  const trigger = attentionTriggerFromWire(value.trigger);
  const status = sessionStatusFromWire(value.status);
  const providerName = boundedText(text(value.providerName), maximumSessionTitleLength);
  const title = boundedText(text(value.title), maximumSessionTitleLength);
  if (!trigger || !status || !providerName || !title) return undefined;

  const previousStatus =
    value.previousStatus === undefined ? undefined : sessionStatusFromWire(value.previousStatus);
  if (value.previousStatus !== undefined && !previousStatus) return undefined;

  const workspace = optionalWireText(value.workspace, maximumSessionTitleLength);
  const recap = optionalWireText(value.recap, maximumSessionRecapLength);
  if (!workspace.valid || !recap.valid) return undefined;

  if (value.context !== undefined && !isRecord(value.context)) return undefined;
  const contextRecord = isRecord(value.context) ? value.context : {};
  const repository = optionalWireText(contextRecord.repository, maximumSessionDetailLength);
  const branch = optionalWireText(contextRecord.branch, maximumSessionDetailLength);
  const activity = optionalWireText(contextRecord.activity, maximumSessionDetailLength);
  const error = optionalWireText(contextRecord.error, maximumSessionDetailLength);
  if (!repository.valid || !branch.valid || !activity.valid || !error.valid) return undefined;

  const noticeRequest =
    value.noticeRequest === undefined ? undefined : attentionRequestText(value.noticeRequest);
  if (value.noticeRequest !== undefined && !noticeRequest) return undefined;

  const context: AttentionContext = {};
  if (repository.text) context.repository = repository.text;
  if (branch.text) context.branch = branch.text;
  if (activity.text) context.activity = activity.text;
  if (error.text) context.error = error.text;

  const update: AttentionPromptUpdate = {
    trigger,
    providerName,
    title,
    status,
  };
  if (workspace.text) update.workspace = workspace.text;
  if (previousStatus) update.previousStatus = previousStatus;
  if (recap.text) update.recap = recap.text;
  if (Object.keys(context).length > 0) update.context = context;
  if (noticeRequest) update.noticeRequest = noticeRequest;
  return update;
}
