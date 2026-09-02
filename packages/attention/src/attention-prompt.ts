import {
  boundedText,
  maximumSessionDetailLength,
  maximumSessionRecapExcerptLength,
  maximumSessionTitleLength,
  SESSION_STATUS,
  type SessionStatus,
} from "@sidecar/session";
import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";
import { ATTENTION_TRIGGER, type AttentionContext, type AttentionTrigger } from "./attention.js";

const NONE_LABEL = "none";

const ATTENTION_INSTRUCTION_LINES: readonly string[] = [
  "As the engineering manager for the user's coding agents, decide whether Luke should speak about an update.",
  "",
  "When to speak:",
  "- Default to silence. Speak only for a concrete question, permission or approval, material error or risk, or material outcome that changes what happens next. A status change, completion, or recap alone is not enough.",
  "- Treat waiting as actionable only when the recap or context shows a concrete question, permission, or approval.",
  "- A session waiting on automation it set in motion — CI, a merge queue, a watcher it left running — is not waiting on the developer: nothing they reply can move it, so stay silent and let the automation's outcome be the development.",
  "",
  "What you return:",
  "- A judgment, and no words at all. You do not write what Luke says; his voice does that, from the same fields you are reading. Return only the disposition.",
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
}

/** Renders one bounded update as the only session material a model receives. */
export function attentionUpdateInput(update: AttentionPromptUpdate): string {
  return [
    `Provider: ${update.providerName}`,
    `Trigger: ${update.trigger}`,
    `Previous status: ${update.previousStatus ?? NONE_LABEL}`,
    `Status: ${update.status}`,
    `Work: ${update.title}`,
    `Repository: ${update.context?.repository ?? NONE_LABEL}`,
    `Branch: ${update.context?.branch ?? NONE_LABEL}`,
    `Running: ${update.context?.activity ?? NONE_LABEL}`,
    `Error: ${update.context?.error ?? NONE_LABEL}`,
    `Work recap: ${update.recap ?? NONE_LABEL}`,
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
 * down to the fields the prompt reads, each held to the bound an update may
 * carry it at: the roster's own bound for most, the recap's narrower excerpt
 * bound for the one field the roster retains longer. A value set is checked
 * against the set itself, a malformed field refuses the whole update rather
 * than being repaired.
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
  // The excerpt bound, not the roster's: an update's recap is cut to the
  // excerpt before it may leave a machine, so a longer one here is not an
  // update this build produced.
  const recap = optionalWireText(value.recap, maximumSessionRecapExcerptLength);
  if (!workspace.valid || !recap.valid) return undefined;

  if (value.context !== undefined && !isRecord(value.context)) return undefined;
  const contextRecord = isRecord(value.context) ? value.context : {};
  const repository = optionalWireText(contextRecord.repository, maximumSessionDetailLength);
  const branch = optionalWireText(contextRecord.branch, maximumSessionDetailLength);
  const activity = optionalWireText(contextRecord.activity, maximumSessionDetailLength);
  const error = optionalWireText(contextRecord.error, maximumSessionDetailLength);
  if (!repository.valid || !branch.valid || !activity.valid || !error.valid) return undefined;

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
  return update;
}
