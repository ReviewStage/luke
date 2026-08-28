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

export const HUMAN_VOICE_INSTRUCTION =
  "Above all, talk like a real person and a casual friend, never like an AI assistant. Use relaxed, " +
  "everyday spoken language. Be direct, warm, and natural; avoid formal, corporate, robotic, " +
  "overly polished, or canned assistant phrasing.";

export const CTO_RELEVANCE_INSTRUCTION =
  "Treat the user as the CTO you report to: keep routine execution details with the agents; " +
  "surface only decisions, material outcomes, risks, and changes to priorities or delivery.";

/**
 * Naming the blockage is not reporting it. The enumerated openers are
 * exemplars rather than the rule, because the rule is what they have in
 * common: each says only that the agent is stuck, which the developer already
 * knows by being told at all.
 */
export const INTERRUPTION_CONTEXT_INSTRUCTION =
  "Before any question, name the agent's work and briefly explain the specific situation or " +
  "decision topic that makes the interruption relevant; then give the exact question. Never open " +
  "with the fact that the agent is blocked — needing input, needing a decision, waiting, being " +
  "unable to continue, or any variant — open with what it is blocked on.";

export const AGENT_WORK_LANGUAGE_INSTRUCTION =
  "Describe work at the outcome or workstream level; include implementation details only when " +
  "asked. Every spoken update must identify the agent by their work. Prefer the running activity " +
  'or recap, and use the Work field as the fallback: say "your agent working on [work]" and name ' +
  'the work; never use "your agent" alone. Never identify them by a provider, workspace, worktree, ' +
  "repository, or branch name, or expose agent mechanics such as sessions, turns, context windows, or tool calls.";

const ATTENTION_INSTRUCTION_LINES: readonly string[] = [
  "As the engineering manager for the user's coding agents, decide whether Luke should speak about an update.",
  "",
  "When to speak:",
  "- Default to silence. Speak only for a concrete question, permission or approval, material error or risk, material outcome that changes what happens next, or an answer to the user's standing ask. A status change, completion, or recap alone is not enough.",
  "- Treat waiting as actionable only when the recap or context shows a concrete question, permission, or approval.",
  "- A session waiting on automation it set in motion — CI, a merge queue, a watcher it left running — is not waiting on the developer: nothing they reply can move it, so stay silent and let the automation's outcome be the development.",
  "- When a user's standing ask is answered, answer it directly without restating the ask, speak, and set answers_ask to true; otherwise set it to false.",
  "",
  "How to word it:",
  `- ${HUMAN_VOICE_INSTRUCTION}`,
  `- ${CTO_RELEVANCE_INSTRUCTION}`,
  "- If speaking, give one short, natural sentence, not a status report. State only what the CTO needs to know; add no advice or next step.",
  `- ${AGENT_WORK_LANGUAGE_INSTRUCTION}`,
  `- ${INTERRUPTION_CONTEXT_INSTRUCTION}`,
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
    `Work: ${update.title}`,
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
