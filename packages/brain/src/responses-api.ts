import type { ActionToolDefinition } from "@sidecar/actions";
import {
  RESPONSES_CONTENT_PART_TYPE,
  RESPONSES_INPUT_ITEM_TYPE,
  RESPONSES_MESSAGE_ROLE,
} from "@sidecar/hosted";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelResponse,
  type ModelUsage,
  type ReasoningSummary,
  type ToolSchema,
} from "@sidecar/runtime/vocabulary";
import { joinReplyMessages } from "@sidecar/session";
import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
  wholeNumber,
  wireRecord,
} from "@sidecar/wire";

/**
 * The one OpenAI Responses request a brain turn may be, and the one reading of
 * its answer. Built here once so the keyed client and the hosted service send
 * the same shape: instructions, tools, and the reasoning summary are fixed by
 * the build, and only the input array varies. The request leaves OpenAI's
 * `store` at its default, so each response stands with OpenAI under its own
 * retention and is named back by its id, which the run keeps; the brain
 * still replays its context itself and never reads a stored response back.
 *
 * Item shapes follow the Responses API reference as it stands today. A
 * `function_call` output carries `call_id`, `name`, and `arguments` (a JSON
 * string); its answer is a `function_call_output` carrying the same `call_id`
 * and a string `output`. A `reasoning` item carries `encrypted_content`
 * because the request asks for it, and a `summary` in words because the
 * request asks for that too. Every output item is appended to the input
 * array verbatim, because a reasoning model run statelessly must see its own
 * reasoning items replayed beside the function calls they preceded.
 */

export const BRAIN_RESPONSES_PATH = "/responses";

/**
 * One item of the brain's input array. The brain never reads inside an item it
 * did not build itself — a reasoning item is opaque, and even a message it
 * wrote is replayed rather than re-read — so an item is a record and nothing
 * narrower.
 */
export type ResponsesInputItem = WireRecord;

const RESPONSES_TOOL_CHOICE_AUTO = "auto";
const RESPONSES_INCLUDE_ENCRYPTED_REASONING = "reasoning.encrypted_content";

/** How much of its reasoning the model is asked to put into words beside each opaque reasoning item. */
export const BRAIN_REASONING_SUMMARY = "detailed";

export const BRAIN_REASONING_EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

type BrainReasoningEffort = (typeof BRAIN_REASONING_EFFORT)[keyof typeof BRAIN_REASONING_EFFORT];

/** A function tool built from a contract schema, whose parameters travel as they were declared. */
export interface ResponsesToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: WireRecord;
}

/** A function tool as the Responses request carries it: the actions table's own row, or a contract schema wrapped. */
export type ResponsesFunctionTool = ActionToolDefinition | ResponsesToolDefinition;

export interface BrainResponsesOptions {
  model: string;
  instructions: string;
  tools: readonly ResponsesFunctionTool[];
  maximumOutputTokens: number;
  reasoningEffort: BrainReasoningEffort;
  /**
   * Which prefix cache the turn's own request should land against: a routing
   * hint, separate from the response id OpenAI stores the answer under, and
   * never an identifier of anything — the host hashes what it names before it
   * travels.
   */
  promptCacheKey?: string;
}

/**
 * Builds the Responses request body one brain turn is run with. No compaction
 * is asked of the API: the brain folds its own context behind a summary, so
 * no provider policy competes with its own over one window. Reasoning items
 * come back encrypted so the memory can replay them itself, and summarized
 * so the record can say in words what the model was reasoning about.
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
    include: [RESPONSES_INCLUDE_ENCRYPTED_REASONING],
    reasoning: { effort: options.reasoningEffort, summary: BRAIN_REASONING_SUMMARY },
    max_output_tokens: options.maximumOutputTokens,
    ...(options.promptCacheKey !== undefined
      ? { prompt_cache_key: options.promptCacheKey }
      : undefined),
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

/** Words in Luke's own voice, as the input array carries them: a fold's summary standing in for the items it replaced. */
export function assistantMessageItem(text: string): ResponsesInputItem {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: RESPONSES_MESSAGE_ROLE.ASSISTANT,
    content: [{ type: RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT, text }],
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

/** Whether an input item is a user message, the boundary a fold may cut at. */
export function isUserMessageItem(item: ResponsesInputItem): boolean {
  return (
    item.type === RESPONSES_INPUT_ITEM_TYPE.MESSAGE && item.role === RESPONSES_MESSAGE_ROLE.USER
  );
}

interface BrainFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

/**
 * One Responses answer read down to what a turn acts on: every output item
 * verbatim for the memory, the function calls to dispatch, the text the model
 * wrote, the reasoning summaries in words, the input size the API counted,
 * which is the one honest measure of how large the memory really is, and the
 * id OpenAI stored the response under.
 */
export interface BrainResponsesOutput {
  items: readonly ResponsesInputItem[];
  functionCalls: readonly BrainFunctionCall[];
  outputText: string;
  reasoning: readonly ReasoningSummary[];
  inputTokens?: number;
  responseId?: string;
  status?: string;
  incompleteReason?: string;
}

/** The text of each part of one fixed type, in order, a part of any other shape reading as empty. */
function partTexts(parts: UnparsedWireValue, type: string): string[] {
  if (!Array.isArray(parts)) return [];
  return parts.map((part) =>
    isRecord(part) && part.type === type && isWireString(part.text) ? part.text : "",
  );
}

function outputTextFromContent(content: UnparsedWireValue): string {
  return partTexts(content, RESPONSES_CONTENT_PART_TYPE.OUTPUT_TEXT).join("");
}

/**
 * A reasoning item's summary in words, or nothing for an item that is not a
 * reasoning item or carries no words: the parts are joined as paragraphs, the
 * item's `encrypted_content` is lifted beside them for a replay to carry and
 * read for nothing else, and the item rides along whole.
 */
function reasoningSummaryFromItem(item: WireRecord): ReasoningSummary | undefined {
  if (item.type !== RESPONSES_INPUT_ITEM_TYPE.REASONING) return undefined;
  const itemId = text(item.id);
  if (!itemId) return undefined;
  const summary = joinReplyMessages(
    partTexts(item.summary, RESPONSES_CONTENT_PART_TYPE.SUMMARY_TEXT),
  );
  if (summary.length === 0) return undefined;
  const encryptedContent = text(item.encrypted_content);
  return {
    itemId,
    summary,
    ...(encryptedContent ? { encryptedContent } : undefined),
    item,
  };
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
  const reasoning: ReasoningSummary[] = [];
  const texts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item)) continue;
    items.push(item);
    const call = functionCallFromItem(item);
    if (call) functionCalls.push(call);
    const summary = reasoningSummaryFromItem(item);
    if (summary) reasoning.push(summary);
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
  const responseId = text(payload.id);
  const incompleteReason = details ? text(details.reason) : undefined;
  return {
    items,
    functionCalls,
    outputText: joinReplyMessages(texts),
    reasoning,
    ...(inputTokens !== undefined ? { inputTokens } : undefined),
    ...(responseId ? { responseId } : undefined),
    ...(status ? { status } : undefined),
    ...(incompleteReason ? { incompleteReason } : undefined),
  };
}

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

/** A tool as the actions table or the brain defines it, in the brain's contract shape. */
export function toolSchemaFromDefinition(definition: ActionToolDefinition): ToolSchema {
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

/** The token count request: everything one inference would carry except the output budget. */
export function brainInputTokensRequest(
  input: readonly ResponsesInputItem[],
  options: Pick<BrainResponsesOptions, "model" | "instructions" | "tools">,
) {
  return { model: options.model, instructions: options.instructions, tools: options.tools, input };
}

export type BrainInputTokensRequest = ReturnType<typeof brainInputTokensRequest>;

/** The states a Responses object may be in; only two carry a reply. */
const RESPONSES_STATUS = {
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
 * whether the model stopped short. An HTTP success
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
  const inputDetails =
    usage && isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  const cachedInputTokens = inputDetails ? wholeNumber(inputDetails.cached_tokens) : undefined;
  const outputDetails =
    usage && isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined;
  const reasoningTokens = outputDetails ? wholeNumber(outputDetails.reasoning_tokens) : undefined;
  const modelUsage: ModelUsage = {
    ...(output.inputTokens !== undefined ? { inputTokens: output.inputTokens } : undefined),
    ...(outputTokens !== undefined ? { outputTokens } : undefined),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : undefined),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : undefined),
  };
  return {
    outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
    items: output.items,
    text: output.outputText,
    toolCalls: output.functionCalls,
    ...(usage ? { usage: modelUsage } : undefined),
    ...(output.responseId !== undefined ? { responseId: output.responseId } : undefined),
    ...(output.reasoning.length > 0 ? { reasoning: output.reasoning } : undefined),
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

/** The count a token-count answer carries — a non-negative safe integer — or nothing. */
export function responsesInputTokens(payload: UnparsedWireValue): number | undefined {
  const count = isRecord(payload) ? wholeNumber(payload.input_tokens) : undefined;
  return count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}
