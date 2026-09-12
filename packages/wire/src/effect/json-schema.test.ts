import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Either, ParseResult, Schema } from "effect";
import { test } from "vitest";
import type { WireRecord } from "../json.js";
import { type JsonSchemaNode, SCHEMA_REFUSAL } from "../schema-vocabulary.js";
import { matchJsonSchemaGolden } from "../testing/json-schema-golden.js";
import {
  describeWire,
  emitJsonSchema,
  readEither,
  type SchemaRefusalError,
  verbatimJsonSchema,
  WireDescriptionAnnotationId,
  wireRefusal,
} from "./json-schema.js";

/**
 * The emitter is measured against the goldens each package recorded: each
 * schema below is the Effect declaration of one another package declares
 * directly, and the bytes it emits have to be the bytes that package's own
 * test holds still. The goldens are read and never written from here.
 */

const PACKAGES = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const GOLDEN_ROOT = {
  HOSTED: path.join(PACKAGES, "hosted/fixtures/json-schema"),
  ACTIONS: path.join(PACKAGES, "actions/fixtures/json-schema"),
} as const;

const HOSTED_BRAIN_CONTRACT_VERSION = 2;
const HOSTED_BRAIN_OPERATION = ["respond", "count-tokens", "embed"] as const;
const REASONING_EFFORT = ["low", "medium", "high"] as const;
const HOSTED_BRAIN_PROMPT_CHARS = 200_000;
const HOSTED_BRAIN_TOOL_BOUNDS = { MAXIMUM_TOOLS: 64, MAXIMUM_NAME_CHARS: 64 } as const;
const HOSTED_BRAIN_OPTION_BOUNDS = {
  MAXIMUM_OUTPUT_TOKENS: 16_000,
  PROMPT_CACHE_KEY_CHARS: 64,
} as const;
const HOSTED_BRAIN_EMBED_BOUNDS = { MAXIMUM_TEXTS: 64, MAXIMUM_TEXT_CHARS: 8_000 } as const;

/** A non-empty string, bounded where a `max` is declared, as a wire declaration reads one. */
const text = (max?: number) =>
  max === undefined
    ? Schema.String.pipe(Schema.minLength(1))
    : Schema.String.pipe(Schema.minLength(1), Schema.maxLength(max));

/** An integer at or above its minimum, as a wire declaration reads one. */
const wholeNumber = (minimum: number) => Schema.Int.pipe(Schema.greaterThanOrEqualTo(minimum));

const contract = Schema.Literal(HOSTED_BRAIN_CONTRACT_VERSION);

const hostedBrainCapabilities = Schema.Struct({
  contract,
  model: text(),
  operations: Schema.Array(Schema.Literal(...HOSTED_BRAIN_OPERATION)).pipe(
    Schema.maxItems(HOSTED_BRAIN_OPERATION.length),
  ),
  tools: Schema.Array(text()).pipe(Schema.maxItems(HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS)),
  bounds: Schema.Struct({
    promptChars: wholeNumber(1),
    inputItems: wholeNumber(1),
    requestBytes: wholeNumber(1),
    maximumOutputTokens: wholeNumber(1),
  }),
  reasoningEfforts: Schema.Array(Schema.Literal(...REASONING_EFFORT)).pipe(
    Schema.maxItems(REASONING_EFFORT.length),
  ),
});

const hostedBrainEmbedRequest = Schema.Struct({
  contract,
  texts: Schema.Array(text(HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXT_CHARS)).pipe(
    Schema.minItems(1),
    Schema.maxItems(HOSTED_BRAIN_EMBED_BOUNDS.MAXIMUM_TEXTS),
  ),
});

/** A rule the node cannot say, so the node beneath it is emitted. */
const hostedBrainEmbedAnswer = Schema.Struct({
  model: text(),
  dimensions: wholeNumber(1),
  vectors: Schema.Array(Schema.Array(Schema.Number).pipe(Schema.minItems(1))),
}).pipe(
  Schema.filter((answer) => answer.vectors.every((vector) => vector.length === answer.dimensions)),
);

const hostedBrainCountTokensAnswer = Schema.Struct({ inputTokens: wholeNumber(0) });

/** A text admitting an empty value and kept as written: no `minLength`. */
const prompt = Schema.String.pipe(Schema.maxLength(HOSTED_BRAIN_PROMPT_CHARS));

const FIXTURE_TOOL_CATALOG: ReadonlySet<string> = new Set(["fixture_tool"]);

/** A value admitted only by a registry, over a bounded text, and a uniqueness rule over the array. */
const tools = Schema.Array(
  text(HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_NAME_CHARS).pipe(
    Schema.filter(
      (name) => FIXTURE_TOOL_CATALOG.has(name),
      wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED),
    ),
  ),
).pipe(
  Schema.maxItems(HOSTED_BRAIN_TOOL_BOUNDS.MAXIMUM_TOOLS),
  Schema.filter((names) => new Set(names).size === names.length),
);

const options = Schema.Struct({
  maximumOutputTokens: Schema.optionalWith(
    Schema.Int.pipe(
      Schema.greaterThanOrEqualTo(1),
      Schema.lessThanOrEqualTo(HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS),
    ),
    { exact: true },
  ),
  reasoningEffort: Schema.optionalWith(Schema.Literal(...REASONING_EFFORT), { exact: true }),
  promptCacheKey: Schema.optionalWith(text(HOSTED_BRAIN_OPTION_BOUNDS.PROMPT_CACHE_KEY_CHARS), {
    exact: true,
  }),
});

/** A declared reader: the node is declared beside the reader, in the reader's own key order. */
const INPUT_NODE: JsonSchemaNode = {
  type: "array",
  description:
    "Responses input items, admitted by this build's own allowlist rather than by this declaration.",
  items: { type: "object", properties: {}, required: [], additionalProperties: false },
};

const input = verbatimJsonSchema(
  Schema.declare((value): value is readonly WireRecord[] => Array.isArray(value)),
  INPUT_NODE,
);

const hostedBrainRespondRequest = Schema.Struct({ contract, prompt, tools, options, input });

const hostedBrainCountTokensRequest = Schema.Struct({ contract, prompt, tools, input });

/** A union of a bounded whole number and a null literal, under `optional`. */
const presenceInstant = Schema.Union(wholeNumber(0), Schema.Null);

const changesRequest = Schema.Struct({
  deviceId: text(36),
  activeUntil: Schema.optionalWith(presenceInstant, { exact: true }),
  quietUntil: Schema.optionalWith(presenceInstant, { exact: true }),
});

const HOSTED_GOLDENS = [
  ["brain-contract-hostedBrainCapabilitiesSchema", hostedBrainCapabilities],
  ["brain-contract-hostedBrainEmbedRequestSchema", hostedBrainEmbedRequest],
  ["brain-contract-hostedBrainEmbedAnswerSchema", hostedBrainEmbedAnswer],
  ["brain-contract-hostedBrainCountTokensAnswerSchema", hostedBrainCountTokensAnswer],
  ["brain-contract-hostedBrainRespondRequestSchema", hostedBrainRespondRequest],
  ["brain-contract-hostedBrainCountTokensRequestSchema", hostedBrainCountTokensRequest],
  ["reads-wire-changesRequestSchema", changesRequest],
] as const satisfies readonly (readonly [string, Schema.Schema.All])[];

test.for(HOSTED_GOLDENS)(
  "%s is emitted byte for byte from its Effect declaration",
  async ([name, schema]) => {
    await matchJsonSchemaGolden(GOLDEN_ROOT.HOSTED, name, emitJsonSchema(schema));
  },
);

const MAXIMUM_IDENTIFIER_LENGTH = 200;
const MAXIMUM_SESSION_MESSAGE_LENGTH = 4000;
const MAXIMUM_WORKSPACE_NAME_LENGTH = 80;

const identifier = (description: string) =>
  describeWire(text(MAXIMUM_IDENTIFIER_LENGTH), description);

const SESSION_IDENTITY_FIELDS = {
  provider_id: identifier("The session provider ID."),
  provider_session_id: identifier("The session ID."),
} as const;

const optionalText = (description: string, max?: number) =>
  Schema.optionalWith(describeWire(text(max), description), { exact: true });

const sendSessionMessage = Schema.Struct({
  ...SESSION_IDENTITY_FIELDS,
  text: describeWire(text(MAXIMUM_SESSION_MESSAGE_LENGTH), "The message to send."),
});

const createWorkspace = Schema.Struct({
  provider_id: optionalText("The provider ID; omit it to create in the default provider."),
  project_id: optionalText("The project ID; omit it to create in that provider's default project."),
  target_id: optionalText(
    "The target ID of the host, exactly as the projects list gives it, and only for a " +
      "project whose line carries a target_id; a project listed without one takes none.",
  ),
  agent: optionalText("The agent kind."),
  name: optionalText(
    "The workspace's name: the developer's own when they chose one, otherwise a short, " +
      "specific name composed from what the workspace is for, in a few words with no " +
      "punctuation. Always supply one, except in a project listed as naming its own " +
      "workspaces, which takes none.",
    MAXIMUM_WORKSPACE_NAME_LENGTH,
  ),
  task: optionalText("An optional opening task.", MAXIMUM_SESSION_MESSAGE_LENGTH),
  model: optionalText("An optional model."),
  effort: optionalText("An optional effort level."),
});

const ACTION_GOLDENS = [
  [
    "tool-send_session_message",
    "send_session_message",
    "Send a message to an observed session.",
    sendSessionMessage,
  ],
  [
    "tool-create_workspace",
    "create_workspace",
    "Create a workspace for a new agent.",
    createWorkspace,
  ],
] as const satisfies readonly (readonly [string, string, string, Schema.Schema.All])[];

test.for(ACTION_GOLDENS)(
  "%s is emitted byte for byte from its Effect declaration",
  async ([golden, name, description, request]) => {
    await matchJsonSchemaGolden(GOLDEN_ROOT.ACTIONS, golden, {
      type: "function",
      name,
      description,
      parameters: emitJsonSchema(request),
    });
  },
);

test("a description on a property signature is carried when the type has none", () => {
  const described = Schema.Struct({
    field: Schema.propertySignature(Schema.Boolean).annotations({
      [WireDescriptionAnnotationId]: "Whether.",
    }),
  });

  assert.deepEqual(emitJsonSchema(described), {
    type: "object",
    properties: { field: { type: "boolean", description: "Whether." } },
    required: ["field"],
    additionalProperties: false,
  });
});

test("the outermost description wins and Effect's own descriptions are never read", () => {
  const inner = describeWire(Schema.String.pipe(Schema.minLength(1)), "Inner.");
  const outer = describeWire(inner.pipe(Schema.maxLength(3)), "Outer.");

  assert.deepEqual(emitJsonSchema(outer), {
    type: "string",
    minLength: 1,
    maxLength: 3,
    description: "Outer.",
  });
  assert.deepEqual(emitJsonSchema(Schema.String), { type: "string" });
});

test("bounds are emitted in a fixed key order whatever order they were piped in", () => {
  const piped = Schema.String.pipe(Schema.maxLength(9), Schema.minLength(2));

  assert.deepEqual(Object.keys(emitJsonSchema(piped)), ["type", "minLength", "maxLength"]);
});

test("an inexact optional drops the undefined its union carries", () => {
  const inexact = Schema.Struct({ field: Schema.optional(Schema.Number) });

  assert.deepEqual(emitJsonSchema(inexact), {
    type: "object",
    properties: { field: { type: "number" } },
    required: [],
    additionalProperties: false,
  });
});

test("a transformation emits the wire side it decodes from", () => {
  const length = Schema.transform(Schema.String.pipe(Schema.minLength(1)), Schema.Number, {
    decode: (value) => value.length,
    encode: (length) => "x".repeat(length),
  });

  assert.deepEqual(emitJsonSchema(length), { type: "string", minLength: 1 });
});

const UNSHOWABLE = [
  ["a declaration with no verbatim node", Schema.instanceOf(Date)],
  ["a tuple with positions", Schema.Tuple(Schema.String, Schema.Number)],
  [
    "an object with an index signature",
    Schema.Record({ key: Schema.String, value: Schema.Number }),
  ],
  [
    "a length bound on a boolean",
    Schema.Boolean.pipe(
      Schema.filter(() => true, {
        schemaId: Schema.MinLengthSchemaId,
        jsonSchema: { minLength: 1 },
      }),
    ),
  ],
  ["a bound declared twice", Schema.String.pipe(Schema.maxLength(1), Schema.maxLength(2))],
  ["a bigint literal", Schema.Literal(1n)],
] as const satisfies readonly (readonly [string, Schema.Schema.All])[];

test.for(UNSHOWABLE)("%s throws at emission rather than emitting a node", ([, schema]) => {
  assert.throws(() => emitJsonSchema(schema), Error);
});

const bounded = Schema.Struct({
  name: text(3),
  count: wholeNumber(1),
  tags: Schema.Array(Schema.String).pipe(Schema.maxItems(2)),
  registered: Schema.String.pipe(
    Schema.filter((value) => value === "known", wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED)),
  ),
});

const readBounded = readEither(bounded);

const WELL_FORMED = { name: "abc", count: 1, tags: ["a"], registered: "known" };

function refusalOf<A>(read: Either.Either<A, SchemaRefusalError>): SchemaRefusalError {
  assert.ok(Either.isLeft(read));
  return read.left;
}

test("readEither answers the decoded value", () => {
  assert.deepEqual(Either.getOrThrow(readBounded(WELL_FORMED)), WELL_FORMED);
});

test("a text past its maximum is too large at its key", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, name: "abcd" }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.path, ["name"]);
});

test("a number below its minimum is malformed", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, count: 0 }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, ["count"]);
});

test("an array past its count is too large", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, tags: ["a", "b", "c"] }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.path, ["tags"]);
});

test("a refused entry is reported at its index", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, tags: ["a", 1] }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, ["tags", 1]);
});

test("a refinement carrying its own refusal answers that word", () => {
  const refused = refusalOf(readBounded({ ...WELL_FORMED, registered: "unknown" }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.deepEqual(refused.path, ["registered"]);
});

test("a missing key and an unlisted key are each malformed at that key", () => {
  const { name, ...missing } = WELL_FORMED;
  const missingRefusal = refusalOf(readBounded(missing));
  const unlistedRefusal = refusalOf(readBounded({ ...WELL_FORMED, extra: name }));

  assert.equal(missingRefusal.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(missingRefusal.path, ["name"]);
  assert.equal(unlistedRefusal.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(unlistedRefusal.path, ["extra"]);
});

test("a wrong type at the root is malformed with an empty path", () => {
  const refused = refusalOf(readBounded("not a record"));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(refused.path, []);
});

test("a failed transformation answers its own refusal annotation", () => {
  const parsed = Schema.transformOrFail(Schema.String, Schema.Number, {
    strict: true,
    decode: (value, _options, ast) =>
      value === "one" ? ParseResult.succeed(1) : ParseResult.fail(new ParseResult.Type(ast, value)),
    encode: () => ParseResult.succeed("one"),
  }).annotations(wireRefusal(SCHEMA_REFUSAL.TOO_LARGE));

  const refused = refusalOf(readEither(Schema.Struct({ value: parsed }))({ value: "two" }));

  assert.equal(refused.refusal, SCHEMA_REFUSAL.TOO_LARGE);
  assert.deepEqual(refused.path, ["value"]);
});
