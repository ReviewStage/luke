import { REASONING_EFFORT, type ReasoningEffort } from "@sidecar/runtime/vocabulary";
import {
  isWireString,
  RECORD_EXTRA_KEYS,
  SCHEMA_REFUSAL,
  type Schema,
  type SchemaPath,
  type SchemaRefusal,
  s,
  TEXT_ENDS,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import {
  admitBrainInput,
  maximumHostedBrainInputItems,
  maximumHostedBrainRequestBytes,
} from "./responses-input.js";

/**
 * The hosted brain contract. The desktop prepares the prompt and names the
 * tools, because the prompt is composed on the desktop and the toolset is
 * chosen by a policy there. What the service fixes is everything a caller
 * could abuse: the model, the upstream, the credential, the refusal to store,
 * the catalog of tool schemas a name may select, and every bound below. A
 * tool travels as its registered name and nothing more, so a caller can never
 * upload a schema; the prompt travels as bounded text with an explicit
 * refusal past the bound, never a truncation. Every request names the
 * contract it speaks, and the service answers its capabilities on request so
 * a desktop can refuse to run against a service that lacks them.
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

const HOSTED_BRAIN_OPERATION_NAMES = Object.values(HOSTED_BRAIN_OPERATION);

const REASONING_EFFORT_NAMES = Object.values(REASONING_EFFORT);

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

export const hostedBrainCapabilitiesSchema: Schema<HostedBrainCapabilities> = s.record(
  {
    contract: s.literal(HOSTED_BRAIN_CONTRACT_VERSION),
    model: s.text({ ends: TEXT_ENDS.KEEP }),
    operations: s.array(s.enumOf(HOSTED_BRAIN_OPERATION_NAMES), {
      max: HOSTED_BRAIN_OPERATION_NAMES.length,
    }),
    tools: s.array(s.text({ ends: TEXT_ENDS.KEEP }), {
      max: HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS,
    }),
    bounds: s.record(
      {
        promptChars: s.wholeNumber({ minimum: 1 }),
        inputItems: s.wholeNumber({ minimum: 1 }),
        requestBytes: s.wholeNumber({ minimum: 1 }),
        maximumOutputTokens: s.wholeNumber({ minimum: 1 }),
      },
      { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
    ),
    reasoningEfforts: s.array(s.enumOf(REASONING_EFFORT_NAMES), {
      max: REASONING_EFFORT_NAMES.length,
    }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export function hostedBrainCapabilitiesFromWire(
  value: UnparsedWireValue,
): HostedBrainCapabilities | undefined {
  return hostedBrainCapabilitiesSchema.parse(value);
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

/** The request fields this contract declares a bound on, which is what makes a bound nameable. */
const BOUNDED_FIELD = {
  PROMPT: "prompt",
  TOOLS: "tools",
  OPTIONS: "options",
  TEXTS: "texts",
} as const;

/**
 * The word a bound is refused in, per field that has one. A malformed value
 * and an unregistered tool name each have a single counterpart, but a bound
 * does not: the prompt's is the one the desktop must be able to tell from
 * every other, and a tool list too long is a request malformed rather than an
 * option out of range. A field this build declares no bound on reads as
 * malformed rather than borrowing a word about options it knows nothing of.
 */
const TOO_LARGE_REFUSAL = new Map<string, HostedBrainRequestRefusal>([
  [BOUNDED_FIELD.PROMPT, HOSTED_BRAIN_REQUEST_REFUSAL.PROMPT_TOO_LARGE],
  [BOUNDED_FIELD.TOOLS, HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED],
  [BOUNDED_FIELD.OPTIONS, HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS],
  [BOUNDED_FIELD.TEXTS, HOSTED_BRAIN_REQUEST_REFUSAL.OPTIONS_OUT_OF_BOUNDS],
]);

function requestRefusal(refusal: SchemaRefusal, path: SchemaPath): HostedBrainRequestRefusal {
  if (refusal === SCHEMA_REFUSAL.NOT_REGISTERED) {
    return HOSTED_BRAIN_REQUEST_REFUSAL.UNKNOWN_TOOL;
  }
  if (refusal !== SCHEMA_REFUSAL.TOO_LARGE) return HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED;
  const [field] = path;
  const named = isWireString(field) ? TOO_LARGE_REFUSAL.get(field) : undefined;
  return named ?? HOSTED_BRAIN_REQUEST_REFUSAL.MALFORMED;
}

/** One request read for the whole contract: the schema's answer in this contract's words. */
export function hostedBrainRequestRead<Request>(
  schema: Schema<Request>,
  value: UnparsedWireValue,
): HostedBrainRequestRead<Request> {
  const read = schema.read(value);
  return read.ok
    ? { ok: true, request: read.value }
    : { ok: false, refusal: requestRefusal(read.refusal, read.path) };
}

const contractSchema = s.literal(HOSTED_BRAIN_CONTRACT_VERSION);

/**
 * The prompt as sent: kept exactly as written, admitted empty, and refused
 * past its bound rather than cut, because the desktop composes it and the
 * service replays it.
 */
const promptSchema = s.text({
  max: HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS,
  ends: TEXT_ENDS.KEEP,
  allowEmpty: true,
});

/** Registered names only: each within its length, unique, and known to the catalog given. */
function toolsSchema(catalog: ReadonlySet<string>): Schema<string[]> {
  return s.refine(
    s.array(
      s.registered(
        s.text({ max: HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_NAME_CHARS, ends: TEXT_ENDS.KEEP }),
        catalog,
      ),
      { max: HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS },
    ),
    (names) => new Set(names).size === names.length,
  );
}

const optionsSchema = s.record({
  maximumOutputTokens: s
    .wholeNumber({ minimum: 1, maximum: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS })
    .optional(),
  reasoningEffort: s.enumOf(REASONING_EFFORT_NAMES).optional(),
});

/**
 * The input array, which is the one field no combinator can declare: every
 * item is rebuilt field by field from the allowlist in `responses-input.ts`
 * rather than narrowed from what arrived, so the reader is the rule and the
 * node beside it only says so.
 */
const inputSchema = s.reader<readonly WireRecord[]>({
  read: (value) => {
    const input = admitBrainInput(value);
    return input === undefined
      ? { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] }
      : { ok: true, value: input };
  },
  jsonSchema: () => ({
    type: "array",
    description:
      "Responses input items, admitted by this build's own allowlist rather than by this declaration.",
    items: { type: "object", properties: {}, required: [], additionalProperties: false },
  }),
});

/** The texts to embed: each non-blank and within its bound, the batch within its count. */
const textsSchema = s.array(
  s.text({ max: HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXT_CHARS, ends: TEXT_ENDS.KEEP }),
  { minimum: 1, max: HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS },
);

/**
 * Reads a respond request against the tool catalog the schema is built with —
 * the service's registered names, or the capabilities a desktop fetched — so a
 * request naming a tool the other side does not know is refused before it
 * costs anything. The same declaration runs on both ends.
 */
export function hostedBrainRespondRequestSchema(
  catalog: ReadonlySet<string>,
): Schema<HostedBrainRespondRequest> {
  return s.record({
    contract: contractSchema,
    prompt: promptSchema,
    tools: toolsSchema(catalog),
    options: optionsSchema,
    input: inputSchema,
  });
}

export function hostedBrainCountTokensRequestSchema(
  catalog: ReadonlySet<string>,
): Schema<HostedBrainCountTokensRequest> {
  return s.record({
    contract: contractSchema,
    prompt: promptSchema,
    tools: toolsSchema(catalog),
    input: inputSchema,
  });
}

export const hostedBrainCompactRequestSchema: Schema<HostedBrainCompactRequest> = s.record({
  contract: contractSchema,
  prompt: promptSchema,
  input: inputSchema,
});

export const hostedBrainEmbedRequestSchema: Schema<HostedBrainEmbedRequest> = s.record({
  contract: contractSchema,
  texts: textsSchema,
});

export function hostedBrainRespondRequestFromWire(
  value: UnparsedWireValue,
  catalog: ReadonlySet<string>,
): HostedBrainRequestRead<HostedBrainRespondRequest> {
  return hostedBrainRequestRead(hostedBrainRespondRequestSchema(catalog), value);
}

export function hostedBrainCountTokensRequestFromWire(
  value: UnparsedWireValue,
  catalog: ReadonlySet<string>,
): HostedBrainRequestRead<HostedBrainCountTokensRequest> {
  return hostedBrainRequestRead(hostedBrainCountTokensRequestSchema(catalog), value);
}

export function hostedBrainCompactRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainCompactRequest> {
  return hostedBrainRequestRead(hostedBrainCompactRequestSchema, value);
}

export function hostedBrainEmbedRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainEmbedRequest> {
  return hostedBrainRequestRead(hostedBrainEmbedRequestSchema, value);
}

/** The vectors are one width, and the width is the one the answer names. */
export const hostedBrainEmbedAnswerSchema: Schema<HostedBrainEmbedAnswer> = s.refine(
  s.record(
    {
      model: s.text({ ends: TEXT_ENDS.KEEP }),
      dimensions: s.wholeNumber({ minimum: 1 }),
      vectors: s.array(s.array(s.number(), { minimum: 1 })),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  (answer) => answer.vectors.every((vector) => vector.length === answer.dimensions),
);

export function hostedBrainEmbedAnswerFromWire(
  value: UnparsedWireValue,
): HostedBrainEmbedAnswer | undefined {
  return hostedBrainEmbedAnswerSchema.parse(value);
}

export interface HostedBrainCountTokensAnswer {
  inputTokens: number;
}

export const hostedBrainCountTokensAnswerSchema: Schema<HostedBrainCountTokensAnswer> = s.record(
  { inputTokens: s.wholeNumber({ minimum: 0 }) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export function hostedBrainCountTokensAnswerFromWire(
  value: UnparsedWireValue,
): HostedBrainCountTokensAnswer | undefined {
  return hostedBrainCountTokensAnswerSchema.parse(value);
}
