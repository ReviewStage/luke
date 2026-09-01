import { ATTENTION_DISPOSITION, type AttentionDisposition } from "@sidecar/session";
import { isRecord, isWireString, text, type UnparsedWireValue } from "@sidecar/wire";
import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  attentionDecisionFromModel,
  DISPOSITION_GUIDANCE,
} from "./attention.js";
import {
  type AttentionPromptUpdate,
  attentionInstructions,
  attentionUpdateInput,
} from "./attention-prompt.js";
import { LUKE_PERSONA } from "./persona.js";

/**
 * The one OpenAI Responses request an attention review may be. The desktop
 * evaluator sends it on the developer's own key and the hosted endpoint sends
 * it on Luke's, so it is built here once: the instructions, the decision
 * schema, and the refusal to store are fixed by the build on both paths, and
 * only the bounded update varies between two requests.
 */

export const ATTENTION_RESPONSES_PATH = "/responses";

const RESPONSES_TEXT_FORMAT_TYPE = "json_schema";
const RESPONSES_OUTPUT_TEXT_TYPE = "output_text";

export interface AttentionResponsesOptions {
  model: string;
  maximumOutputTokens: number;
}

const LEGACY_SUMMARY_LENGTH = 180;
const LEGACY_ATTENTION_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["disposition", "summary"],
  properties: {
    disposition: {
      type: "string",
      enum: Object.values(ATTENTION_DISPOSITION),
      description: Object.values(ATTENTION_DISPOSITION)
        .map((disposition) => `${disposition}: ${DISPOSITION_GUIDANCE[disposition]}`)
        .join(" "),
    },
    summary: {
      type: ["string", "null"],
      description: `One short spoken sentence under ${LEGACY_SUMMARY_LENGTH} characters, or null when the disposition is silent.`,
    },
  },
};

const LEGACY_ATTENTION_INSTRUCTIONS = attentionInstructions().replace(
  /What you return:[\s\S]*$/u,
  `How to word it:\n- If speaking, write the sentence Luke says, in Luke's own voice as it is described below. State what the CTO needs to know and stop; add no advice and no next step.\n\n${LUKE_PERSONA}`,
);

export interface LegacyAttentionDecision {
  disposition: AttentionDisposition;
  decidedAt: number;
  summary?: string;
}

function responsesRequest(
  update: AttentionPromptUpdate,
  options: AttentionResponsesOptions,
  instructions: string,
  schema: typeof ATTENTION_DECISION_SCHEMA | typeof LEGACY_ATTENTION_DECISION_SCHEMA,
) {
  return {
    model: options.model,
    instructions,
    input: attentionUpdateInput(update),
    max_output_tokens: options.maximumOutputTokens,
    store: false,
    text: {
      format: {
        type: RESPONSES_TEXT_FORMAT_TYPE,
        name: ATTENTION_DECISION_SCHEMA_NAME,
        schema,
        strict: true,
      },
    },
  };
}

/** Builds the Responses request body one bounded update is reviewed with. */
export function attentionResponsesRequest(
  update: AttentionPromptUpdate,
  options: AttentionResponsesOptions,
) {
  return responsesRequest(update, options, attentionInstructions(), ATTENTION_DECISION_SCHEMA);
}

/** Builds the summary-bearing response older desktop clients still require. */
export function legacyAttentionResponsesRequest(
  update: AttentionPromptUpdate,
  options: AttentionResponsesOptions,
) {
  return responsesRequest(
    update,
    options,
    LEGACY_ATTENTION_INSTRUCTIONS,
    LEGACY_ATTENTION_DECISION_SCHEMA,
  );
}

/** Validates the legacy summary-bearing decision without widening the current contract. */
export function legacyAttentionDecisionFromModel(
  value: UnparsedWireValue,
  decidedAt: number,
): LegacyAttentionDecision | undefined {
  if (!isRecord(value)) return undefined;
  const decision = attentionDecisionFromModel(value, decidedAt);
  if (!decision) return undefined;
  const summary = text(value.summary)?.slice(0, LEGACY_SUMMARY_LENGTH);
  if (decision.disposition !== ATTENTION_DISPOSITION.SILENT && !summary) return undefined;
  return { ...decision, ...(summary ? { summary } : undefined) };
}

function outputTextFromContent(content: UnparsedWireValue): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) =>
      isRecord(entry) && entry.type === RESPONSES_OUTPUT_TEXT_TYPE && isWireString(entry.text)
        ? entry.text
        : "",
    )
    .join("");
}

/**
 * Reads the structured decision out of a Responses payload without depending on
 * where a given API version places it.
 */
export function attentionResponsesOutputText(payload: UnparsedWireValue): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (isWireString(payload.output_text)) return text(payload.output_text);
  if (!Array.isArray(payload.output)) return undefined;
  return text(
    payload.output
      .map((item) => (isRecord(item) ? outputTextFromContent(item.content) : ""))
      .join(""),
  );
}

/**
 * Describes why a payload carried no decision. A model that spends its output
 * budget on reasoning returns `incomplete` with empty output, which would
 * otherwise look identical to a healthy silent pass.
 */
export function attentionResponsesMissingReason(payload: UnparsedWireValue): string {
  if (!isRecord(payload)) return "";
  const status = text(payload.status);
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : undefined;
  const reason = details ? text(details.reason) : undefined;
  if (status && reason) return ` (${status}: ${reason})`;
  if (status) return ` (${status})`;
  return "";
}
