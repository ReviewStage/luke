import type { ActToolDefinition } from "@sidecar/acts";
import {
  RESPONSES_CONTENT_PART_TYPE,
  RESPONSES_INPUT_ITEM_TYPE,
  RESPONSES_MESSAGE_ROLE,
} from "@sidecar/hosted";
import { RESPONSES_ITEM_FORMAT as ITEM_FORMAT } from "@sidecar/runtime";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelResponse,
  type ModelUsage,
  type ToolSchema,
} from "@sidecar/runtime/vocabulary";
import {
  isRecord,
  isWireNumber,
  isWireString,
  numberVectors,
  text,
  type UnparsedWireValue,
  type WireRecord,
  wholeNumber,
  wireRecord,
} from "@sidecar/wire";

/**
 * The one OpenAI Responses request a brain turn may be, and the one reading of
 * its answer. Built here once so the keyed client and the hosted service send
 * the same shape: instructions, tools, the refusal to store, and server-side
 * compaction are fixed by the build, and only the input array varies.
 *
 * Item shapes follow the Responses API reference as it stands today. A
 * `function_call` output carries `call_id`, `name`, and `arguments` (a JSON
 * string); its answer is a `function_call_output` carrying the same `call_id`
 * and a string `output`. A `reasoning` item carries `encrypted_content` when
 * `store` is false, and a `compaction` item carries `type: "compaction"` and
 * its own `encrypted_content`. Every output item is appended to the input
 * array verbatim, because a reasoning model run statelessly must see its own
 * reasoning items replayed beside the function calls they preceded.
 */

export const BRAIN_RESPONSES_PATH = "/responses";

/**
 * One item of the brain's input array. The brain never reads inside an item it
 * did not build itself — reasoning and compaction items are opaque, and even a
 * message it wrote is replayed rather than re-read — so an item is a record
 * and nothing narrower.
 */
export type ResponsesInputItem = WireRecord;

const RESPONSES_TOOL_CHOICE_AUTO = "auto";
const RESPONSES_INCLUDE_ENCRYPTED_REASONING = "reasoning.encrypted_content";

export const BRAIN_REASONING_EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export type BrainReasoningEffort =
  (typeof BRAIN_REASONING_EFFORT)[keyof typeof BRAIN_REASONING_EFFORT];

/** A function tool built from a contract schema, whose parameters travel as they were declared. */
export interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: WireRecord;
}

/** A function tool as the Responses request carries it: the acts table's own row, or a contract schema wrapped. */
export type ResponsesFunctionTool = ActToolDefinition | ResponsesToolDefinition;

export interface BrainResponsesOptions {
  model: string;
  instructions: string;
  tools: readonly ResponsesFunctionTool[];
  maximumOutputTokens: number;
  reasoningEffort: BrainReasoningEffort;
}

/**
 * Builds the Responses request body one brain turn is run with. No automatic
 * compaction is asked of the API: the host schedules compaction itself, so
 * two policies never compete over one window, and an explicit compaction is
 * a request of its own. Reasoning items come back encrypted so the memory
 * can carry them without the API storing anything.
 */
export function brainResponsesRequest(
  input: readonly ResponsesInputItem[],
  options: BrainResponsesOptions,
) {
  return {
    model: options.model,
    instructions: options.instructions,
    input,
    tools: options.tools,
    tool_choice: RESPONSES_TOOL_CHOICE_AUTO,
    parallel_tool_calls: true,
    store: false,
    include: [RESPONSES_INCLUDE_ENCRYPTED_REASONING],
    reasoning: { effort: options.reasoningEffort },
    max_output_tokens: options.maximumOutputTokens,
  };
}

export type BrainResponsesRequest = ReturnType<typeof brainResponsesRequest>;

/** A message the brain is handed, as the input array carries it. */
export function userMessageItem(text: string): ResponsesInputItem {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: RESPONSES_MESSAGE_ROLE.USER,
    content: [{ type: RESPONSES_CONTENT_PART_TYPE.INPUT_TEXT, text }],
  };
}

/** The answer to one function call, keyed by the call the model made. */
export function functionCallOutputItem(callId: string, output: string): ResponsesInputItem {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    call_id: callId,
    output,
  };
}

/** Whether an input item is a compaction item, one of the two kinds the memory reads the type of. */
export function isCompactionItem(item: ResponsesInputItem): boolean {
  return item.type === RESPONSES_INPUT_ITEM_TYPE.COMPACTION;
}

/** Whether an input item is a user message, the boundary a local fold may cut at. */
export function isUserMessageItem(item: ResponsesInputItem): boolean {
  return (
    item.type === RESPONSES_INPUT_ITEM_TYPE.MESSAGE && item.role === RESPONSES_MESSAGE_ROLE.USER
  );
}

export interface BrainFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

/**
 * One Responses answer read down to what a turn acts on: every output item
 * verbatim for the memory, the function calls to dispatch, the text the model
 * wrote, whether a compaction item arrived, and the input size the API
 * counted, which is the one honest measure of how large the memory really is.
 */
export interface BrainResponsesOutput {
  items: readonly ResponsesInputItem[];
  functionCalls: readonly BrainFunctionCall[];
  outputText: string;
  compacted: boolean;
  inputTokens?: number;
  status?: string;
  incompleteReason?: string;
}

function outputTextFromContent(content: UnparsedWireValue): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) =>
      isRecord(entry) &&
      entry.type === RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT &&
      isWireString(entry.text)
        ? entry.text
        : "",
    )
    .join("");
}

function functionCallFromItem(item: WireRecord): BrainFunctionCall | undefined {
  if (item.type !== RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL) return undefined;
  const callId = text(item.call_id);
  const name = text(item.name);
  if (!callId || !name) return undefined;
  return {
    callId,
    name,
    argumentsJson: isWireString(item.arguments) ? item.arguments : "{}",
  };
}

/** Reads a Responses payload, or nothing when it carries no output array at all. */
export function brainResponsesOutput(payload: UnparsedWireValue): BrainResponsesOutput | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  const items: ResponsesInputItem[] = [];
  const functionCalls: BrainFunctionCall[] = [];
  const texts: string[] = [];
  let compacted = false;
  for (const item of payload.output) {
    if (!isRecord(item)) continue;
    items.push(item);
    if (isCompactionItem(item)) compacted = true;
    const call = functionCallFromItem(item);
    if (call) functionCalls.push(call);
    if (
      item.type === RESPONSES_INPUT_ITEM_TYPE.MESSAGE &&
      item.role === RESPONSES_MESSAGE_ROLE.ASSISTANT
    ) {
      texts.push(outputTextFromContent(item.content));
    }
  }
  const usage = isRecord(payload.usage) ? payload.usage : undefined;
  const inputTokens = usage ? wholeNumber(usage.input_tokens) : undefined;
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : undefined;
  const status = text(payload.status);
  const incompleteReason = details ? text(details.reason) : undefined;
  return {
    items,
    functionCalls,
    outputText: texts.join("").trim(),
    compacted,
    ...(inputTokens !== undefined ? { inputTokens } : undefined),
    ...(status ? { status } : undefined),
    ...(incompleteReason ? { incompleteReason } : undefined),
  };
}

/**
 * The provider item format the brain's checkpoints are in, as this file's
 * callers spell it. The identity itself is `@sidecar/runtime`'s, so the
 * format the built-ins declare and the format a checkpoint is stamped with
 * are one literal.
 */
export const RESPONSES_ITEM_FORMAT = {
  FORMAT: ITEM_FORMAT.format,
  VERSION: ITEM_FORMAT.version,
} as const;

export const BRAIN_RESPONSES_COMPACT_PATH = "/responses/compact";
export const BRAIN_RESPONSES_INPUT_TOKENS_PATH = "/responses/input_tokens";

/** A tool as the brain's contracts carry it, as the Responses API takes it: a function tool. */
export function responsesToolDefinition(schema: ToolSchema): ResponsesToolDefinition {
  return {
    type: "function",
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
  };
}

/** A tool as the acts table or the brain defines it, in the brain's contract shape. */
export function toolSchemaFromDefinition(definition: ActToolDefinition): ToolSchema {
  // SAFETY: the parameters are a JSON-schema object built from literals; a JSON round trip is its wire form.
  const parameters = wireRecord(
    JSON.parse(JSON.stringify(definition.parameters)) as UnparsedWireValue,
  );
  return {
    name: definition.name,
    description: definition.description,
    parameters: parameters ?? {},
  };
}

/** The explicit compaction request: the model and the window to fold, and the same instructions the window was built under. */
export function brainCompactRequest(
  input: readonly ResponsesInputItem[],
  options: Pick<BrainResponsesOptions, "model" | "instructions">,
) {
  return { model: options.model, instructions: options.instructions, input };
}

export type BrainCompactRequest = ReturnType<typeof brainCompactRequest>;

/** The token count request: everything one inference would carry except the output budget. */
export function brainInputTokensRequest(
  input: readonly ResponsesInputItem[],
  options: Pick<BrainResponsesOptions, "model" | "instructions" | "tools">,
) {
  return { model: options.model, instructions: options.instructions, tools: options.tools, input };
}

export type BrainInputTokensRequest = ReturnType<typeof brainInputTokensRequest>;

/** OpenAI's embeddings endpoint, the one call the notebook index makes on a key. */
export const BRAIN_EMBEDDINGS_PATH = "/embeddings";

/** The embedding model the notebook index runs on by default; a build-fixed choice, not a request field. */
export const BRAIN_EMBEDDING_MODEL = "text-embedding-3-small";

/** The embeddings request: the texts and the model, and no retention asked for. */
export function brainEmbeddingsRequest(texts: readonly string[], options: { model: string }) {
  return { model: options.model, input: texts, encoding_format: "float" };
}

export type BrainEmbeddingsRequest = ReturnType<typeof brainEmbeddingsRequest>;

/**
 * The vectors an embeddings answer carries, in the order of the texts sent,
 * or nothing for a payload of any other shape or a vector of another width.
 */
export function embeddingsVectors(
  payload: UnparsedWireValue | undefined,
): { model: string; vectors: number[][] } | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;
  const model = isWireString(payload.model) && payload.model.length > 0 ? payload.model : undefined;
  if (!model) return undefined;
  const indexed: { index: number; embedding: UnparsedWireValue }[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry) || !isWireNumber(entry.index)) return undefined;
    indexed.push({ index: entry.index, embedding: entry.embedding });
  }
  indexed.sort((a, b) => a.index - b.index);
  const vectors = numberVectors(indexed.map((entry) => entry.embedding));
  return vectors ? { model, vectors } : undefined;
}

/** The states a Responses object may be in; only two carry a reply. */
export const RESPONSES_STATUS = {
  COMPLETED: "completed",
  INCOMPLETE: "incomplete",
  FAILED: "failed",
  CANCELLED: "cancelled",
  IN_PROGRESS: "in_progress",
  QUEUED: "queued",
} as const;

/**
 * One Responses answer as the brain's contracts carry it: the output items
 * verbatim for the context engine, the text, the tool calls, the usage, and
 * whether the provider folded the context or stopped short. An HTTP success
 * is not a reply: a response the provider itself marks failed, cancelled, or
 * still under way is a provider failure with the provider's own code, and
 * never a completed answer with no words. A payload with no output array is
 * not a Responses answer at all and reads as nothing.
 */
export function responsesModelAnswer(payload: UnparsedWireValue): ModelResponse | undefined {
  const output = brainResponsesOutput(payload);
  if (!output) return undefined;
  if (
    output.status !== undefined &&
    output.status !== RESPONSES_STATUS.COMPLETED &&
    output.status !== RESPONSES_STATUS.INCOMPLETE
  ) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
    const code = error ? text(error.code) : undefined;
    return {
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: code ? `response ${output.status}: ${code}` : `response ${output.status}`,
    };
  }
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : undefined;
  const outputTokens = usage ? wholeNumber(usage.output_tokens) : undefined;
  const modelUsage: ModelUsage = {
    ...(output.inputTokens !== undefined ? { inputTokens: output.inputTokens } : undefined),
    ...(outputTokens !== undefined ? { outputTokens } : undefined),
  };
  return {
    outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
    items: output.items,
    text: output.outputText,
    toolCalls: output.functionCalls,
    ...(usage ? { usage: modelUsage } : undefined),
    compacted: output.compacted,
    ...(output.incompleteReason
      ? {
          incomplete: {
            reason: output.incompleteReason,
            ...(output.status ? { status: output.status } : undefined),
          },
        }
      : undefined),
  };
}

/** The compacted window an explicit compaction answered, or nothing when the payload carries none. */
export function responsesCompactedWindow(
  payload: UnparsedWireValue,
): readonly ResponsesInputItem[] | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  const items: ResponsesInputItem[] = [];
  for (const item of payload.output) {
    if (!isRecord(item)) return undefined;
    items.push(item);
  }
  return items;
}

/** The count a token-count answer carries — a non-negative safe integer — or nothing. */
export function responsesInputTokens(payload: UnparsedWireValue): number | undefined {
  const count = isRecord(payload) ? wholeNumber(payload.input_tokens) : undefined;
  return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}
