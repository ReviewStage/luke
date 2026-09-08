import {
  isReasoningEffort,
  REASONING_EFFORT,
  type ReasoningEffort,
} from "@sidecar/runtime-contracts";
import {
  isRecord,
  isWireString,
  numberVectors,
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
  /** Embeddings for the notebook index: texts in, one vector each out, under the model the service fixes. */
  EMBED: "embed",
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

/** How much one embed request may carry: a sync's batch of notebook chunks, never a transcript. */
export const HOSTED_BRAIN_EMBED_BOUNDS = {
  MAXIMUM_TEXTS: 64,
  MAXIMUM_TEXT_CHARS: 8_000,
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

export interface HostedBrainEmbedRequest {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  texts: readonly string[];
}

/** What the service answers an embed with: the model it used, its width, and one vector per text in order. */
export interface HostedBrainEmbedAnswer {
  model: string;
  dimensions: number;
  vectors: readonly (readonly number[])[];
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

type FieldRead<Value> = (value: UnparsedWireValue) => HostedBrainRequestRead<Value>;

type FieldTable = Record<string, FieldRead<unknown>>;

type ReadFields<Fields extends FieldTable> = {
  [Key in keyof Fields]: Fields[Key] extends FieldRead<infer Value> ? Value : never;
};

/**
 * One reader over a table of fields: a request is a record carrying exactly
 * the contract version and the table's keys, each admitted by its own reader
 * in the table's order, and refused whole at the first field that refuses.
 */
function requestReader<Fields extends FieldTable>(
  fields: Fields,
): (
  value: UnparsedWireValue,
) => HostedBrainRequestRead<
  { contract: typeof HOSTED_BRAIN_CONTRACT_VERSION } & ReadFields<Fields>
> {
  const keys = ["contract", ...Object.keys(fields)];
  return (value) => {
    if (!isRecord(value) || !keysExactly(value, keys)) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    if (value.contract !== HOSTED_BRAIN_CONTRACT_VERSION) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    const read: Partial<ReadFields<Fields>> = {};
    for (const [key, reader] of Object.entries(fields)) {
      const field = reader(value[key]);
      if (!field.ok) return refused(field.refusal);
      // SAFETY: Object.entries walks the table's own keys, and each reader is the one ReadFields types its key by.
      read[key as keyof Fields] = field.request as ReadFields<Fields>[keyof Fields];
    }
    return {
      ok: true,
      // SAFETY: every key of the table was read by the reader that types it above.
      request: { contract: HOSTED_BRAIN_CONTRACT_VERSION, ...read } as {
        contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
      } & ReadFields<Fields>,
    };
  };
}

/** The prompt as sent, or the refusal it earns: absent or non-text is malformed, too long is its own word. */
const promptRead: FieldRead<string> = (value) => {
  if (!isWireString(value)) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  if (value.length > HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE);
  }
  return { ok: true, request: value };
};

/** Registered names only: each within its length, unique, and known to the catalog given. */
function toolsRead(catalog: ReadonlySet<string>): FieldRead<readonly string[]> {
  return (value) => {
    const names = textList(value, HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS);
    if (!names) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    if (names.some((name) => name.length > HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_NAME_CHARS)) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    if (new Set(names).size !== names.length) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    if (names.some((name) => !catalog.has(name))) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.UNKNOWN_TOOL);
    }
    return { ok: true, request: names };
  };
}

const optionsRead: FieldRead<HostedBrainRequestOptions> = (value) => {
  if (!isRecord(value)) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  const allowed = Object.keys(value).every(
    (key) => key === "maximumOutputTokens" || key === "reasoningEffort",
  );
  if (!allowed) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  const options: HostedBrainRequestOptions = {};
  if (value.maximumOutputTokens !== undefined) {
    const tokens = positiveWhole(value.maximumOutputTokens);
    if (tokens === undefined) return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    if (tokens > HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
    }
    options.maximumOutputTokens = tokens;
  }
  if (value.reasoningEffort !== undefined) {
    if (!isReasoningEffort(value.reasoningEffort)) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    options.reasoningEffort = value.reasoningEffort;
  }
  return { ok: true, request: options };
};

const inputRead: FieldRead<readonly WireRecord[]> = (value) => {
  const input = admitBrainInput(value);
  return input ? { ok: true, request: input } : refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
};

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
  return requestReader({
    prompt: promptRead,
    tools: toolsRead(catalog),
    options: optionsRead,
    input: inputRead,
  })(value);
}

export function hostedBrainCountTokensRequestFromWire(
  value: UnparsedWireValue,
  catalog: ReadonlySet<string>,
): HostedBrainRequestRead<HostedBrainCountTokensRequest> {
  return requestReader({ prompt: promptRead, tools: toolsRead(catalog), input: inputRead })(value);
}

export function hostedBrainCompactRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainCompactRequest> {
  return requestReader({ prompt: promptRead, input: inputRead })(value);
}

/** The texts to embed: each non-empty and within its bound, the batch within its count. */
const textsRead: FieldRead<readonly string[]> = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
  }
  if (value.length > HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS) {
    return refused(HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
  }
  const texts: string[] = [];
  for (const entry of value) {
    if (!isWireString(entry) || entry.trim().length === 0) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED);
    }
    if (entry.length > HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXT_CHARS) {
      return refused(HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS);
    }
    texts.push(entry);
  }
  return { ok: true, request: texts };
};

export function hostedBrainEmbedRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainEmbedRequest> {
  return requestReader({ texts: textsRead })(value);
}

export function hostedBrainEmbedAnswerFromWire(
  value: UnparsedWireValue,
): HostedBrainEmbedAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const model = isWireString(value.model) && value.model.length > 0 ? value.model : undefined;
  const dimensions = positiveWhole(value.dimensions);
  if (!model || !dimensions) return undefined;
  const vectors = numberVectors(value.vectors, dimensions);
  return vectors ? { model, dimensions, vectors } : undefined;
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
