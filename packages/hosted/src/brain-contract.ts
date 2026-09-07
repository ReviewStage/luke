import {
  isReasoningEffort,
  REASONING_EFFORT,
  type ReasoningEffort,
} from "@sidecar/runtime-contracts";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  wholeNumber,
} from "@sidecar/wire";
import {
  admitBrainInput,
  maximumHostedBrainInputItems,
  maximumHostedBrainRequestBytes,
} from "./responses-input.js";

/**
 * The second hosted brain contract. The first carried the input array and an
 * authority, and the service derived everything else from its build; this
 * one lets the desktop prepare the prompt and name the tools, because the
 * prompt is meant to be composed on the desktop from now on and the toolset
 * is meant to be chosen by a policy there. What the service still fixes is
 * everything a caller could abuse: the model, the upstream, the credential,
 * the refusal to store, the catalog of tool schemas a name may select, and
 * every bound below. A tool travels as its registered name and nothing more,
 * so a caller can never upload a schema; the prompt travels as bounded text
 * with an explicit refusal past the bound, never a truncation. Every request
 * names the contract it speaks, and the service answers its capabilities on
 * request so a desktop can refuse to run against a service that lacks them
 * rather than falling back to the older shape.
 */

export const HOSTED_BRAIN_CONTRACT_VERSION = 2;

export const HOSTED_BRAIN_OPERATION = {
  RESPOND: "respond",
  COUNT_TOKENS: "count-tokens",
  COMPACT: "compact",
} as const;

export type HostedBrainOperation =
  (typeof HOSTED_BRAIN_OPERATION)[keyof typeof HOSTED_BRAIN_OPERATION];

const HOSTED_BRAIN_OPERATION_LIST: readonly string[] = Object.values(HOSTED_BRAIN_OPERATION);

/**
 * The prepared prompt's own envelope. It is not the bootstrap-file budget a
 * workspace will later be held to — fixed instructions and dynamic sections
 * ride on top of those files — but the whole prepared prompt as one string:
 * 200,000 characters, at most 600 KiB as UTF-8, which leaves the 2 MiB body
 * bound room for the input array beside it. A prompt past it is refused with
 * its own error on both ends; nothing is cut.
 */
export const HOSTED_BRAIN_PROMPT_BOUNDS = {
  MAXIMUM_CHARS: 200_000,
} as const;

export const HOSTED_BRAIN_TOOL_BOUNDS = {
  MAXIMUM_TOOLS: 64,
  MAXIMUM_NAME_CHARS: 64,
} as const;

/** What the service fixes for one inference, as the desktop may ask within it. */
export const HOSTED_BRAIN_OPTION_BOUNDS = {
  MAXIMUM_OUTPUT_TOKENS: 16_000,
} as const;

export interface HostedBrainBounds {
  promptChars: number;
  inputItems: number;
  requestBytes: number;
  maximumOutputTokens: number;
}

/** What the service answers about itself, so a desktop can decide before it sends anything. */
export interface HostedBrainCapabilities {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  model: string;
  operations: readonly HostedBrainOperation[];
  /** The registered tool names a request may select schemas by. */
  tools: readonly string[];
  bounds: HostedBrainBounds;
  reasoningEfforts: readonly ReasoningEffort[];
}

export function hostedBrainBounds(): HostedBrainBounds {
  return {
    promptChars: HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS,
    inputItems: maximumHostedBrainInputItems,
    requestBytes: maximumHostedBrainRequestBytes,
    maximumOutputTokens: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS,
  };
}

/** A count or bound as the contract takes it: a safe integer above zero, never a fraction or a sign. */
function positiveWhole(value: UnparsedWireValue): number | undefined {
  const parsed = wholeNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeWhole(value: UnparsedWireValue): number | undefined {
  const parsed = wholeNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function textList(value: UnparsedWireValue, maximum: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const names: string[] = [];
  for (const entry of value) {
    if (!isWireString(entry) || entry.length === 0) return undefined;
    names.push(entry);
  }
  return names;
}

export function hostedBrainCapabilitiesFromWire(
  value: UnparsedWireValue,
): HostedBrainCapabilities | undefined {
  if (!isRecord(value) || value.contract !== HOSTED_BRAIN_CONTRACT_VERSION) return undefined;
  const model = isWireString(value.model) && value.model.length > 0 ? value.model : undefined;
  if (!model) return undefined;
  const operations = textList(value.operations, HOSTED_BRAIN_OPERATION_LIST.length);
  if (!operations?.every((name) => HOSTED_BRAIN_OPERATION_LIST.includes(name))) {
    return undefined;
  }
  const tools = textList(value.tools, HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS);
  if (!tools) return undefined;
  if (!isRecord(value.bounds)) return undefined;
  const promptChars = positiveWhole(value.bounds.promptChars);
  const inputItems = positiveWhole(value.bounds.inputItems);
  const requestBytes = positiveWhole(value.bounds.requestBytes);
  const maximumOutputTokens = positiveWhole(value.bounds.maximumOutputTokens);
  if (!promptChars || !inputItems || !requestBytes || !maximumOutputTokens) return undefined;
  const efforts = textList(value.reasoningEfforts, Object.values(REASONING_EFFORT).length);
  if (!efforts?.every(isReasoningEffort)) return undefined;
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model,
    // SAFETY: every member was checked against the operation list above.
    operations: operations as HostedBrainOperation[],
    tools,
    bounds: { promptChars, inputItems, requestBytes, maximumOutputTokens },
    // SAFETY: every member passed isReasoningEffort above.
    reasoningEfforts: efforts as ReasoningEffort[],
  };
}

export interface HostedBrainRequestOptions {
  maximumOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

export interface HostedBrainRespondRequest {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  prompt: string;
  tools: readonly string[];
  options: HostedBrainRequestOptions;
  input: readonly WireRecord[];
}

export interface HostedBrainCountTokensRequest {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  prompt: string;
  tools: readonly string[];
  input: readonly WireRecord[];
}

export interface HostedBrainCompactRequest {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  prompt: string;
  input: readonly WireRecord[];
}

/** Why a v2 request was refused, so the desktop can say the same thing the service does. */
export const HOSTED_BRAIN_REQUEST_REFUSAL = {
  MALFORMED: "malformed",
  PROMPT_TOO_LARGE: "prompt-too-large",
  UNKNOWN_TOOL: "unknown-tool",
  OPTIONS_OUT_OF_BOUNDS: "options-out-of-bounds",
} as const;

export type HostedBrainRequestRefusal =
  (typeof HOSTED_BRAIN_REQUEST_REFUSAL)[keyof typeof HOSTED_BRAIN_REQUEST_REFUSAL];

export type HostedBrainRequestRead<Request> =
  | { ok: true; request: Request }
  | { ok: false; refusal: HostedBrainRequestRefusal };

function refused<Request>(refusal: HostedBrainRequestRefusal): HostedBrainRequestRead<Request> {
  return { ok: false, refusal };
}

function keysExactly(value: WireRecord, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => key in value);
}

type FieldRead<Value> =
  | { ok: true; value: Value }
  | { ok: false; refusal: HostedBrainRequestRefusal };

function refusedField<Value>(refusal: HostedBrainRequestRefusal): FieldRead<Value> {
  return { ok: false, refusal };
}

/** The prompt as sent, or the refusal it earns: absent or non-text is malformed, too long is its own word. */
function promptRead(value: UnparsedWireValue): FieldRead<string> {
  if (!isWireString(value)) return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  if (value.length > HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS) {
    return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE);
  }
  return { ok: true, value };
}

/** Registered names only: each within its length, unique, and known to the catalog given. */
function toolsRead(
  value: UnparsedWireValue,
  catalog: ReadonlySet<string>,
): FieldRead<readonly string[]> {
  const names = textList(value, HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS);
  if (!names) return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  if (names.some((name) => name.length > HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_NAME_CHARS)) {
    return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  if (new Set(names).size !== names.length) {
    return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  if (names.some((name) => !catalog.has(name))) {
    return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.UNKNOWN_TOOL);
  }
  return { ok: true, value: names };
}

function optionsRead(value: UnparsedWireValue): FieldRead<HostedBrainRequestOptions> {
  if (!isRecord(value)) return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  const allowed = Object.keys(value).every(
    (key) => key === "maximumOutputTokens" || key === "reasoningEffort",
  );
  if (!allowed) return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  const options: HostedBrainRequestOptions = {};
  if (value.maximumOutputTokens !== undefined) {
    const tokens = positiveWhole(value.maximumOutputTokens);
    if (tokens === undefined) return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    if (tokens > HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS) {
      return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
    }
    options.maximumOutputTokens = tokens;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) {
      return refusedField(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    options.reasoningEffort = value.reasoningEffort;
  }
  return { ok: true, value: options };
}

const RESPOND_KEYS = ["contract", "prompt", "tools", "options", "input"] as const;
const COUNT_TOKENS_KEYS = ["contract", "prompt", "tools", "input"] as const;
const COMPACT_KEYS = ["contract", "prompt", "input"] as const;

/**
 * Reads a respond request against the tool catalog the reader is given — the
 * service's registered names, or the capabilities a desktop fetched — so a
 * request naming a tool the other side does not know is refused before it
 * costs anything. The same reader runs on both ends.
 */
export function hostedBrainRespondRequestFromWire(
  value: UnparsedWireValue,
  catalog: ReadonlySet<string>,
): HostedBrainRequestRead<HostedBrainRespondRequest> {
  if (!isRecord(value) || !keysExactly(value, RESPOND_KEYS)) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  if (value.contract !== HOSTED_BRAIN_CONTRACT_VERSION) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  const prompt = promptRead(value.prompt);
  if (!prompt.ok) return refused(prompt.refusal);
  const tools = toolsRead(value.tools, catalog);
  if (!tools.ok) return refused(tools.refusal);
  const options = optionsRead(value.options);
  if (!options.ok) return refused(options.refusal);
  const input = admitBrainInput(value.input);
  if (!input) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  return {
    ok: true,
    request: {
      contract: HOSTED_BRAIN_CONTRACT_VERSION,
      prompt: prompt.value,
      tools: tools.value,
      options: options.value,
      input,
    },
  };
}

export function hostedBrainCountTokensRequestFromWire(
  value: UnparsedWireValue,
  catalog: ReadonlySet<string>,
): HostedBrainRequestRead<HostedBrainCountTokensRequest> {
  if (!isRecord(value) || !keysExactly(value, COUNT_TOKENS_KEYS)) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  if (value.contract !== HOSTED_BRAIN_CONTRACT_VERSION) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  const prompt = promptRead(value.prompt);
  if (!prompt.ok) return refused(prompt.refusal);
  const tools = toolsRead(value.tools, catalog);
  if (!tools.ok) return refused(tools.refusal);
  const input = admitBrainInput(value.input);
  if (!input) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  return {
    ok: true,
    request: {
      contract: HOSTED_BRAIN_CONTRACT_VERSION,
      prompt: prompt.value,
      tools: tools.value,
      input,
    },
  };
}

export function hostedBrainCompactRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainCompactRequest> {
  if (!isRecord(value) || !keysExactly(value, COMPACT_KEYS)) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  if (value.contract !== HOSTED_BRAIN_CONTRACT_VERSION) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  const prompt = promptRead(value.prompt);
  if (!prompt.ok) return refused(prompt.refusal);
  const input = admitBrainInput(value.input);
  if (!input) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  return {
    ok: true,
    request: { contract: HOSTED_BRAIN_CONTRACT_VERSION, prompt: prompt.value, input },
  };
}

export interface HostedBrainCountTokensAnswer {
  inputTokens: number;
}

export function hostedBrainCountTokensAnswerFromWire(
  value: UnparsedWireValue,
): HostedBrainCountTokensAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = nonNegativeWhole(value.inputTokens);
  return inputTokens === undefined ? undefined : { inputTokens };
}
