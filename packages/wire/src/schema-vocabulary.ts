/**
 * The words every wire read answers in, and the node a model is shown for a
 * declaration. They stand apart from the builder so the Effect emitter and the
 * builder built over it can each import them without importing each other.
 */

/** Why a value was refused. Three words, because a caller can only action on three. */
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
      readonly minLength?: number;
      readonly maxLength?: number;
    }
  | {
      readonly type: "number" | "integer";
      readonly description?: string;
      readonly enum?: readonly number[];
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | { readonly type: "boolean"; readonly description?: string; readonly enum?: readonly boolean[] }
  | { readonly type: "null"; readonly description?: string }
  | {
      readonly type: "array";
      readonly description?: string;
      readonly items: JsonSchemaNode;
      readonly minItems?: number;
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
