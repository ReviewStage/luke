import { REASONING_EFFORT, type ReasoningEffort } from "@sidecar/runtime/vocabulary";
import {
  isWireString,
  type JsonSchemaNode,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRefusal,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { declareReader, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Either, Schema } from "effect";
import {
  admitBrainInput,
  maximumHostedBrainInputItems,
  maximumHostedBrainRequestBytes,
} from "./responses-input.js";

/**
 * The hosted brain contract. The desktop prepares the prompt and names the
 * tools, because the prompt is composed on the desktop and the toolset is
 * chosen by a policy there. What the service fixes is everything a caller
 * could abuse: the model, the upstream, the credential, the reasoning summary,
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
  /** Embeddings for the notebook index: texts in, one vector each out, under the model the service fixes. */
  EMBED: "embed",
  /**
   * The read prefetch's small inferences on the model the service fixes for
   * it: a forced plan of the reads a spoken ask will need, or a tool-free
   * summary of what they answered.
   */
  PREFETCH: "prefetch",
} as const;

export type HostedBrainOperation =
  (typeof HOSTED_BRAIN_OPERATION)[keyof typeof HOSTED_BRAIN_OPERATION];

const HOSTED_BRAIN_OPERATION_NAMES = Object.values(HOSTED_BRAIN_OPERATION);

/**
 * The operations the service names in its capabilities' `operations` list.
 * The prefetch is not among them on purpose: a shipped desktop reads that
 * list against the literal set its own build knew, and a name it never knew
 * would fail the whole capabilities read and take the brain with it. The
 * prefetch is advertised by the optional `prefetch` field instead, which a
 * desktop that does not know it ignores.
 */
export const HOSTED_BRAIN_LISTED_OPERATIONS: readonly HostedBrainOperation[] = [
  HOSTED_BRAIN_OPERATION.RESPOND,
  HOSTED_BRAIN_OPERATION.COUNT_TOKENS,
  HOSTED_BRAIN_OPERATION.EMBED,
];

/** The two prefetch inferences, named in the request so the service picks the tools and nothing the caller sends does. */
export const HOSTED_BRAIN_PREFETCH_KIND = {
  /** Plan which reads the answering turn will need: the one registered planning tool, forced. */
  PLAN: "plan",
  /** Summarize what the reads answered, for the voice: no tools at all. */
  SUMMARIZE: "summarize",
} as const;

export type HostedBrainPrefetchKind =
  (typeof HOSTED_BRAIN_PREFETCH_KIND)[keyof typeof HOSTED_BRAIN_PREFETCH_KIND];

const HOSTED_BRAIN_PREFETCH_KIND_NAMES = Object.values(HOSTED_BRAIN_PREFETCH_KIND);

/**
 * What one prefetch inference may carry: a prompt fixed by the build and far
 * smaller than a turn's, the words so far and the roster or the reads as one
 * or two input items, and a short answer. A request past any of them is
 * refused, never cut.
 */
export const HOSTED_BRAIN_PREFETCH_BOUNDS = {
  MAXIMUM_PROMPT_CHARS: 20_000,
  MAXIMUM_INPUT_ITEMS: 2,
  MAXIMUM_OUTPUT_TOKENS: 600,
} as const;

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
  /**
   * The prompt cache key's own bound. It carries a hash and nothing else —
   * the desktop derives it from a conversation's key before it is sent — so
   * the bound is a hash's length rather than a name's.
   */
  PROMPT_CACHE_KEY_CHARS: 64,
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

/** The prefetch as the service advertises it: the model its two inferences run on. */
export interface HostedBrainPrefetchCapability {
  model: string;
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
  /** Present where the service serves the prefetch operation; a desktop that finds it absent plans no read ahead. */
  prefetch?: HostedBrainPrefetchCapability;
}

export function hostedBrainBounds(): HostedBrainBounds {
  return {
    promptChars: HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS,
    inputItems: maximumHostedBrainInputItems,
    requestBytes: maximumHostedBrainRequestBytes,
    maximumOutputTokens: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS,
  };
}

/**
 * A text kept exactly as written, and refused when it carries nothing but
 * whitespace. JSON Schema cannot say "not only whitespace", so the node shows
 * `minLength: 1`, a bound necessary rather than sufficient; a bound the reader
 * holds and the node omits would be drift in the direction that misleads a
 * model.
 */
const writtenText = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0, {
    schemaId: Schema.MinLengthSchemaId,
    jsonSchema: { minLength: 1 },
  }),
);

/** The same text under a bound, past which it is too large rather than cut. */
const boundedText = (maximumChars: number) => writtenText.pipe(Schema.maxLength(maximumChars));

/**
 * An integer at or above its minimum. Below it is malformed rather than too
 * large: a count of minus three is not a count that overflowed.
 */
const wholeNumber = (minimum: number) => Schema.Int.pipe(Schema.greaterThanOrEqualTo(minimum));

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does and a request never does. Each record states its own rule, because
 * Effect hands a struct's parse options down to the structs inside it and a
 * read is strict wherever nothing says otherwise. The emitted node says
 * `additionalProperties: false` either way: that is the contract a model is
 * held to, and tolerating a key on the way in never invites one.
 */
const tolerantRecord = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

const contract = Schema.Literal(HOSTED_BRAIN_CONTRACT_VERSION);

export const hostedBrainCapabilitiesSchema = tolerantRecord({
  contract,
  model: writtenText,
  operations: Schema.Array(Schema.Literal(...HOSTED_BRAIN_OPERATION_NAMES)).pipe(
    Schema.maxItems(HOSTED_BRAIN_OPERATION_NAMES.length),
  ),
  tools: Schema.Array(writtenText).pipe(Schema.maxItems(HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS)),
  bounds: tolerantRecord({
    promptChars: wholeNumber(1),
    inputItems: wholeNumber(1),
    requestBytes: wholeNumber(1),
    maximumOutputTokens: wholeNumber(1),
  }),
  reasoningEfforts: Schema.Array(Schema.Literal(...REASONING_EFFORT_NAMES)).pipe(
    Schema.maxItems(REASONING_EFFORT_NAMES.length),
  ),
  prefetch: Schema.optionalWith(tolerantRecord({ model: writtenText }), { exact: true }),
});

/**
 * The value a declaration admitted, or nothing, for an answer whose caller
 * never has to tell one refusal from another. What holds each declaration
 * below to the interface above it is the read that answers in that
 * interface's own words: a declaration that stopped decoding what its
 * interface promises does not compile there, which is where the builder's
 * `Schema<Value>` annotation used to say the same thing — Effect's `Schema`
 * is invariant in its decoded type, so a struct cannot carry an interface it
 * merely agrees with as an annotation.
 */
function admitted<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

export function hostedBrainCapabilitiesFromWire(
  value: UnparsedWireValue,
): HostedBrainCapabilities | undefined {
  return admitted(hostedBrainCapabilitiesSchema, value);
}

export interface HostedBrainRequestOptions {
  maximumOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  /** The prefix cache the inference should land against, as a hash; the service forwards it and keeps none. */
  promptCacheKey?: string;
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

export interface HostedBrainEmbedRequest {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  texts: readonly string[];
}

interface HostedBrainPrefetchRequestOptions {
  maximumOutputTokens?: number;
}

/**
 * One prefetch inference: which of the two it is, the build-fixed prompt for
 * it, and the one or two items it reads. No tool names travel: the kind is
 * what selects the planning tool or none, so a caller can neither widen the
 * planner's tools nor hand the summary any.
 */
export interface HostedBrainPrefetchRequest {
  contract: typeof HOSTED_BRAIN_CONTRACT_VERSION;
  kind: HostedBrainPrefetchKind;
  prompt: string;
  options: HostedBrainPrefetchRequestOptions;
  input: readonly WireRecord[];
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
function hostedBrainRequestRead<Request, Encoded>(
  schema: Schema.Schema<Request, Encoded>,
  value: UnparsedWireValue,
): HostedBrainRequestRead<Request> {
  return Either.match(readEither(schema)(value), {
    onLeft: ({ refusal, path }) => ({ ok: false, refusal: requestRefusal(refusal, path) }),
    onRight: (request) => ({ ok: true, request }),
  });
}

/**
 * The prompt as sent: kept exactly as written, admitted empty, and refused
 * past its bound rather than cut, because the desktop composes it and the
 * service replays it.
 */
const prompt = Schema.String.pipe(Schema.maxLength(HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS));

/** Registered names only: each within its length, unique, and known to the catalog given. */
function toolNames(catalog: ReadonlySet<string>) {
  return Schema.Array(
    boundedText(HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_NAME_CHARS).pipe(
      Schema.filter((name) => catalog.has(name), wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED)),
    ),
  ).pipe(
    Schema.maxItems(HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS),
    Schema.filter((names) => new Set(names).size === names.length),
  );
}

const options = Schema.Struct({
  maximumOutputTokens: Schema.optionalWith(
    wholeNumber(1).pipe(Schema.lessThanOrEqualTo(HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS)),
    { exact: true },
  ),
  reasoningEffort: Schema.optionalWith(Schema.Literal(...REASONING_EFFORT_NAMES), { exact: true }),
  promptCacheKey: Schema.optionalWith(
    boundedText(HOSTED_BRAIN_OPTION_BOUNDS.PROMPT_CACHE_KEY_CHARS),
    { exact: true },
  ),
});

/** What the input array shows, since what it admits is the reader's own rule and not a node's. */
const INPUT_NODE: JsonSchemaNode = {
  type: "array",
  description:
    "Responses input items, admitted by this build's own allowlist rather than by this declaration.",
  items: { type: "object", properties: {}, required: [], additionalProperties: false },
};

/**
 * The input array, which is the one field no combinator can declare: every
 * item is rebuilt field by field from the allowlist in `responses-input.ts`
 * rather than narrowed from what arrived, so the reader is the rule and the
 * node beside it only says so.
 */
const input = declareReader<readonly WireRecord[]>((value) => {
  const items = admitBrainInput(value);
  return items === undefined
    ? { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] }
    : { ok: true, value: items };
}, INPUT_NODE);

/** The prefetch's prompt: the same rule as a turn's, under the prefetch's own far smaller envelope. */
const prefetchPrompt = Schema.String.pipe(
  Schema.maxLength(HOSTED_BRAIN_PREFETCH_BOUNDS.MAXIMUM_PROMPT_CHARS),
);

const prefetchOptions = Schema.Struct({
  maximumOutputTokens: Schema.optionalWith(
    wholeNumber(1).pipe(
      Schema.lessThanOrEqualTo(HOSTED_BRAIN_PREFETCH_BOUNDS.MAXIMUM_OUTPUT_TOKENS),
    ),
    { exact: true },
  ),
});

/**
 * The prefetch's input: the same admission a turn's input runs, then the
 * prefetch's own count. A third item is malformed rather than too large,
 * because the two items are two fixed things — the words so far beside the
 * roster, or the reads — and a request carrying more is not a prefetch.
 */
const prefetchInput = declareReader<readonly WireRecord[]>((value) => {
  const items = admitBrainInput(value);
  return items === undefined || items.length > HOSTED_BRAIN_PREFETCH_BOUNDS.MAXIMUM_INPUT_ITEMS
    ? { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path: [] }
    : { ok: true, value: items };
}, INPUT_NODE);

/** The texts to embed: each non-blank and within its bound, the batch within its count. */
const texts = Schema.Array(boundedText(HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXT_CHARS)).pipe(
  Schema.minItems(1),
  Schema.maxItems(HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS),
);

/**
 * Reads a respond request against the tool catalog the schema is built with —
 * the service's registered names, or the capabilities a desktop fetched — so a
 * request naming a tool the other side does not know is refused before it
 * costs anything. The same declaration runs on both ends.
 */
export function hostedBrainRespondRequestSchema(catalog: ReadonlySet<string>) {
  return Schema.Struct({ contract, prompt, tools: toolNames(catalog), options, input });
}

export function hostedBrainCountTokensRequestSchema(catalog: ReadonlySet<string>) {
  return Schema.Struct({ contract, prompt, tools: toolNames(catalog), input });
}

export const hostedBrainEmbedRequestSchema = Schema.Struct({ contract, texts });

export const hostedBrainPrefetchRequestSchema = Schema.Struct({
  contract,
  kind: Schema.Literal(...HOSTED_BRAIN_PREFETCH_KIND_NAMES),
  prompt: prefetchPrompt,
  options: prefetchOptions,
  input: prefetchInput,
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

export function hostedBrainEmbedRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainEmbedRequest> {
  return hostedBrainRequestRead(hostedBrainEmbedRequestSchema, value);
}

export function hostedBrainPrefetchRequestFromWire(
  value: UnparsedWireValue,
): HostedBrainRequestRead<HostedBrainPrefetchRequest> {
  return hostedBrainRequestRead(hostedBrainPrefetchRequestSchema, value);
}

/** The vectors are one width, and the width is the one the answer names. */
export const hostedBrainEmbedAnswerSchema = tolerantRecord({
  model: writtenText,
  dimensions: wholeNumber(1),
  vectors: Schema.Array(Schema.Array(Schema.Number.pipe(Schema.finite())).pipe(Schema.minItems(1))),
}).pipe(
  Schema.filter((answer) => answer.vectors.every((vector) => vector.length === answer.dimensions)),
);

export function hostedBrainEmbedAnswerFromWire(
  value: UnparsedWireValue,
): HostedBrainEmbedAnswer | undefined {
  return admitted(hostedBrainEmbedAnswerSchema, value);
}

export interface HostedBrainCountTokensAnswer {
  inputTokens: number;
}

export const hostedBrainCountTokensAnswerSchema = tolerantRecord({
  inputTokens: wholeNumber(0),
});

export function hostedBrainCountTokensAnswerFromWire(
  value: UnparsedWireValue,
): HostedBrainCountTokensAnswer | undefined {
  return admitted(hostedBrainCountTokensAnswerSchema, value);
}
