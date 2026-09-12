import { Schema as EffectSchema, Either, ParseResult, type SchemaAST } from "effect";
import {
  declareReader,
  describeWire,
  emitJsonSchema,
  readEither,
  verbatimJsonSchema,
  wireRefusal,
} from "./effect/json-schema.js";
import { isRecord, type UnparsedWireValue, type WireValue, wholeText } from "./json.js";
import {
  type JsonSchemaNode,
  SCHEMA_REFUSAL,
  type SchemaRead,
  type SchemaRefusal,
} from "./schema-vocabulary.js";

export {
  type JsonSchemaNode,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type SchemaRefusal,
} from "./schema-vocabulary.js";

/**
 * One declaration per wire value, which both parses what arrived and emits
 * the JSON Schema a model is shown for it. A hand-written parser beside a
 * hand-written schema is two statements of the same rule that can drift; a
 * `Schema` is one, so a bound the parser refuses is a bound the schema
 * advertises, and a field the parser never reads is a field no model is
 * offered.
 *
 * Every combinator here constructs an Effect `Schema` and answers for it:
 * `read` is `readEither` over that schema and `jsonSchema` is the emitter
 * walking it, so what a declaration parses and what it shows are one AST.
 * The builder is the strangler facade the migration keeps while callers
 * still hold a `Schema<Value>`; `effectSchema` hands the Effect schema out
 * of one, and P12-08 deletes the facade once every caller declares directly.
 *
 * Nothing here throws at a value: a refusal is a returned word and a path.
 * The one thing that throws is a schema declared with rules that contradict
 * each other, at construction, so a wrong declaration cannot ship.
 */

export interface Schema<Value> {
  /**
   * The value, or the refusal and where it happened. Callers that must tell
   * one refusal from another read this; callers that only care whether the
   * value is admissible use {@link Schema.parse}.
   */
  read(value: UnparsedWireValue): SchemaRead<Value>;
  /** The value, or `undefined` for anything this schema refuses. */
  parse(value: UnparsedWireValue): Value | undefined;
  /** The JSON Schema node a model is shown for this declaration. */
  jsonSchema(): JsonSchemaNode;
  /** This declaration, or absent. Only meaningful as a {@link SchemaFields} entry. */
  optional(): Schema<Value | undefined>;
  /** A human sentence carried into the emitted node's description. Returns a new schema. */
  describe(description: string): Schema<Value>;
  /**
   * The Effect `Schema` this declaration is built over, admitting exactly
   * what `read` admits. Its decoded type is not stated here, because Effect's
   * `Schema` is invariant in it and a `Schema<string>` has to remain a
   * `Schema<unknown>` to every field table; {@link effectSchema} states it.
   */
  readonly effect: EffectSchema.Schema<unknown, UnparsedWireValue>;
}

/** What a declaration decodes from: a JSON value, or none where the declaration admits absence. */
type WireEncoded<Value> = undefined extends Value ? UnparsedWireValue : WireValue;

/** The Effect `Schema` beneath a declaration, typed as the declaration types itself. */
export function effectSchema<Value>(
  schema: Schema<Value>,
): EffectSchema.Schema<Value, WireEncoded<Value>> {
  return EffectSchema.make(schema.effect.ast);
}

export type SchemaFields = { readonly [key: string]: Schema<unknown> };

type FieldValue<Field> = Field extends Schema<infer Value> ? Value : never;

type OptionalFieldKey<Fields extends SchemaFields> = {
  [Key in keyof Fields]-?: undefined extends FieldValue<Fields[Key]> ? Key : never;
}[keyof Fields];

type RequiredFieldKey<Fields extends SchemaFields> = Exclude<
  keyof Fields,
  OptionalFieldKey<Fields>
>;

/** What a field table parses into: optional fields optional, every other key required. */
export type RecordOf<Fields extends SchemaFields> = {
  [Key in RequiredFieldKey<Fields>]: FieldValue<Fields[Key]>;
} & {
  [Key in OptionalFieldKey<Fields>]?: Exclude<FieldValue<Fields[Key]>, undefined>;
};

/** A nominal brand over a parsed value; the emitted node is the inner one's. */
export type Branded<Value, Brand extends string> = Value & { readonly __brand: Brand };

/** The Effect schema a declaration parses with, before its absence is admitted. */
type Core<Value> = EffectSchema.Schema<Value, UnparsedWireValue>;

/**
 * What a declaration was built from. A table rather than fields on
 * {@link Schema}, so `optional` stays the only way a key becomes optional and
 * no caller can declare one by hand or substitute a core of its own.
 */
interface Declared {
  readonly core: EffectSchema.Schema.All;
  readonly absentAdmitted: boolean;
}

const DECLARED = new WeakMap<Schema<unknown>, Declared>();

function declaredOf(schema: Schema<unknown>): Declared {
  const declared = DECLARED.get(schema);
  if (declared === undefined) {
    throw new Error("A schema combined here has to be one this builder declared.");
  }
  return declared;
}

function coreOf<Value>(schema: Schema<Value>): Core<Value> {
  return EffectSchema.make(declaredOf(schema).core.ast);
}

/**
 * The Effect schema an operation answered, under the type the declaration
 * states for it. Every combinator composes an AST whose parse is exactly its
 * rule; the type is the builder's own claim over that AST — `RecordOf` over a
 * struct assembled from a field table, a nominal brand over an unchanged
 * node, a mapping's result — which `Schema.make` states over the AST alone.
 */
function over<Value>(schema: EffectSchema.Schema.All): Core<Value> {
  return EffectSchema.make(schema.ast);
}

/**
 * The declaration over its core. An absent-admitted one reads through the
 * core or `undefined`, and still shows the core's node alone, because a JSON
 * value is never `undefined` and a key's absence is what a record's `required`
 * already says.
 */
function schemaOver<Value>(core: Core<Value>, absentAdmitted = false): Schema<Value> {
  const admitting: Core<Value> = absentAdmitted
    ? over<Value>(EffectSchema.UndefinedOr(core))
    : core;
  const read = readEither(admitting);
  const schema: Schema<Value> = {
    effect: EffectSchema.make(admitting.ast),
    read: (value) =>
      Either.match(read(value), {
        onLeft: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onRight: (value) => ({ ok: true, value }),
      }),
    parse(value) {
      const result = schema.read(value);
      return result.ok ? result.value : undefined;
    },
    jsonSchema: () => emitJsonSchema(core),
    optional: () =>
      absentAdmitted ? schema : schemaOver<Value | undefined>(over<Value | undefined>(core), true),
    describe: (description) => schemaOver<Value>(describeWire(core, description), absentAdmitted),
  };
  DECLARED.set(schema, { core, absentAdmitted });
  return schema;
}

function admit<Value>(value: Value): SchemaRead<Value> {
  return { ok: true, value };
}

/** What a text longer than its bound earns. */
export const TEXT_OVERFLOW = {
  REFUSE: "refuse",
  ELLIPSIS: "ellipsis",
} as const;

export type TextOverflow = (typeof TEXT_OVERFLOW)[keyof typeof TEXT_OVERFLOW];

/** What becomes of the whitespace at a text's ends. */
export const TEXT_ENDS = {
  TRIM: "trim",
  KEEP: "keep",
} as const;

export type TextEnds = (typeof TEXT_ENDS)[keyof typeof TEXT_ENDS];

/** What every combinator takes: the sentence its node carries, and nothing else. */
export interface DescribedOptions {
  description?: string;
}

function described<Value>(core: Core<Value>, description: string | undefined): Core<Value> {
  return description === undefined ? core : describeWire(core, description);
}

/** A bounded text whose bound refuses rather than cuts. */
export interface BoundedTextOptions extends DescribedOptions {
  max?: number;
}

export interface TextOptions extends DescribedOptions {
  /**
   * The most characters the text may carry, counted as JavaScript counts
   * them, because every byte budget derived from a character bound in this
   * build (a prompt's 600 KiB as UTF-8, for one) is derived from that count.
   */
  max?: number;
  /** Collapse newlines and runs of spaces to single spaces and trim. */
  oneLine?: boolean;
  /** What a value past `max` earns; `ELLIPSIS` is legal only for a bounded one-line text. */
  overflow?: TextOverflow;
  /** Whether the ends are trimmed or the text is admitted as written. */
  ends?: TextEnds;
  /** Admit a text of nothing but whitespace. */
  allowEmpty?: boolean;
}

type Text = EffectSchema.Schema<string, string>;

/** A text settled by a rule of the declaration's, before its bounds are read. */
function settledText(settle: (value: string) => string): Text {
  return EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: settle,
    encode: (value) => value,
  });
}

/**
 * A text of nothing but whitespace carries nothing. JSON Schema cannot say
 * "not only whitespace", so the rule is shown as `minLength: 1`, a bound
 * necessary rather than sufficient; a bound the parser holds and the node
 * omits would be drift in the direction that misleads a model.
 */
function nonBlank(text: Text): Text {
  return text.pipe(
    EffectSchema.filter((value) => value.trim().length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
  );
}

function textSchema(options: TextOptions = {}): Schema<string> {
  const { max, description } = options;
  const collapse = options.oneLine === true;
  const overflow = options.overflow ?? TEXT_OVERFLOW.REFUSE;
  const ends = options.ends ?? TEXT_ENDS.TRIM;
  const allowEmpty = options.allowEmpty === true;
  if (overflow === TEXT_OVERFLOW.ELLIPSIS && (!collapse || max === undefined || max < 1)) {
    throw new Error(
      "A text may only be cut with an ellipsis when it is collapsed to one line under a bound of at least one character: cutting a value that keeps its lines makes it say something its author did not, and the ellipsis takes a character of the bound it has to fit inside.",
    );
  }
  if (collapse && options.ends !== undefined) {
    throw new Error(
      "A one-line text settles both its ends by collapsing, so declaring `ends` beside `oneLine` states a rule that would never be read.",
    );
  }
  let core: Text = settledText((value) => {
    const collapsed = collapse ? value.replace(/\s+/gu, " ") : value;
    const normalized = collapse || ends === TEXT_ENDS.TRIM ? collapsed.trim() : collapsed;
    return overflow === TEXT_OVERFLOW.ELLIPSIS && max !== undefined && normalized.length > max
      ? `${normalized.slice(0, max - 1).trimEnd()}…`
      : normalized;
  });
  if (!allowEmpty) core = nonBlank(core);
  if (max !== undefined) core = core.pipe(EffectSchema.maxLength(max));
  return schemaOver(described(over<string>(core), description));
}

/**
 * Multi-line text whose whole words are the point of reporting it, settled
 * the way `wholeText` settles it. `max` refuses, never cuts.
 */
function wholeTextSchema(options: BoundedTextOptions = {}): Schema<string> {
  const { max, description } = options;
  let core: Text = settledText((value) => wholeText(value) ?? "").pipe(EffectSchema.minLength(1));
  if (max !== undefined) core = core.pipe(EffectSchema.maxLength(max));
  return schemaOver(described(over<string>(core), description));
}

export interface NumberOptions extends DescribedOptions {
  /**
   * The least the number may be. Below it is malformed rather than too large:
   * a count of minus three is not a count that overflowed, it is not a count.
   */
  minimum?: number;
  /** The most the number may be. Above it is the one bound that reads as too large. */
  maximum?: number;
}

function boundedNumber(options: NumberOptions, whole: boolean): Schema<number> {
  const { minimum, maximum, description } = options;
  let core: EffectSchema.Schema<number, number> = EffectSchema.Number.pipe(EffectSchema.finite());
  if (whole) core = core.pipe(EffectSchema.int());
  if (minimum !== undefined) core = core.pipe(EffectSchema.greaterThanOrEqualTo(minimum));
  if (maximum !== undefined) core = core.pipe(EffectSchema.lessThanOrEqualTo(maximum));
  return schemaOver(described(over<number>(core), description));
}

function booleanSchema(options: DescribedOptions = {}): Schema<boolean> {
  return schemaOver(described(over<boolean>(EffectSchema.Boolean), options.description));
}

/**
 * A literal's node names the one value it admits, not merely its type: a
 * field that must be exactly `2` advertised as an integer would offer a model
 * every other integer, which is the drift these declarations exist to close.
 */
function literalSchema<const Literal extends string | number | boolean | null>(
  literal: Literal,
  options: DescribedOptions = {},
): Schema<Literal> {
  return schemaOver(described(over<Literal>(EffectSchema.Literal(literal)), options.description));
}

export interface EnumOptions extends DescribedOptions {
  /**
   * Whether the ends are settled before membership is read, the way `text`
   * settles them. `KEEP` by default, because a request field naming one of a
   * fixed set is stated exactly or not at all; an answer whose reader has
   * always trimmed says `TRIM` rather than tightening what it admits.
   */
  ends?: TextEnds;
}

/**
 * A member set is a union of literals, which the emitter shows as one `enum`.
 * A set read with its ends trimmed settles the text ahead of the membership
 * test, and the node is declared beside it, because what the emitter shows
 * for a transformation is the text it decodes from.
 */
function enumSchema<const Member extends string>(
  members: readonly Member[],
  options: EnumOptions = {},
): Schema<Member> {
  const literals = EffectSchema.Literal(...members);
  const core =
    options.ends === TEXT_ENDS.TRIM
      ? verbatimJsonSchema(
          EffectSchema.transform(EffectSchema.String, literals, {
            strict: false,
            decode: (value) => value.trim(),
            encode: (value) => value,
          }),
          { type: "string", enum: members },
        )
      : literals;
  return schemaOver(described(over<Member>(core), options.description));
}

export interface ArrayOptions extends DescribedOptions {
  /** The most entries the array may carry; past it is too large. */
  max?: number;
  /** The fewest entries it may carry; below it is malformed, as a number's minimum is. */
  minimum?: number;
  /** Drop a refused entry instead of refusing the array. */
  skipRefused?: boolean;
}

/**
 * The entries of an array that drops a refused one: each is read forgivingly,
 * and the entries that were dropped are then taken out of the count.
 */
function keptEntries<Value>(item: Core<Value>): Core<Value[]> {
  const forgiving = EffectSchema.Array(droppedCore(item));
  return over<Value[]>(
    EffectSchema.transform(forgiving, EffectSchema.Unknown, {
      strict: false,
      decode: (entries) => entries.filter((entry) => entry !== undefined),
      encode: (entries) => entries,
    }),
  );
}

function arraySchema<Value>(item: Schema<Value>, options: ArrayOptions = {}): Schema<Value[]> {
  const { max, minimum, description } = options;
  const itemCore = coreOf(item);
  const entries =
    options.skipRefused === true ? keptEntries(itemCore) : EffectSchema.Array(itemCore);
  // A bound on the count is read before any entry is, and it counts the entries that arrived:
  // `max` is declared over the arriving array and composed ahead of the entries, and the node
  // the arriving entries show is the item's own. `minimum` follows the entries instead, since
  // with `skipRefused` the count that has to clear it is the one admitted.
  let core: EffectSchema.Schema.All =
    max === undefined
      ? entries
      : EffectSchema.compose(
          EffectSchema.Array(verbatimJsonSchema(EffectSchema.Unknown, item.jsonSchema())).pipe(
            EffectSchema.maxItems(max),
          ),
          entries,
          { strict: false },
        );
  if (minimum !== undefined) core = core.pipe(EffectSchema.minItems(minimum));
  return schemaOver(described(over<Value[]>(core), description));
}

/** What a record does with a key its field table does not name. */
export const RECORD_EXTRA_KEYS = {
  REFUSE: "refuse",
  IGNORE: "ignore",
} as const;

export type RecordExtraKeys = (typeof RECORD_EXTRA_KEYS)[keyof typeof RECORD_EXTRA_KEYS];

export interface RecordOptions extends DescribedOptions {
  /**
   * Requests refuse a key they did not name; an answer may ignore one a newer
   * service added. The emitted node says `additionalProperties: false` either
   * way, because that is the contract a model is held to and the strict form a
   * function tool's parameters take: `IGNORE` tolerates on the way in what the
   * node still declines to invite.
   */
  extraKeys?: RecordExtraKeys;
}

const EXCESS_PROPERTY = {
  [RECORD_EXTRA_KEYS.REFUSE]: "error",
  [RECORD_EXTRA_KEYS.IGNORE]: "ignore",
} as const satisfies {
  readonly [Rule in RecordExtraKeys]: SchemaAST.ParseOptions["onExcessProperty"];
};

/**
 * A field table as a struct, each field's rule on excess keys carried on the
 * struct itself so a strict record nested in a tolerant one stays strict:
 * Effect hands a struct's parse options down to its fields, and a struct that
 * said nothing would inherit the rule above it.
 */
function structOf(
  entries: readonly (readonly [string, Schema<unknown>])[],
  extraKeys: RecordExtraKeys,
) {
  const properties = Object.fromEntries(
    entries.map(([key, field]) => {
      const { core, absentAdmitted } = declaredOf(field);
      return [key, absentAdmitted ? EffectSchema.optional(core) : core] as const;
    }),
  );
  return EffectSchema.Struct(properties).annotations({
    parseOptions: { onExcessProperty: EXCESS_PROPERTY[extraKeys] },
  });
}

/** Any one of a field table's parsed values, which is what its record's own values are. */
type AdmittedFieldValue<Fields extends SchemaFields> = FieldValue<Fields[keyof Fields]>;

/**
 * The record a struct decoded, rebuilt from the field table's own keys and
 * never from what arrived: an optional field written as `undefined` and a
 * field whose own reader answered nothing are both left out rather than
 * written, exactly as an absent optional key is.
 */
function admittedFields<Fields extends SchemaFields>(
  fields: Fields,
  decoded: { readonly [Key in keyof Fields]?: AdmittedFieldValue<Fields> },
): { readonly [key: string]: AdmittedFieldValue<Fields> } {
  return Object.fromEntries(
    Object.keys(fields).flatMap((key) => {
      const value = decoded[key];
      return Object.hasOwn(decoded, key) && value !== undefined ? [[key, value] as const] : [];
    }),
  );
}

function recordSchema<Fields extends SchemaFields>(
  fields: Fields,
  options: RecordOptions = {},
): Schema<RecordOf<Fields>> {
  const entries = Object.entries(fields);
  const extraKeys = options.extraKeys ?? RECORD_EXTRA_KEYS.REFUSE;
  const struct = structOf(entries, extraKeys);
  // Effect reads a struct out of any object and admits any non-null value for a struct with no
  // fields, where a record here is a plain object and nothing else; the arriving value is read
  // again for that, and a fieldless record checks its own keys, since Effect checks none for it.
  const core = EffectSchema.transformOrFail(struct, EffectSchema.Unknown, {
    strict: false,
    decode: (decoded, _options, ast, arrived) => {
      if (!isRecord(arrived)) return ParseResult.fail(new ParseResult.Type(ast, arrived));
      if (entries.length === 0 && extraKeys === RECORD_EXTRA_KEYS.REFUSE) {
        const [unexpected] = Object.keys(arrived);
        if (unexpected !== undefined) {
          return ParseResult.fail(
            new ParseResult.Pointer(
              unexpected,
              arrived,
              new ParseResult.Unexpected(arrived[unexpected]),
            ),
          );
        }
      }
      return ParseResult.succeed(admittedFields(fields, decoded));
    },
    encode: (value) => ParseResult.succeed(value),
  });
  return schemaOver(described(over<RecordOf<Fields>>(core), options.description));
}

/**
 * A union admits the first member that reads the value and shows an `anyOf`
 * of its members. A value no member admits is malformed at the union itself:
 * which member came closest is not a fact the union states, so the refusal
 * is the union's own word rather than the first member's.
 */
function unionSchema<const Members extends readonly Schema<unknown>[]>(
  members: Members,
  options: DescribedOptions = {},
): Schema<FieldValue<Members[number]>> {
  const core = EffectSchema.Union(...members.map((member) => declaredOf(member).core)).annotations(
    wireRefusal(SCHEMA_REFUSAL.MALFORMED),
  );
  return schemaOver(described(over<FieldValue<Members[number]>>(core), options.description));
}

/**
 * A nominal brand over a parsed value. The brand is carried by the type
 * parameter alone, which the second argument is there to infer; nothing about
 * the value or its schema changes, so nothing reads it at run time.
 */
function brandSchema<Value, Brand extends string>(
  inner: Schema<Value>,
  _brand: Brand,
): Schema<Branded<Value, Brand>> {
  return schemaOver(over<Branded<Value, Brand>>(coreOf(inner)));
}

/**
 * A value admitted only if a registry the schema was built with holds it. The
 * emitted node stays the inner one's: a registry is what this build has
 * registered at run time, not part of the value's declared form, which is why
 * failing it is its own word rather than malformed.
 */
function registeredSchema<Value extends string>(
  inner: Schema<Value>,
  registry: ReadonlySet<string>,
): Schema<Value> {
  return schemaOver(
    over<Value>(
      coreOf(inner).pipe(
        EffectSchema.filter(
          (value) => registry.has(value),
          wireRefusal(SCHEMA_REFUSAL.NOT_REGISTERED),
        ),
      ),
    ),
  );
}

/**
 * A rule no combinator holds, over a value a combinator already parsed: a
 * uniqueness a per-entry schema cannot see, or a field bounded by another
 * field of the same record.
 */
function refineSchema<Value>(
  inner: Schema<Value>,
  admits: (value: Value) => boolean,
  refusal: SchemaRefusal = SCHEMA_REFUSAL.MALFORMED,
): Schema<Value> {
  return schemaOver(
    over<Value>(
      coreOf(inner).pipe(EffectSchema.filter((value) => admits(value), wireRefusal(refusal))),
    ),
  );
}

/** The inner schema read forgivingly: what it refuses decodes to nothing, and its node stands. */
function droppedCore<Value>(inner: Core<Value>): Core<Value | undefined> {
  const read = readEither(inner);
  return declareReader((value) => admit(Either.getOrUndefined(read(value))), emitJsonSchema(inner));
}

/**
 * A field a malformed value is dropped from rather than refused for: the
 * per-field counterpart of an array's `skipRefused`. A quota a panel would
 * have drawn, a position a scroll would have resumed from, a branch a row
 * would have shown — each worth having when it is well formed and worth
 * nothing when it is not, where refusing the whole answer over one of them
 * would cost the reader everything else that answer carried. A record leaves
 * the key out entirely, exactly as it does for an absent optional one.
 */
function droppedSchema<Value>(inner: Schema<Value>): Schema<Value | undefined> {
  return schemaOver(droppedCore(coreOf(inner)), true);
}

/** A parsed value carried into another; the emitted node is the inner one's. */
function mapSchema<Value, Mapped>(
  inner: Schema<Value>,
  to: (value: Value) => Mapped,
): Schema<Mapped> {
  return schemaOver(
    over<Mapped>(
      EffectSchema.transform(coreOf(inner), EffectSchema.Unknown, {
        strict: false,
        decode: (value) => to(value),
        encode: (value) => value,
      }),
    ),
  );
}

export interface SchemaReader<Value> {
  read: (value: UnparsedWireValue) => SchemaRead<Value>;
  jsonSchema: () => JsonSchemaNode;
}

/**
 * The seam for the one kind of rule the combinators above cannot express: a
 * reader that rebuilds a value field by field from an allowlist rather than
 * narrowing what arrived. Its node is declared beside its reader and is the
 * one place the two can drift, so a reader is worth writing only where a
 * combinator genuinely cannot say the rule.
 */
function readerSchema<Value>(reader: SchemaReader<Value>): Schema<Value> {
  return schemaOver(declareReader(reader.read, reader.jsonSchema()));
}

export const s = {
  text: textSchema,
  wholeText: wholeTextSchema,
  number: (options: NumberOptions = {}) => boundedNumber(options, false),
  wholeNumber: (options: NumberOptions = {}) => boundedNumber(options, true),
  boolean: booleanSchema,
  literal: literalSchema,
  enumOf: enumSchema,
  array: arraySchema,
  dropRefused: droppedSchema,
  record: recordSchema,
  union: unionSchema,
  brand: brandSchema,
  registered: registeredSchema,
  refine: refineSchema,
  map: mapSchema,
  reader: readerSchema,
} as const;
