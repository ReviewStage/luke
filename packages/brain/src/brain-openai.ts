import {
  isRecord,
  isWireString,
  text,
  type UnparsedWireValue,
  type WireRecord,
  wholeNumber,
} from "@sidecar/wire";
import type { BrainToolWireDefinition } from "./brain-tools.js";

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

export const RESPONSES_ITEM_TYPE = {
  MESSAGE: "message",
  FUNCTION_CALL: "function_call",
  FUNCTION_CALL_OUTPUT: "function_call_output",
  REASONING: "reasoning",
  COMPACTION: "compaction",
} as const;

const RESPONSES_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

const RESPONSES_CONTENT_TYPE = {
  INPUT_TEXT: "input_text",
  OUTPUT_TEXT: "output_text",
} as const;

const RESPONSES_TOOL_CHOICE_AUTO = "auto";
const RESPONSES_CONTEXT_MANAGEMENT_COMPACTION = "compaction";
const RESPONSES_INCLUDE_ENCRYPTED_REASONING = "reasoning.encrypted_content";

export const BRAIN_REASONING_EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export type BrainReasoningEffort =
  (typeof BRAIN_REASONING_EFFORT)[keyof typeof BRAIN_REASONING_EFFORT];

export interface BrainResponsesOptions {
  model: string;
  instructions: string;
  tools: readonly BrainToolWireDefinition[];
  maximumOutputTokens: number;
  reasoningEffort: BrainReasoningEffort;
}

/**
 * Builds the Responses request body one brain turn is run with. Compaction is
 * asked for with no threshold of this build's, so the API's own default
 * decides when the memory is folded, and reasoning items come back encrypted
 * so the memory can carry them without the API storing anything.
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
    context_management: [{ type: RESPONSES_CONTEXT_MANAGEMENT_COMPACTION }],
    max_output_tokens: options.maximumOutputTokens,
  };
}

export type BrainResponsesRequest = ReturnType<typeof brainResponsesRequest>;

/** A message the brain is handed, as the input array carries it. */
export function userMessageItem(text: string): ResponsesInputItem {
  return {
    type: RESPONSES_ITEM_TYPE.MESSAGE,
    role: RESPONSES_MESSAGE_ROLE.USER,
    content: [{ type: RESPONSES_CONTENT_TYPE.INPUT_TEXT, text }],
  };
}

/** The answer to one function call, keyed by the call the model made. */
export function functionCallOutputItem(callId: string, output: string): ResponsesInputItem {
  return {
    type: RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
    call_id: callId,
    output,
  };
}

/** Whether an input item is a compaction item, the one kind the memory reads the type of. */
export function isCompactionItem(item: ResponsesInputItem): boolean {
  return item.type === RESPONSES_ITEM_TYPE.COMPACTION;
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
      entry.type === RESPONSES_CONTENT_TYPE.OUTPUT_TEXT &&
      isWireString(entry.text)
        ? entry.text
        : "",
    )
    .join("");
}

function functionCallFromItem(item: WireRecord): BrainFunctionCall | undefined {
  if (item.type !== RESPONSES_ITEM_TYPE.FUNCTION_CALL) return undefined;
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
      item.type === RESPONSES_ITEM_TYPE.MESSAGE &&
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
