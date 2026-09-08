import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  wholeText,
} from "./json.js";

/**
 * One declaration per wire value, which both parses what arrived and emits
 * the JSON Schema a model is shown for it. A hand-written parser beside a
 * hand-written schema is two statements of the same rule that can drift; a
 * `Schema` is one, so a bound the parser refuses is a bound the schema
 * advertises, and a field the parser never reads is a field no model is
 * offered.
 *
 * Nothing here throws at a value: a refusal is a returned word and a path.
 * The one thing that throws is a schema declared with rules that contradict
 * each other, at construction, so a wrong declaration cannot ship.
 */

/** Why a value was refused. Three words, because a caller can only act on three. */
export const SCHEMA_REFUSAL = {
  /** Wrong type, wrong structure, unknown key, missing required key, unlisted literal. */
  MALFORMED: "malformed",
  /** Well-formed but past a declared bound: a bounded text, array, or number. */
  TOO_LARGE: "too-large",
  /** Well-formed but outside a registry the schema was built with (an unregistered tool name). */
  NOT_REGISTERED: "not-registered",
} as const;

export type SchemaRefusal = (typeof SCHEMA_REFUSAL)[keyof typeof SCHEMA_REFUSAL];

/** Where in the value the refusal happened: record keys and array indices, outermost first. */
export type SchemaPath = readonly (string | number)[];

export type SchemaRead<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly refusal: SchemaRefusal; readonly path: SchemaPath };

/** A JSON Schema node, in the strict form a function tool's parameters take. */
export type JsonSchemaNode =
  | {
      readonly type: "string";
      readonly description?: string;
      readonly enum?: readonly string[];
      readonly maxLength?: number;
    }
  | {
      readonly type: "number" | "integer";
      readonly description?: string;
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | { readonly type: "boolean"; readonly description?: string }
  | { readonly type: "null"; readonly description?: string }
  | {
      readonly type: "array";
      readonly description?: string;
      readonly items: JsonSchemaNode;
      readonly maxItems?: number;
    }
  | {
      readonly type: "object";
      readonly description?: string;
      readonly properties: { readonly [key: string]: JsonSchemaNode };
      readonly required: readonly string[];
      readonly additionalProperties: false;
    }
  | { readonly anyOf: readonly JsonSchemaNode[]; readonly description?: string };

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

function admit<Value>(value: Value): SchemaRead<Value> {
  return { ok: true, value };
}

function refuse(refusal: SchemaRefusal, path: SchemaPath = []): SchemaRead<never> {
  return { ok: false, refusal, path };
}

function describedNode(node: JsonSchemaNode, description: string | undefined): JsonSchemaNode {
  return description === undefined ? node : { ...node, description };
}

/**
 * Which schemas a record may leave the key out for. A set rather than a field
 * on {@link Schema}, so `optional` stays the only way a key becomes optional
 * and no caller can declare one by hand.
 */
const ABSENT_ADMITTED = new WeakSet<Schema<unknown>>();

function schemaOver<Value>(
  read: (value: UnparsedWireValue) => SchemaRead<Value>,
  node: () => JsonSchemaNode,
  absentAdmitted = false,
): Schema<Value> {
  const schema: Schema<Value> = {
    read,
    parse(value) {
      const result = read(value);
      return result.ok ? result.value : undefined;
    },
    jsonSchema: node,
    optional: () =>
      schemaOver<Value | undefined>(
        (value) => (value === undefined ? admit(undefined) : read(value)),
        node,
        true,
      ),
    describe: (description) =>
      schemaOver<Value>(read, () => describedNode(node(), description), absentAdmitted),
  };
  if (absentAdmitted) ABSENT_ADMITTED.add(schema);
  return schema;
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

export interface TextOptions {
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
  description?: string;
}

function stringNode(max: number | undefined): JsonSchemaNode {
  return max === undefined ? { type: "string" } : { type: "string", maxLength: max };
}

function textSchema(options: TextOptions = {}): Schema<string> {
  const { max, description } = options;
  const collapse = options.oneLine === true;
  const overflow = options.overflow ?? TEXT_OVERFLOW.REFUSE;
  const ends = options.ends ?? TEXT_ENDS.TRIM;
  const allowEmpty = options.allowEmpty === true;
  if (overflow === TEXT_OVERFLOW.ELLIPSIS && (!collapse || max === undefined)) {
    throw new Error(
      "A text may only be cut with an ellipsis when it is bounded and collapsed to one line: cutting a value that keeps its lines makes it say something its author did not.",
    );
  }
  return schemaOver<string>(
    (value) => {
      if (!isWireString(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      const collapsed = collapse ? value.replace(/\s+/gu, " ").trim() : value;
      const normalized = !collapse && ends === TEXT_ENDS.TRIM ? collapsed.trim() : collapsed;
      if (!allowEmpty && normalized.trim().length === 0) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (max === undefined || normalized.length <= max) return admit(normalized);
      if (overflow === TEXT_OVERFLOW.ELLIPSIS) {
        return admit(`${normalized.slice(0, max - 1).trimEnd()}…`);
      }
      return refuse(SCHEMA_REFUSAL.TOO_LARGE);
    },
    () => describedNode(stringNode(max), description),
  );
}

/**
 * Multi-line text whose whole words are the point of reporting it, settled
 * the way `wholeText` settles it. `max` refuses, never cuts.
 */
function wholeTextSchema(options: { max?: number; description?: string } = {}): Schema<string> {
  const { max, description } = options;
  return schemaOver<string>(
    (value) => {
      if (!isWireString(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      const normalized = wholeText(value);
      if (normalized === undefined) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (max !== undefined && normalized.length > max) return refuse(SCHEMA_REFUSAL.TOO_LARGE);
      return admit(normalized);
    },
    () => describedNode(stringNode(max), description),
  );
}

export interface NumberOptions {
  /**
   * The least the number may be. Below it is malformed rather than too large:
   * a count of minus three is not a count that overflowed, it is not a count.
   */
  minimum?: number;
  /** The most the number may be. Above it is the one bound that reads as too large. */
  maximum?: number;
  description?: string;
}

function numberNode(whole: boolean, options: NumberOptions): JsonSchemaNode {
  const type = whole ? "integer" : "number";
  if (options.minimum === undefined && options.maximum === undefined) return { type };
  if (options.maximum === undefined) return { type, minimum: options.minimum };
  if (options.minimum === undefined) return { type, maximum: options.maximum };
  return { type, minimum: options.minimum, maximum: options.maximum };
}

function boundedNumber(options: NumberOptions, whole: boolean): Schema<number> {
  const { minimum, maximum, description } = options;
  return schemaOver<number>(
    (value) => {
      if (!isWireNumber(value) || !Number.isFinite(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (whole && !Number.isSafeInteger(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (minimum !== undefined && value < minimum) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (maximum !== undefined && value > maximum) return refuse(SCHEMA_REFUSAL.TOO_LARGE);
      return admit(value);
    },
    () => describedNode(numberNode(whole, options), description),
  );
}

function booleanSchema(options: { description?: string } = {}): Schema<boolean> {
  return schemaOver<boolean>(
    (value) => (isWireBoolean(value) ? admit(value) : refuse(SCHEMA_REFUSAL.MALFORMED)),
    () => describedNode({ type: "boolean" }, options.description),
  );
}

function literalNode(literal: string | number | boolean | null): JsonSchemaNode {
  if (literal === null) return { type: "null" };
  if (isWireString(literal)) return { type: "string", enum: [literal] };
  if (isWireNumber(literal)) return { type: Number.isSafeInteger(literal) ? "integer" : "number" };
  return { type: "boolean" };
}

function literalSchema<const Literal extends string | number | boolean | null>(
  literal: Literal,
  options: { description?: string } = {},
): Schema<Literal> {
  return schemaOver<Literal>(
    (value) => (value === literal ? admit(literal) : refuse(SCHEMA_REFUSAL.MALFORMED)),
    () => describedNode(literalNode(literal), options.description),
  );
}

function enumSchema<const Member extends string>(
  members: readonly Member[],
  options: { description?: string } = {},
): Schema<Member> {
  const admitted = new Set<string>(members);
  return schemaOver<Member>(
    (value) => {
      if (!isWireString(value) || !admitted.has(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      // SAFETY: membership in the declared member set was just checked.
      return admit(value as Member);
    },
    () => describedNode({ type: "string", enum: members }, options.description),
  );
}

export interface ArrayOptions {
  /** The most entries the array may carry; past it is too large. */
  max?: number;
  /** The fewest entries it may carry; below it is malformed, as a number's minimum is. */
  minimum?: number;
  /** Drop a refused entry instead of refusing the array. */
  skipRefused?: boolean;
  description?: string;
}

function arraySchema<Value>(item: Schema<Value>, options: ArrayOptions = {}): Schema<Value[]> {
  const { max, minimum, description } = options;
  const skipRefused = options.skipRefused === true;
  return schemaOver<Value[]>(
    (value) => {
      if (!Array.isArray(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (minimum !== undefined && value.length < minimum) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (max !== undefined && value.length > max) return refuse(SCHEMA_REFUSAL.TOO_LARGE);
      const admitted: Value[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const read = item.read(value[index]);
        if (read.ok) {
          admitted.push(read.value);
          continue;
        }
        if (skipRefused) continue;
        return { ok: false, refusal: read.refusal, path: [index, ...read.path] };
      }
      return admit(admitted);
    },
    () =>
      describedNode(
        max === undefined
          ? { type: "array", items: item.jsonSchema() }
          : { type: "array", items: item.jsonSchema(), maxItems: max },
        description,
      ),
  );
}

/** What a record does with a key its field table does not name. */
export const RECORD_EXTRA_KEYS = {
  REFUSE: "refuse",
  IGNORE: "ignore",
} as const;

export type RecordExtraKeys = (typeof RECORD_EXTRA_KEYS)[keyof typeof RECORD_EXTRA_KEYS];

export interface RecordOptions {
  /** Requests refuse a key they did not name; an answer may ignore one a newer service added. */
  extraKeys?: RecordExtraKeys;
  description?: string;
}

/** Any one of a field table's parsed values, which is what its record's own values are. */
type AdmittedFieldValue<Fields extends SchemaFields> = FieldValue<Fields[keyof Fields]>;

function recordSchema<Fields extends SchemaFields>(
  fields: Fields,
  options: RecordOptions = {},
): Schema<RecordOf<Fields>> {
  const entries = Object.entries(fields);
  const extraKeys = options.extraKeys ?? RECORD_EXTRA_KEYS.REFUSE;
  const { description } = options;
  return schemaOver<RecordOf<Fields>>(
    (value) => {
      if (!isRecord(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (extraKeys === RECORD_EXTRA_KEYS.REFUSE) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(fields, key)) return refuse(SCHEMA_REFUSAL.MALFORMED, [key]);
        }
      }
      const admitted = new Map<string, AdmittedFieldValue<Fields>>();
      for (const [key, field] of entries) {
        if (!Object.hasOwn(value, key) && !ABSENT_ADMITTED.has(field)) {
          return refuse(SCHEMA_REFUSAL.MALFORMED, [key]);
        }
        const read = field.read(value[key]);
        if (!read.ok) return { ok: false, refusal: read.refusal, path: [key, ...read.path] };
        // SAFETY: `field` is the schema RecordOf types this key by, so what it admitted is one
        // of this table's field values; an optional field admits absence as undefined.
        const parsed = read.value as AdmittedFieldValue<Fields> | undefined;
        if (parsed !== undefined) admitted.set(key, parsed);
      }
      // SAFETY: every named key was read by the schema RecordOf types it by, and an absent
      // optional field is left out, which is the optional property RecordOf declares.
      return admit(Object.fromEntries(admitted) as RecordOf<Fields>);
    },
    () =>
      describedNode(
        {
          type: "object",
          properties: Object.fromEntries(
            entries.map(([key, field]) => [key, field.jsonSchema()] as const),
          ),
          required: entries.filter(([, field]) => !ABSENT_ADMITTED.has(field)).map(([key]) => key),
          additionalProperties: false,
        },
        description,
      ),
  );
}

function unionSchema<const Members extends readonly Schema<unknown>[]>(
  members: Members,
  options: { description?: string } = {},
): Schema<FieldValue<Members[number]>> {
  return schemaOver<FieldValue<Members[number]>>(
    (value) => {
      for (const member of members) {
        const read = member.read(value);
        if (!read.ok) continue;
        // SAFETY: this member admitted the value, so it is one of the members' parsed types.
        return admit(read.value as FieldValue<Members[number]>);
      }
      return refuse(SCHEMA_REFUSAL.MALFORMED);
    },
    () =>
      describedNode({ anyOf: members.map((member) => member.jsonSchema()) }, options.description),
  );
}

/**
 * A nominal brand over a parsed value. The brand is carried by the type
 * parameter alone, which the second argument is there to infer; nothing about
 * the value changes, so nothing reads it at run time.
 */
function brandSchema<Value, Brand extends string>(
  inner: Schema<Value>,
  _brand: Brand,
): Schema<Branded<Value, Brand>> {
  return schemaOver<Branded<Value, Brand>>((value) => {
    const read = inner.read(value);
    if (!read.ok) return read;
    // SAFETY: the brand is nominal only; the value stands exactly as the inner schema admitted it.
    return admit(read.value as Branded<Value, Brand>);
  }, inner.jsonSchema);
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
  return schemaOver<Value>((value) => {
    const read = inner.read(value);
    if (!read.ok) return read;
    return registry.has(read.value) ? read : refuse(SCHEMA_REFUSAL.NOT_REGISTERED);
  }, inner.jsonSchema);
}

/** A rule no combinator holds, over a value a combinator already parsed. */
function refineSchema<Value, Narrowed extends Value>(
  inner: Schema<Value>,
  admits: (value: Value) => value is Narrowed,
  refusal: SchemaRefusal = SCHEMA_REFUSAL.MALFORMED,
): Schema<Narrowed> {
  return schemaOver<Narrowed>((value) => {
    const read = inner.read(value);
    if (!read.ok) return read;
    return admits(read.value) ? admit(read.value) : refuse(refusal);
  }, inner.jsonSchema);
}

/** A parsed value carried into another; the emitted node is the inner one's. */
function mapSchema<Value, Mapped>(
  inner: Schema<Value>,
  to: (value: Value) => Mapped,
): Schema<Mapped> {
  return schemaOver<Mapped>((value) => {
    const read = inner.read(value);
    return read.ok ? admit(to(read.value)) : read;
  }, inner.jsonSchema);
}

export interface SchemaReader<Value> {
  read: (value: UnparsedWireValue) => SchemaRead<Value>;
  jsonSchema: () => JsonSchemaNode;
}

/**
 * The seam every combinator above is built from, for the one kind of rule
 * they cannot express: a reader that rebuilds a value field by field from an
 * allowlist rather than narrowing what arrived. Its node is declared beside
 * its reader and is the one place the two can drift, so a reader is worth
 * writing only where a combinator genuinely cannot say the rule.
 */
function readerSchema<Value>(reader: SchemaReader<Value>): Schema<Value> {
  return schemaOver<Value>(reader.read, reader.jsonSchema);
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
  record: recordSchema,
  union: unionSchema,
  brand: brandSchema,
  registered: registeredSchema,
  refine: refineSchema,
  map: mapSchema,
  reader: readerSchema,
} as const;
