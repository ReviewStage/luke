import {
  Array as Arr,
  Data,
  Effect,
  Option,
  Result,
  Schema,
  SchemaAST,
  SchemaIssue,
  SchemaTransformation,
  type StandardSchema,
} from "effect";
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

const WIRE_ANNOTATION = {
  DESCRIPTION: "@repo/wire/effect/WireDescription",
  REFUSAL: "@repo/wire/effect/WireRefusal",
  JSON_SCHEMA: "@repo/wire/effect/WireJsonSchema",
} as const;

const readDescription = Schema.decodeUnknownOption(Schema.String);
const readRefusal = Schema.decodeUnknownOption(Schema.Literals(Object.values(SCHEMA_REFUSAL)));

export const describeWire = <S extends Schema.Top>(schema: S, description: string): S["Rebuild"] =>
  schema.annotate({ [WIRE_ANNOTATION.DESCRIPTION]: description });

export const wireRefusal = (refusal: SchemaRefusal) => ({ [WIRE_ANNOTATION.REFUSAL]: refusal });

export const verbatimJsonSchema = <S extends Schema.Top>(
  schema: S,
  node: JsonSchemaNode,
): S["Rebuild"] => schema.annotate({ [WIRE_ANNOTATION.JSON_SCHEMA]: node });

type WireKeyedFields<F extends Schema.Struct.Fields, M extends WireKeyMapping<F>> = {
  [K in keyof F as K extends keyof M ? (M[K] extends string ? M[K] : K) : K]: F[K];
};

type WireKeyMapping<F extends Schema.Struct.Fields> = { readonly [K in keyof F]?: string };

const renamed =
  <From extends object, To>(names: Readonly<Record<string, string | undefined>>) =>
  (value: From): To =>
    Object.fromEntries(
      Object.entries(value).map(([key, field]) => [names[key] ?? key, field]),
    ) as To;

export const wireKeys =
  <F extends Schema.Struct.Fields, const M extends WireKeyMapping<F>>(mapping: M) =>
  (self: Schema.Struct<F>) => {
    const toWire: Record<string, string | undefined> = mapping;
    const fromWire: Record<string, string> = {};
    for (const [key, wireKey] of Object.entries(toWire)) {
      if (wireKey !== undefined) fromWire[wireKey] = key;
    }
    const onWire = Object.fromEntries(
      Object.entries(self.fields).map(([key, field]) => [toWire[key] ?? key, field]),
    );
    if (Object.keys(onWire).length !== Object.keys(self.fields).length) {
      throw new Error(`wireKeys: two fields travel under one key in ${JSON.stringify(toWire)}`);
    }
    const wire = Schema.Struct(onWire as WireKeyedFields<F, M>);
    type Read = Schema.Struct<F>["Type"];
    type OnWire = (typeof wire)["Type"];
    const renaming = SchemaTransformation.transform<Read, OnWire>({
      decode: renamed<OnWire, Read>(fromWire),
      encode: renamed<Read, OnWire>(toWire),
    });
    return wire.pipe(Schema.decodeTo(Schema.toType(self), renaming));
  };

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

const EFFECT_CHECK = {
  MIN_LENGTH: "effect/schema/isMinLength",
  MAX_LENGTH: "effect/schema/isMaxLength",
  GREATER_THAN_OR_EQUAL_TO: "effect/schema/isGreaterThanOrEqualTo",
  LESS_THAN_OR_EQUAL_TO: "effect/schema/isLessThanOrEqualTo",
  INT: "effect/schema/isInt",
} as const;

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

const TOO_LARGE_CHECKS: ReadonlySet<string> = new Set([
  EFFECT_CHECK.MAX_LENGTH,
  EFFECT_CHECK.LESS_THAN_OR_EQUAL_TO,
]);

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

type Draft<Node> = { -readonly [Key in keyof Node]: Node[Key] };

type StringNodeDraft = Draft<Extract<JsonSchemaNode, { type: "string" }>>;
type NumberNodeDraft = Draft<Extract<JsonSchemaNode, { type: "number" | "integer" }>>;
type ArrayNodeDraft = Draft<Extract<JsonSchemaNode, { type: "array" }>>;

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
  const { minLength, maxLength } = takeBounds(ast, bounds, ["minLength", "maxLength"]);
  const node: ArrayNodeDraft = { type: "array", items };
  if (minLength !== undefined) node.minItems = minLength;
  if (maxLength !== undefined) node.maxItems = maxLength;
  return node;
}

function literalNode(ast: SchemaAST.Literal): JsonSchemaNode {
  const { literal } = ast;
  if (isString(literal)) return { type: "string", enum: [literal] };
  if (isNumber(literal)) {
    return { type: Number.isSafeInteger(literal) ? "integer" : "number", enum: [literal] };
  }
  if (isBoolean(literal)) return { type: "boolean", enum: [literal] };
  throw unshowable(ast, "a bigint has no wire form");
}

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

export function emitJsonSchema(schema: Schema.Top): JsonSchemaNode {
  return emit(schema.ast, NOTHING_GATHERED, new Set());
}

export type StandardSchemaWithJson<S extends Schema.Top> = StandardSchema.StandardSchemaV1<
  S["Encoded"],
  S["Type"]
> &
  StandardSchema.StandardJSONSchemaV1<S["Encoded"], S["Type"]>;

export function standardSchemaOf<S extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
  schema: S,
): StandardSchemaWithJson<S> {
  const node = emitJsonSchema(schema);
  const standard = Schema.toStandardSchemaV1(schema, {
    parseOptions: { onExcessProperty: EXCESS_KEYS.REFUSE },
  });
  return {
    "~standard": {
      ...standard["~standard"],
      jsonSchema: { input: () => node, output: () => node },
    },
  };
}

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

export function declareReader<Value>(
  read: (value: UnparsedWireValue) => SchemaRead<Value>,
  node: JsonSchemaNode,
): Schema.Codec<Value, UnparsedWireValue> {
  const declaration = Schema.declareConstructor<Value, UnparsedWireValue>()(
    [],
    () => (input: unknown) => {
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

function refusalIssue(
  refusal: SchemaRefusal,
  path: SchemaPath,
  actual: unknown,
): SchemaIssue.Issue {
  const issue = new SchemaIssue.InvalidType(REFUSAL_AST[refusal], actual);
  return Arr.isReadonlyArrayNonEmpty(path) ? new SchemaIssue.Pointer(path, issue) : issue;
}
