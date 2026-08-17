import { ATTENTION_DECISION_SCHEMA, ATTENTION_DECISION_SCHEMA_NAME } from "./attention.js";
import {
  type AttentionPromptUpdate,
  attentionInstructions,
  attentionUpdateInput,
} from "./attention-prompt.js";
import { isRecord, text } from "./json.js";

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

/** Builds the Responses request body one bounded update is reviewed with. */
export function attentionResponsesRequest(
  update: AttentionPromptUpdate,
  options: AttentionResponsesOptions,
) {
  return {
    model: options.model,
    instructions: attentionInstructions(),
    input: attentionUpdateInput(update),
    max_output_tokens: options.maximumOutputTokens,
    // The update is reviewed and discarded; the API is never asked to keep it.
    store: false,
    text: {
      format: {
        type: RESPONSES_TEXT_FORMAT_TYPE,
        name: ATTENTION_DECISION_SCHEMA_NAME,
        schema: ATTENTION_DECISION_SCHEMA,
        strict: true,
      },
    },
  };
}

function outputTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) =>
      isRecord(entry) && entry.type === RESPONSES_OUTPUT_TEXT_TYPE && typeof entry.text === "string"
        ? entry.text
        : "",
    )
    .join("");
}

/**
 * Reads the structured decision out of a Responses payload without depending on
 * where a given API version places it.
 */
export function attentionResponsesOutputText(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.output_text === "string") return text(payload.output_text);
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
export function attentionResponsesMissingReason(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : undefined;
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  if (status && reason) return ` (${status}: ${reason})`;
  if (status) return ` (${status})`;
  return "";
}
