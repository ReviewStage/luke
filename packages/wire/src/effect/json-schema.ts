import { Array as Arr, Data, Effect, Option, Result, Schema, SchemaAST, SchemaIssue } from "effect";
import type { UnparsedWireValue } from "../json.js";
import {
  EXCESS_KEYS,
  type ExcessKeys,
  type JsonSchemaNode,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
} from "../schema-vocabulary.js";

/**
 * The JSON Schema a model is shown for an Effect `Schema`, emitted by walking
 * its AST into the same `JsonSchemaNode` the `s.*` builder answers for the
 * equivalent declaration, key for key and in the same order. Effect's own
 * `JsonSchema` module is never called: its output is a different dialect with
 * different keys in a different order, and these bytes are prompt-cache bytes,
 * held still by the goldens under every package's `fixtures/json-schema/`.
 *
 * Nothing here reads Effect's own `title` and `description` annotations,
 * because Effect writes them on every primitive and every built-in check
 * (`Schema.isMinLength(1)` says "a value with a length of at least 1"), so a
 * sentence a model is shown has to be one wire was handed on purpose, under
 * wire's own annotation. The same goes for the refusal a failed rule earns and
 * for a node declared verbatim beside a reader: each is wire's own annotation,
 * set through the helpers below and read nowhere else.
 *
 * A declaration the wire cannot show — a class, a symbol, a tuple with
 * positions, an index signature, a bound on a kind of node that cannot carry
 * it — throws at emission, which is the builder's own rule: a value is never
 * thrown at, and a schema declared with rules that contradict each other does
 * not ship.
 */

/**
 * Wire's own annotations are keyed by name rather than by symbol, because v4
 * annotations are a string-keyed record; each name is namespaced to this
 * package so it can never collide with Effect's own.
 */
const WIRE_ANNOTATION = {
  /** The sentence a node carries as its `description`. */
  DESCRIPTION: "@sidecar/wire/effect/WireDescription",
  /** Which {@link SchemaRefusal} a failed check or transformation answers. */
  REFUSAL: "@sidecar/wire/effect/WireRefusal",
  /** A node declared verbatim beside its reader, emitted as written. */
  JSON_SCHEMA: "@sidecar/wire/effect/WireJsonSchema",
} as const;

/** The name a node's own sentence is carried under; a test reads it directly. */
export const WIRE_DESCRIPTION_ANNOTATION = WIRE_ANNOTATION.DESCRIPTION;

const readDescription = Schema.decodeUnknownOption(Schema.String);
const readRefusal = Schema.decodeUnknownOption(Schema.Literals(Object.values(SCHEMA_REFUSAL)));

/** Carries `description` into the emitted node, the way the builder's `describe` does. */
export const describeWire = <S extends Schema.Top>(schema: S, description: string): S["Rebuild"] =>
  schema.annotate({ [WIRE_ANNOTATION.DESCRIPTION]: description });

/** The annotation a check or transformation carries to name the refusal its failure earns. */
export const wireRefusal = (refusal: SchemaRefusal) => ({ [WIRE_ANNOTATION.REFUSAL]: refusal });

/** Declares the node a schema emits, verbatim, in place of anything its AST would say. */
export const verbatimJsonSchema = <S extends Schema.Top>(
  schema: S,
  node: JsonSchemaNode,
): S["Rebuild"] => schema.annotate({ [WIRE_ANNOTATION.JSON_SCHEMA]: node });

/** Every bound a recognized check can add to the node beneath it. */
interface Bounds {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly integer?: true;
}

type BoundKey = keyof Bounds;

type BoundReader = (payload: unknown) => Option.Option<Bounds>;

const boundReader = <A>(
  payload: Schema.Codec<A, unknown>,
  bounds: (payload: A) => Bounds,
): BoundReader => {
  const read = Schema.decodeUnknownOption(payload);
  return (annotation) => Option.map(read(annotation), bounds);
};

const INTEGER: Bounds = { integer: true };

/**
 * The identifiers Effect's own checks carry in their `representation`
 * annotation. v4 states a check's identity and its payload there rather than
 * in a pair of annotations keyed by a symbol, so this is the whole of what
 * says which bound a check stands for.
 */
const EFFECT_CHECK = {
  MIN_LENGTH: "effect/schema/isMinLength",
  MAX_LENGTH: "effect/schema/isMaxLength",
  GREATER_THAN_OR_EQUAL_TO: "effect/schema/isGreaterThanOrEqualTo",
  LESS_THAN_OR_EQUAL_TO: "effect/schema/isLessThanOrEqualTo",
  INT: "effect/schema/isInt",
} as const;

/**
 * The checks whose bound the node carries, by the identifier Effect's own
 * checks annotate themselves with, each read from the payload that same check
 * writes. Any other check is a rule the node cannot say — a uniqueness, a
 * field bounded by another — and emits the node beneath it, exactly as the
 * builder's `refine` does.
 *
 * v4 has one length check for strings and arrays alike, so a length bound is
 * gathered under `minLength`/`maxLength` whatever it was declared over and
 * written out as `minItems`/`maxItems` once the node's kind is known.
 */
const BOUND_READERS = new Map<string, BoundReader>([
  [
    EFFECT_CHECK.MIN_LENGTH,
    boundReader(Schema.Struct({ minLength: Schema.Number }), (payload) => payload),
  ],
  [
    EFFECT_CHECK.MAX_LENGTH,
    boundReader(Schema.Struct({ maxLength: Schema.Number }), (payload) => payload),
  ],
  [
    EFFECT_CHECK.GREATER_THAN_OR_EQUAL_TO,
    boundReader(Schema.Struct({ minimum: Schema.Number }), (payload) => payload),
  ],
  [
    EFFECT_CHECK.LESS_THAN_OR_EQUAL_TO,
    boundReader(Schema.Struct({ maximum: Schema.Number }), (payload) => payload),
  ],
  [EFFECT_CHECK.INT, () => Option.some(INTEGER)],
]);

/**
 * The bounds whose failure reads as too large rather than malformed, which is
 * the builder's rule for a `max`: a text past its bound, an array past its
 * count, a number above its maximum. Below a minimum is malformed — a count of
 * minus three is not a count that overflowed — and a check carrying its own
 * refusal annotation says so for itself.
 */
const TOO_LARGE_CHECKS: ReadonlySet<string> = new Set([
  EFFECT_CHECK.MAX_LENGTH,
  EFFECT_CHECK.LESS_THAN_OR_EQUAL_TO,
]);

/** What the walk has gathered above the node it is about to emit. */
interface Gathered {
  readonly description: string | undefined;
  readonly verbatim: JsonSchemaNode | undefined;
  readonly bounds: Bounds;
}

const NOTHING_GATHERED: Gathered = {
  description: undefined,
  verbatim: undefined,
  bounds: {},
};

const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
const isBoolean = Schema.is(Schema.Boolean);

function unshowable(ast: SchemaAST.AST, reason: string): Error {
  return new Error(`The wire cannot show ${String(ast)}: ${reason}.`);
}

/**
 * A check's own identity, or nothing for a group and for a check declared
 * without one: a group states no single bound, and a check with no
 * representation is a rule the node cannot say.
 */
function checkIdentifier(check: SchemaAST.Check<unknown>): string | undefined {
  return check.annotations?.representation?.id;
}

type Annotations = Schema.Annotations.Annotations | undefined;

function gatherAnnotations(annotations: Annotations, gathered: Gathered): Gathered {
  if (annotations === undefined) return gathered;
  const described =
    gathered.description === undefined
      ? Option.getOrUndefined(readDescription(annotations[WIRE_ANNOTATION.DESCRIPTION]))
      : undefined;
  // SAFETY: wire's own annotation namespace is written only by the helpers above, and
  // `verbatimJsonSchema` is the one that writes this key, taking a `JsonSchemaNode`.
  const verbatim =
    gathered.verbatim === undefined
      ? (annotations[WIRE_ANNOTATION.JSON_SCHEMA] as JsonSchemaNode | undefined)
      : undefined;
  if (described === undefined && verbatim === undefined) return gathered;
  return {
    ...gathered,
    description: described ?? gathered.description,
    verbatim: verbatim ?? gathered.verbatim,
  };
}

function gatherBounds(
  ast: SchemaAST.AST,
  check: SchemaAST.Check<unknown>,
  gathered: Gathered,
): Gathered {
  const identifier = checkIdentifier(check);
  if (identifier === undefined) return gathered;
  const reader = BOUND_READERS.get(identifier);
  if (reader === undefined) return gathered;
  const bounds = reader(check.annotations?.representation?.payload);
  if (Option.isNone(bounds)) {
    throw unshowable(ast, "its bound annotation does not carry the bound its id names");
  }
  for (const key of Object.keys(bounds.value)) {
    if (Object.hasOwn(gathered.bounds, key)) {
      throw unshowable(ast, `${key} is declared twice`);
    }
  }
  return { ...gathered, bounds: { ...gathered.bounds, ...bounds.value } };
}

/**
 * What a node says about itself, outermost first. A v4 schema carries its
 * checks in one array beside the node rather than as nodes wrapped around it,
 * and `annotate` writes onto the last check a schema carries, so the checks
 * are read last to first — the order they were piped in reversed — and the
 * node's own annotations last of all. First description wins, the way the
 * outermost `describe` did.
 */
function gatherNode(ast: SchemaAST.AST, above: Gathered): Gathered {
  let gathered = above;
  const checks = ast.checks;
  if (checks !== undefined) {
    for (let index = checks.length - 1; index >= 0; index -= 1) {
      const check = checks[index];
      if (check === undefined) continue;
      gathered = gatherAnnotations(check.annotations, gathered);
      gathered = gatherBounds(ast, check, gathered);
    }
  }
  return gatherAnnotations(ast.annotations, gathered);
}

/**
 * The bounds a node of one kind may carry; anything gathered beyond them is a
 * rule declared over a node that cannot say it, which is a contradiction in
 * the declaration rather than a value to refuse.
 */
function takeBounds(ast: SchemaAST.AST, bounds: Bounds, allowed: readonly BoundKey[]): Bounds {
  const permitted = new Set<string>(allowed);
  for (const key of Object.keys(bounds)) {
    if (!permitted.has(key)) throw unshowable(ast, `it cannot carry ${key}`);
  }
  return bounds;
}

function withDescription(node: JsonSchemaNode, description: string | undefined): JsonSchemaNode {
  return description === undefined ? node : { ...node, description };
}

/** A node while its bounds are being written, before it is emitted read-only. */
type Draft<Node> = { -readonly [Key in keyof Node]: Node[Key] };

type StringNodeDraft = Draft<Extract<JsonSchemaNode, { type: "string" }>>;
type NumberNodeDraft = Draft<Extract<JsonSchemaNode, { type: "number" | "integer" }>>;
type ArrayNodeDraft = Draft<Extract<JsonSchemaNode, { type: "array" }>>;

/**
 * A `string` node's keys in the builder's order: `type`, then `minLength`, then
 * `maxLength`. The order is fixed here rather than by the order the checks
 * were piped, because the bytes are what is being held still.
 */
function stringNode(ast: SchemaAST.AST, bounds: Bounds): JsonSchemaNode {
  const { minLength, maxLength } = takeBounds(ast, bounds, ["minLength", "maxLength"]);
  const node: StringNodeDraft = { type: "string" };
  if (minLength !== undefined) node.minLength = minLength;
  if (maxLength !== undefined) node.maxLength = maxLength;
  return node;
}

function numberNode(ast: SchemaAST.AST, bounds: Bounds): JsonSchemaNode {
  const { minimum, maximum, integer } = takeBounds(ast, bounds, ["minimum", "maximum", "integer"]);
  const node: NumberNodeDraft = { type: integer === true ? "integer" : "number" };
  if (minimum !== undefined) node.minimum = minimum;
  if (maximum !== undefined) node.maximum = maximum;
  return node;
}

/**
 * An array's count is the same length bound a text carries, because v4 states
 * one length check for both; which of the two names it is written under is
 * decided here, where the node's kind is known.
 */
function arrayNode(ast: SchemaAST.AST, items: JsonSchemaNode, bounds: Bounds): JsonSchemaNode {
  const { minLength, maxLength } = takeBounds(ast, bounds, ["minLength", "maxLength"]);
  const node: ArrayNodeDraft = { type: "array", items };
  if (minLength !== undefined) node.minItems = minLength;
  if (maxLength !== undefined) node.maxItems = maxLength;
  return node;
}

/**
 * A literal's node names the one value it admits, not merely its type, and a
 * number that is a safe integer is an `integer`: both are the builder's rules.
 */
function literalNode(ast: SchemaAST.Literal): JsonSchemaNode {
  const { literal } = ast;
  if (isString(literal)) return { type: "string", enum: [literal] };
  if (isNumber(literal)) {
    return { type: Number.isSafeInteger(literal) ? "integer" : "number", enum: [literal] };
  }
  if (isBoolean(literal)) return { type: "boolean", enum: [literal] };
  throw unshowable(ast, "a bigint has no wire form");
}

/**
 * A union of literals of one primitive kind is the builder's `enumOf`, one
 * `enum` node; any other union is its `union`, an `anyOf` of members. `null`
 * is never a member of an `enum`, because the builder's null node has no
 * `enum` to join, and v4 states `null` as a node of its own rather than as a
 * literal, so a union naming it never reads as one kind.
 */
function enumNode(literals: readonly SchemaAST.LiteralValue[]): JsonSchemaNode | undefined {
  if (literals.every(isString)) return { type: "string", enum: literals };
  if (literals.every(isNumber)) {
    return {
      type: literals.every((literal) => Number.isSafeInteger(literal)) ? "integer" : "number",
      enum: literals,
    };
  }
  if (literals.every(isBoolean)) return { type: "boolean", enum: literals };
  return undefined;
}

function unionNode(
  ast: SchemaAST.Union,
  bounds: Bounds,
  visiting: Set<SchemaAST.AST>,
): JsonSchemaNode {
  takeBounds(ast, bounds, []);
  const members = ast.types;
  const literals = members.flatMap((member) => (member._tag === "Literal" ? [member.literal] : []));
  if (literals.length === members.length) {
    const asEnum = enumNode(literals);
    if (asEnum !== undefined) return asEnum;
  }
  return { anyOf: members.map((member) => emit(member, NOTHING_GATHERED, visiting)) };
}

/**
 * An optional property's type, with the `undefined` an inexact
 * `Schema.optional` adds taken back out: the builder's `optional` emits the
 * inner node, because a JSON value is never `undefined` and the key's absence
 * is what `required` already says.
 */
function propertyType(type: SchemaAST.AST): SchemaAST.AST {
  if (type._tag !== "Union") return type;
  const defined = type.types.filter((member) => member._tag !== "Undefined");
  if (defined.length === type.types.length) return type;
  const only = defined[0];
  if (defined.length === 1 && only !== undefined) return only;
  return new SchemaAST.Union(defined, type.options, type.annotations);
}

function objectNode(
  ast: SchemaAST.Objects,
  bounds: Bounds,
  visiting: Set<SchemaAST.AST>,
): JsonSchemaNode {
  takeBounds(ast, bounds, []);
  if (ast.indexSignatures.length > 0) {
    throw unshowable(ast, "a strict object has no index signature");
  }
  const properties: [string, JsonSchemaNode][] = [];
  const required: string[] = [];
  for (const signature of ast.propertySignatures) {
    if (!isString(signature.name)) throw unshowable(ast, "a property is keyed by a symbol");
    const key = gatherAnnotations(signature.type.context?.annotations, NOTHING_GATHERED);
    properties.push([signature.name, emit(propertyType(signature.type), key, visiting)]);
    if (signature.type.context?.isOptional !== true) required.push(signature.name);
  }
  return {
    type: "object",
    properties: Object.fromEntries(properties),
    required,
    additionalProperties: false,
  };
}

function arraysNode(
  ast: SchemaAST.Arrays,
  bounds: Bounds,
  visiting: Set<SchemaAST.AST>,
): JsonSchemaNode {
  const [rest, ...more] = ast.rest;
  if (ast.elements.length > 0 || rest === undefined || more.length > 0) {
    throw unshowable(ast, "only an array of one item type has a wire form");
  }
  return arrayNode(ast, emit(rest, NOTHING_GATHERED, visiting), bounds);
}

function emit(ast: SchemaAST.AST, above: Gathered, visiting: Set<SchemaAST.AST>): JsonSchemaNode {
  const gathered = gatherNode(ast, above);
  if (gathered.verbatim !== undefined) {
    takeBounds(ast, gathered.bounds, []);
    return withDescription(gathered.verbatim, gathered.description);
  }
  /**
   * A transformation states its wire side as the node it decodes from, which
   * in v4 is the last link of the node's own encoding rather than a node
   * wrapped around it.
   */
  const encoding = ast.encoding;
  if (encoding !== undefined) {
    const link = encoding[encoding.length - 1];
    if (link !== undefined) return emit(link.to, gathered, visiting);
  }
  switch (ast._tag) {
    case "Suspend": {
      if (visiting.has(ast)) throw unshowable(ast, "a recursive declaration has no finite node");
      visiting.add(ast);
      const node = emit(ast.thunk(), gathered, visiting);
      visiting.delete(ast);
      return node;
    }
    case "String":
      return withDescription(stringNode(ast, gathered.bounds), gathered.description);
    case "Number":
      return withDescription(numberNode(ast, gathered.bounds), gathered.description);
    case "Boolean":
      takeBounds(ast, gathered.bounds, []);
      return withDescription({ type: "boolean" }, gathered.description);
    case "Null":
      takeBounds(ast, gathered.bounds, []);
      return withDescription({ type: "null" }, gathered.description);
    case "Literal":
      takeBounds(ast, gathered.bounds, []);
      return withDescription(literalNode(ast), gathered.description);
    case "Union":
      return withDescription(unionNode(ast, gathered.bounds, visiting), gathered.description);
    case "Objects":
      return withDescription(objectNode(ast, gathered.bounds, visiting), gathered.description);
    case "Arrays":
      return withDescription(arraysNode(ast, gathered.bounds, visiting), gathered.description);
    default:
      throw unshowable(ast, `a ${ast._tag} has no wire form`);
  }
}

/** The JSON Schema node a model is shown for this declaration. */
export function emitJsonSchema(schema: Schema.Top): JsonSchemaNode {
  return emit(schema.ast, NOTHING_GATHERED, new Set());
}

/** Why a value was refused and where, as the one error a wire read fails with. */
export class SchemaRefusalError extends Data.TaggedError("SchemaRefusalError")<{
  readonly refusal: SchemaRefusal;
  readonly path: SchemaPath;
}> {}

const isPathSegment = Schema.is(Schema.Union([Schema.String, Schema.Number]));

function pathSegments(path: ReadonlyArray<PropertyKey>): SchemaPath {
  return path.map((key) => (isPathSegment(key) ? key : String(key)));
}

function annotatedRefusal(annotations: Annotations): SchemaRefusal | undefined {
  if (annotations === undefined) return undefined;
  return Option.getOrUndefined(readRefusal(annotations[WIRE_ANNOTATION.REFUSAL]));
}

/**
 * The refusal a node itself answers, and never one of its checks'. v4 lays
 * every `check` a declaration piped onto one node's `checks` array where v3
 * wrapped each in a `Refinement` of its own, so a word annotated on one check
 * would otherwise speak for failures that check had no part in: a value that
 * was never a string failed no check at all, and a value that failed two at
 * once is reported as the checks in the order they were declared. A check's
 * own word is read where that check's own failure is, in {@link checkRefusal}.
 */
function nodeRefusal(ast: SchemaAST.AST): SchemaRefusal | undefined {
  return annotatedRefusal(ast.annotations);
}

function checkRefusal(check: SchemaAST.Check<unknown>): SchemaRefusal {
  const named = annotatedRefusal(check.annotations);
  if (named !== undefined) return named;
  const identifier = checkIdentifier(check);
  if (identifier !== undefined && TOO_LARGE_CHECKS.has(identifier)) {
    return SCHEMA_REFUSAL.TOO_LARGE;
  }
  return SCHEMA_REFUSAL.MALFORMED;
}

/**
 * The first refusal in a parse issue, as the builder reports one: the word
 * the failed rule earns and the record keys and array indices down to it,
 * outermost first. A wrong type, a missing key, an unlisted key, and a
 * literal outside its set are each malformed; a built-in maximum is too
 * large; and a node carrying its own refusal annotation answers that word
 * wherever it fails — a check, a transformation's decode, a type check, or a
 * union none of whose members admitted the value — at the path of the node
 * itself. A transformation that failed with an issue of its own and names no
 * word is read through to that issue, so a decode that ran another schema
 * inside it reports where that schema refused.
 */
function refusalOf(issue: SchemaIssue.Issue, path: SchemaPath): SchemaRefusalError {
  switch (issue._tag) {
    case "Pointer":
      return refusalOf(issue.issue, [...path, ...pathSegments(issue.path)]);
    case "Composite": {
      const named = nodeRefusal(issue.ast);
      return named === undefined
        ? refusalOf(issue.issues[0], path)
        : new SchemaRefusalError({ refusal: named, path });
    }
    case "AnyOf": {
      const named = nodeRefusal(issue.ast);
      if (named !== undefined) return new SchemaRefusalError({ refusal: named, path });
      const first = issue.issues[0];
      return first === undefined
        ? new SchemaRefusalError({ refusal: SCHEMA_REFUSAL.MALFORMED, path })
        : refusalOf(first, path);
    }
    case "Filter":
      return new SchemaRefusalError({ refusal: checkRefusal(issue.filter), path });
    case "Encoding": {
      const named = nodeRefusal(issue.ast);
      return named === undefined
        ? refusalOf(issue.issue, path)
        : new SchemaRefusalError({ refusal: named, path });
    }
    case "InvalidType":
      return new SchemaRefusalError({
        refusal: nodeRefusal(issue.ast) ?? SCHEMA_REFUSAL.MALFORMED,
        path,
      });
    case "UnexpectedKey":
      return new SchemaRefusalError({
        refusal: nodeRefusal(issue.ast) ?? SCHEMA_REFUSAL.MALFORMED,
        path,
      });
    case "InvalidValue":
    case "Forbidden":
      return new SchemaRefusalError({
        refusal: annotatedRefusal(issue.annotations) ?? SCHEMA_REFUSAL.MALFORMED,
        path,
      });
    case "MissingKey":
    case "OneOf":
      return new SchemaRefusalError({ refusal: SCHEMA_REFUSAL.MALFORMED, path });
  }
}

/**
 * Reads a wire value against a schema, answering the value or the refusal.
 * The read is strict the way a builder record is: a key the declaration does
 * not name is refused, and the first refusal is the one reported, because a
 * caller can action on one word and one path. A family of answers a newer
 * service may have widened is read with `excess` set to drop instead, which is
 * where that tolerance now stands: v4 settles parse options at the read, and a
 * declaration carries none of its own.
 */
export const readEither =
  <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    options?: { readonly excess?: ExcessKeys },
  ) =>
  (value: UnparsedWireValue): Result.Result<S["Type"], SchemaRefusalError> => {
    const decoded = Schema.decodeUnknownResult(schema, {
      errors: "first",
      onExcessProperty: options?.excess ?? EXCESS_KEYS.REFUSE,
    })(value);
    return Result.mapError(decoded, (error) => refusalOf(error.issue, []));
  };

/**
 * The Effect declaration of a wire reader: a rule no combinator holds, decoded
 * by the reader's own code and shown as the node declared beside it. The
 * reader's refusal travels as the issue {@link refusalIssue} writes, so a
 * read through {@link readEither} answers the word and path the reader
 * decided; nothing encodes, because a wire reader only ever reads.
 */
export function declareReader<Value>(
  read: (value: UnparsedWireValue) => SchemaRead<Value>,
  node: JsonSchemaNode,
): Schema.Codec<Value, UnparsedWireValue> {
  const declaration = Schema.declareConstructor<Value, UnparsedWireValue>()(
    [],
    () => (input: unknown) => {
      // SAFETY: a decode is handed the value `readEither` took as an `UnparsedWireValue`, erased to
      // `unknown` by Effect's own decode signature; the reader is the boundary's own defensive parser.
      const value = input as UnparsedWireValue;
      const result = read(value);
      return result.ok
        ? Effect.succeed(result.value)
        : Effect.fail(refusalIssue(result.refusal, result.path, value));
    },
  );
  return verbatimJsonSchema(declaration, node);
}

const REFUSAL_AST = {
  [SCHEMA_REFUSAL.MALFORMED]: Schema.Unknown.annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED)).ast,
  [SCHEMA_REFUSAL.TOO_LARGE]: Schema.Unknown.annotate(wireRefusal(SCHEMA_REFUSAL.TOO_LARGE)).ast,
  [SCHEMA_REFUSAL.NOT_REGISTERED]: Schema.Unknown.annotate(
    wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED),
  ).ast,
} satisfies { readonly [Refusal in SchemaRefusal]: SchemaAST.AST };

/**
 * The issue {@link readEither} reads back as exactly this refusal at this
 * path: the inverse of the reading above, for a declaration whose own reader
 * has already decided both and fails its decode with what it decided.
 */
function refusalIssue(
  refusal: SchemaRefusal,
  path: SchemaPath,
  actual: unknown,
): SchemaIssue.Issue {
  const issue = new SchemaIssue.InvalidType(REFUSAL_AST[refusal], actual);
  return Arr.isReadonlyArrayNonEmpty(path) ? new SchemaIssue.Pointer(path, issue) : issue;
}
