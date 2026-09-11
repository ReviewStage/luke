import { Array as Arr, Data, Either, Option, ParseResult, Schema, SchemaAST } from "effect";
import type { UnparsedWireValue } from "../json.js";
import {
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
 * `JSONSchema.make` is never called: its output is a different dialect with
 * different keys in a different order, and these bytes are prompt-cache bytes,
 * held still by the goldens under every package's `fixtures/json-schema/`.
 *
 * Nothing here reads Effect's own `title` and `description` annotations,
 * because Effect writes them on every primitive and every built-in filter
 * (`Schema.String` says "a string", `minLength(1)` says "a string at least 1
 * character(s) long"), so a sentence a model is shown has to be one wire was
 * handed on purpose, under wire's own annotation. The same goes for the
 * refusal a failed rule earns and for a node declared verbatim beside a
 * reader: each is wire's own annotation, set through the helpers below and
 * read nowhere else.
 *
 * A declaration the wire cannot show — a class, a symbol, a tuple with
 * positions, an index signature, a bound on a kind of node that cannot carry
 * it — throws at emission, which is the builder's own rule: a value is never
 * thrown at, and a schema declared with rules that contradict each other does
 * not ship.
 */

/** The sentence a node carries as its `description`. */
export const WireDescriptionAnnotationId: unique symbol = Symbol.for(
  "@sidecar/wire/effect/WireDescription",
);

/** Which {@link SchemaRefusal} a failed refinement or transformation answers; set by {@link wireRefusal}. */
const WireRefusalAnnotationId: unique symbol = Symbol.for("@sidecar/wire/effect/WireRefusal");

/**
 * A node declared beside its reader and emitted as written, for the one kind
 * of rule no combinator can express: the `s.reader` of the builder. Set by
 * {@link verbatimJsonSchema}.
 */
const WireJsonSchemaAnnotationId: unique symbol = Symbol.for("@sidecar/wire/effect/WireJsonSchema");

const readDescription = Schema.decodeUnknownOption(Schema.String);
const readRefusal = Schema.decodeUnknownOption(Schema.Literal(...Object.values(SCHEMA_REFUSAL)));

/** Carries `description` into the emitted node, the way the builder's `describe` does. */
export const describeWire = <S extends Schema.Annotable.All>(
  schema: S,
  description: string,
): Schema.Annotable.Self<S> => schema.annotations({ [WireDescriptionAnnotationId]: description });

/** The annotation a `Schema.filter` or transformation carries to name the refusal its failure earns. */
export const wireRefusal = (refusal: SchemaRefusal) => ({ [WireRefusalAnnotationId]: refusal });

/** Declares the node a schema emits, verbatim, in place of anything its AST would say. */
export const verbatimJsonSchema = <S extends Schema.Annotable.All>(
  schema: S,
  node: JsonSchemaNode,
): Schema.Annotable.Self<S> => schema.annotations({ [WireJsonSchemaAnnotationId]: node });

/** Every bound a recognized refinement can add to the node beneath it. */
interface Bounds {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly integer?: true;
}

type BoundKey = keyof Bounds;

type BoundReader = (payload: unknown) => Option.Option<Bounds>;

const boundReader = <A extends Bounds, I>(payload: Schema.Schema<A, I>): BoundReader => {
  const read = Schema.decodeUnknownOption(payload);
  return (annotation) => read(annotation);
};

const INTEGER: Bounds = { integer: true };

/**
 * The refinements whose bound the node carries, by the schema id Effect's own
 * filters annotate themselves with, each read from the `jsonSchema` annotation
 * the same filter writes. Any other refinement is a rule the node cannot say —
 * a uniqueness, a field bounded by another — and emits the node beneath it,
 * exactly as the builder's `refine` does.
 */
const BOUND_READERS = new Map<symbol, BoundReader>([
  [Schema.MinLengthSchemaId, boundReader(Schema.Struct({ minLength: Schema.Number }))],
  [Schema.MaxLengthSchemaId, boundReader(Schema.Struct({ maxLength: Schema.Number }))],
  [
    Schema.LengthSchemaId,
    boundReader(Schema.Struct({ minLength: Schema.Number, maxLength: Schema.Number })),
  ],
  [Schema.GreaterThanOrEqualToSchemaId, boundReader(Schema.Struct({ minimum: Schema.Number }))],
  [Schema.LessThanOrEqualToSchemaId, boundReader(Schema.Struct({ maximum: Schema.Number }))],
  [
    Schema.BetweenSchemaId,
    boundReader(Schema.Struct({ minimum: Schema.Number, maximum: Schema.Number })),
  ],
  [Schema.MinItemsSchemaId, boundReader(Schema.Struct({ minItems: Schema.Number }))],
  [Schema.MaxItemsSchemaId, boundReader(Schema.Struct({ maxItems: Schema.Number }))],
  [
    Schema.ItemsCountSchemaId,
    boundReader(Schema.Struct({ minItems: Schema.Number, maxItems: Schema.Number })),
  ],
  [Schema.IntSchemaId, () => Option.some(INTEGER)],
]);

/**
 * The bounds whose failure reads as too large rather than malformed, which is
 * the builder's rule for a `max`: a text past its bound, an array past its
 * count, a number above its maximum. Below a minimum is malformed — a count of
 * minus three is not a count that overflowed — and a refinement carrying its
 * own {@link WireRefusalAnnotationId} says so for itself.
 */
const TOO_LARGE_SCHEMA_IDS: ReadonlySet<symbol> = new Set([
  Schema.MaxLengthSchemaId,
  Schema.LessThanOrEqualToSchemaId,
  Schema.MaxItemsSchemaId,
]);

/** What the walk has gathered above the node it is about to emit. */
interface Gathered {
  readonly description: string | undefined;
  readonly bounds: Bounds;
}

const NOTHING_GATHERED: Gathered = { description: undefined, bounds: {} };

const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
const isBoolean = Schema.is(Schema.Boolean);
const isSymbol = Schema.is(Schema.SymbolFromSelf);

function unshowable(ast: SchemaAST.AST, reason: string): Error {
  return new Error(`The wire cannot show ${String(ast)}: ${reason}.`);
}

function gatherDescription(annotated: SchemaAST.Annotated, gathered: Gathered): Gathered {
  if (gathered.description !== undefined) return gathered;
  const description = readDescription(annotated.annotations[WireDescriptionAnnotationId]);
  return Option.isNone(description) ? gathered : { ...gathered, description: description.value };
}

function gatherBounds(refinement: SchemaAST.Refinement, gathered: Gathered): Gathered {
  const schemaId = SchemaAST.getSchemaIdAnnotation(refinement);
  if (Option.isNone(schemaId) || !isSymbol(schemaId.value)) return gathered;
  const reader = BOUND_READERS.get(schemaId.value);
  if (reader === undefined) return gathered;
  const bounds = reader(refinement.annotations[SchemaAST.JSONSchemaAnnotationId]);
  if (Option.isNone(bounds)) {
    throw unshowable(refinement, "its bound annotation does not carry the bound its id names");
  }
  for (const key of Object.keys(bounds.value)) {
    if (Object.hasOwn(gathered.bounds, key)) {
      throw unshowable(refinement, `${key} is declared twice`);
    }
  }
  return { ...gathered, bounds: { ...gathered.bounds, ...bounds.value } };
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
 * `maxLength`. The order is fixed here rather than by the order the filters
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

function arrayNode(ast: SchemaAST.AST, items: JsonSchemaNode, bounds: Bounds): JsonSchemaNode {
  const { minItems, maxItems } = takeBounds(ast, bounds, ["minItems", "maxItems"]);
  const node: ArrayNodeDraft = { type: "array", items };
  if (minItems !== undefined) node.minItems = minItems;
  if (maxItems !== undefined) node.maxItems = maxItems;
  return node;
}

/**
 * A literal's node names the one value it admits, not merely its type, and a
 * number that is a safe integer is an `integer`: both are the builder's rules.
 */
function literalNode(ast: SchemaAST.Literal): JsonSchemaNode {
  const { literal } = ast;
  if (literal === null) return { type: "null" };
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
 * `enum` to join.
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
  const literals = members.flatMap((member) =>
    SchemaAST.isLiteral(member) ? [member.literal] : [],
  );
  if (literals.length === members.length) {
    const asEnum = enumNode(literals);
    if (asEnum !== undefined) return asEnum;
  }
  return { anyOf: members.map((member) => emit(member, NOTHING_GATHERED, visiting)) };
}

/**
 * An optional property's type, with the `undefined` an inexact `Schema.optional`
 * adds taken back out: the builder's `optional` emits the inner node, because
 * a JSON value is never `undefined` and the key's absence is what `required`
 * already says.
 */
function propertyType(type: SchemaAST.AST): SchemaAST.AST {
  if (!SchemaAST.isUnion(type)) return type;
  const defined = type.types.filter((member) => !SchemaAST.isUndefinedKeyword(member));
  return defined.length === type.types.length
    ? type
    : SchemaAST.Union.make(defined, type.annotations);
}

function objectNode(
  ast: SchemaAST.TypeLiteral,
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
    properties.push([
      signature.name,
      emit(propertyType(signature.type), gatherDescription(signature, NOTHING_GATHERED), visiting),
    ]);
    if (!signature.isOptional) required.push(signature.name);
  }
  return {
    type: "object",
    properties: Object.fromEntries(properties),
    required,
    additionalProperties: false,
  };
}

function tupleNode(
  ast: SchemaAST.TupleType,
  bounds: Bounds,
  visiting: Set<SchemaAST.AST>,
): JsonSchemaNode {
  const [rest, ...more] = ast.rest;
  if (ast.elements.length > 0 || rest === undefined || more.length > 0) {
    throw unshowable(ast, "only an array of one item type has a wire form");
  }
  return arrayNode(ast, emit(rest.type, NOTHING_GATHERED, visiting), bounds);
}

function emit(ast: SchemaAST.AST, above: Gathered, visiting: Set<SchemaAST.AST>): JsonSchemaNode {
  const gathered = gatherDescription(ast, above);
  const verbatim = SchemaAST.getAnnotation<JsonSchemaNode>(WireJsonSchemaAnnotationId)(ast);
  if (Option.isSome(verbatim)) {
    takeBounds(ast, gathered.bounds, []);
    return withDescription(verbatim.value, gathered.description);
  }
  switch (ast._tag) {
    case "Refinement":
      return emit(ast.from, gatherBounds(ast, gathered), visiting);
    case "Transformation":
      return emit(ast.from, gathered, visiting);
    case "Suspend": {
      if (visiting.has(ast)) throw unshowable(ast, "a recursive declaration has no finite node");
      visiting.add(ast);
      const node = emit(ast.f(), gathered, visiting);
      visiting.delete(ast);
      return node;
    }
    case "StringKeyword":
      return withDescription(stringNode(ast, gathered.bounds), gathered.description);
    case "NumberKeyword":
      return withDescription(numberNode(ast, gathered.bounds), gathered.description);
    case "BooleanKeyword":
      takeBounds(ast, gathered.bounds, []);
      return withDescription({ type: "boolean" }, gathered.description);
    case "Literal":
      takeBounds(ast, gathered.bounds, []);
      return withDescription(literalNode(ast), gathered.description);
    case "Union":
      return withDescription(unionNode(ast, gathered.bounds, visiting), gathered.description);
    case "TypeLiteral":
      return withDescription(objectNode(ast, gathered.bounds, visiting), gathered.description);
    case "TupleType":
      return withDescription(tupleNode(ast, gathered.bounds, visiting), gathered.description);
    default:
      throw unshowable(ast, `a ${ast._tag} has no wire form`);
  }
}

/** The JSON Schema node a model is shown for this declaration. */
export function emitJsonSchema(schema: Schema.Schema.All): JsonSchemaNode {
  return emit(schema.ast, NOTHING_GATHERED, new Set());
}

/** Why a value was refused and where, as the one error a wire read fails with. */
export class SchemaRefusalError extends Data.TaggedError("SchemaRefusalError")<{
  readonly refusal: SchemaRefusal;
  readonly path: SchemaPath;
}> {}

const isPathSegment = Schema.is(Schema.Union(Schema.String, Schema.Number));

function pathSegments(path: ParseResult.Path): SchemaPath {
  const keys = Array.isArray(path) ? path : [path];
  return keys.map((key) => (isPathSegment(key) ? key : String(key)));
}

function annotatedRefusal(annotated: SchemaAST.Annotated): SchemaRefusal | undefined {
  return Option.getOrUndefined(readRefusal(annotated.annotations[WireRefusalAnnotationId]));
}

function refinementRefusal(refinement: SchemaAST.Refinement): SchemaRefusal {
  const named = annotatedRefusal(refinement);
  if (named !== undefined) return named;
  const schemaId = SchemaAST.getSchemaIdAnnotation(refinement);
  if (
    Option.isSome(schemaId) &&
    isSymbol(schemaId.value) &&
    TOO_LARGE_SCHEMA_IDS.has(schemaId.value)
  ) {
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
 * wherever it fails — a refinement's predicate, a transformation's decode, a
 * type check, or a union none of whose members admitted the value — at the
 * path of the node itself. A transformation that failed with an issue of its
 * own and names no word is read through to that issue, so a decode that ran
 * another schema inside it reports where that schema refused.
 */
function refusalOf(issue: ParseResult.ParseIssue, path: SchemaPath): SchemaRefusalError {
  switch (issue._tag) {
    case "Pointer":
      return refusalOf(issue.issue, [...path, ...pathSegments(issue.path)]);
    case "Composite": {
      const named = annotatedRefusal(issue.ast);
      return named === undefined
        ? refusalOf(Array.isArray(issue.issues) ? issue.issues[0] : issue.issues, path)
        : new SchemaRefusalError({ refusal: named, path });
    }
    case "Refinement":
      return issue.kind === "From"
        ? refusalOf(issue.issue, path)
        : new SchemaRefusalError({ refusal: refinementRefusal(issue.ast), path });
    case "Transformation": {
      if (issue.kind !== "Transformation") return refusalOf(issue.issue, path);
      const named = annotatedRefusal(issue.ast);
      return named === undefined
        ? refusalOf(issue.issue, path)
        : new SchemaRefusalError({ refusal: named, path });
    }
    case "Type":
      return new SchemaRefusalError({
        refusal: annotatedRefusal(issue.ast) ?? SCHEMA_REFUSAL.MALFORMED,
        path,
      });
    case "Missing":
    case "Unexpected":
    case "Forbidden":
      return new SchemaRefusalError({ refusal: SCHEMA_REFUSAL.MALFORMED, path });
  }
}

/**
 * Reads a wire value against a schema, answering the value or the refusal.
 * The read is strict the way a builder record is: a key the declaration does
 * not name is refused, and the first refusal is the one reported, because a
 * caller can action on one word and one path.
 */
export const readEither =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (value: UnparsedWireValue): Either.Either<A, SchemaRefusalError> => {
    const decoded = Schema.decodeUnknownEither(schema, {
      errors: "first",
      onExcessProperty: "error",
    })(value);
    return Either.mapLeft(decoded, (error) => refusalOf(error.issue, []));
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
): Schema.Schema<Value, UnparsedWireValue> {
  const declaration = Schema.declare([], {
    decode: () => (input: unknown) => {
      // SAFETY: a decode is handed the value `readEither` took as an `UnparsedWireValue`, erased to
      // `unknown` by Effect's own decode signature; the reader is the boundary's own defensive parser.
      const value = input as UnparsedWireValue;
      const result = read(value);
      return result.ok
        ? ParseResult.succeed(result.value)
        : ParseResult.fail(refusalIssue(result.refusal, result.path, value));
    },
    encode: () => (input: unknown, _options, ast) =>
      ParseResult.fail(
        new ParseResult.Forbidden(ast, input, "a wire reader decodes and never encodes"),
      ),
  });
  return verbatimJsonSchema(Schema.make<Value, UnparsedWireValue>(declaration.ast), node);
}

const REFUSAL_AST = {
  [SCHEMA_REFUSAL.MALFORMED]: Schema.Unknown.annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED)).ast,
  [SCHEMA_REFUSAL.TOO_LARGE]: Schema.Unknown.annotations(wireRefusal(SCHEMA_REFUSAL.TOO_LARGE)).ast,
  [SCHEMA_REFUSAL.NOT_REGISTERED]: Schema.Unknown.annotations(
    wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED),
  ).ast,
} satisfies { readonly [Refusal in SchemaRefusal]: SchemaAST.AST };

/**
 * The issue {@link readEither} reads back as exactly this refusal at this
 * path: the inverse of the reading above, for a declaration whose own reader
 * has already decided both and fails its decode with what it decided.
 */
export function refusalIssue(
  refusal: SchemaRefusal,
  path: SchemaPath,
  actual: unknown,
): ParseResult.ParseIssue {
  const issue = new ParseResult.Type(REFUSAL_AST[refusal], actual);
  return Arr.isNonEmptyReadonlyArray(path) ? new ParseResult.Pointer(path, actual, issue) : issue;
}

/**
 * A strangler shim: the `SchemaRead` a caller of the builder still holds,
 * written from an `Either`. P12-07 deletes it with `SchemaRead` itself once
 * every caller reads the `Either`.
 */
export function toSchemaRead<A>(read: Either.Either<A, SchemaRefusalError>): SchemaRead<A> {
  return Either.match(read, {
    onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
    onRight: (value) => ({ ok: true, value }),
  });
}
