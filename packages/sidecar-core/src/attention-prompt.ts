import { type AttentionUpdate, maximumAttentionSummaryLength } from "./attention";
import { ATTENTION_TUNING_EXAMPLES, type AttentionTuningExample } from "./attention-examples";
import { ATTENTION_DISPOSITION } from "./session";

const NONE_LABEL = "none";

const ATTENTION_INSTRUCTION_LINES: readonly string[] = [
  "You decide whether a background companion should speak about one coding-agent session update.",
  "The developer is working, and every sentence you approve interrupts them.",
  "",
  "Choose one disposition:",
  `- ${ATTENTION_DISPOSITION.SILENT}: say nothing. This is the correct answer for most updates.`,
  `- ${ATTENTION_DISPOSITION.SPEAK_DURING_TURN}: interrupt now, only when the session cannot progress until the developer acts.`,
  `- ${ATTENTION_DISPOSITION.SPEAK_AT_TURN_END}: wait for a natural pause, then report a session that reached a resting point.`,
  "",
  "Rules:",
  "- Default to silence when the update is routine, ambiguous, or merely continues work already underway.",
  `- A speaking summary is one short spoken sentence under ${maximumAttentionSummaryLength} characters that names the provider and the workspace.`,
  "- Use null for the summary whenever the disposition is silent.",
  "- Use only the fields in the update. You never receive transcripts, file contents, or command output, so never imply you read any.",
  "- Never guess what the session is doing beyond the status it reports.",
];

function renderExample(example: AttentionTuningExample): string {
  return [
    "",
    `# ${example.name}`,
    attentionUpdateInput(example.update),
    `Decision: ${JSON.stringify(example.expected)}`,
    `Why: ${example.rationale}`,
  ].join("\n");
}

/** Renders one bounded update as the only session material a model receives. */
export function attentionUpdateInput(update: AttentionUpdate): string {
  return [
    `Provider: ${update.providerName}`,
    `Session: ${update.title}`,
    `Trigger: ${update.trigger}`,
    `Previous status: ${update.previousStatus ?? NONE_LABEL}`,
    `Status: ${update.status}`,
    `Observed summary: ${update.summary ?? NONE_LABEL}`,
  ].join("\n");
}

/**
 * Builds the standing instructions, including the redacted examples that tune
 * how conservative Luke is. Pass a different example set to try alternative
 * tuning without changing the decision contract.
 */
export function attentionInstructions(
  examples: readonly AttentionTuningExample[] = ATTENTION_TUNING_EXAMPLES,
): string {
  return [...ATTENTION_INSTRUCTION_LINES, "", "Examples:", ...examples.map(renderExample)].join(
    "\n",
  );
}
