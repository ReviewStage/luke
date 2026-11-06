export const SCHEMA_REFUSAL = {
  MALFORMED: "malformed",
  TOO_LARGE: "too-large",
  NOT_REGISTERED: "not-registered",
} as const;

export type SchemaRefusal = (typeof SCHEMA_REFUSAL)[keyof typeof SCHEMA_REFUSAL];

export type SchemaPath = readonly (string | number)[];

export type SchemaRead<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly refusal: SchemaRefusal; readonly path: SchemaPath };

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
  | { readonly type: "object"; readonly description?: string; readonly additionalProperties: true }
  | { readonly anyOf: readonly JsonSchemaNode[]; readonly description?: string };

export const EXCESS_KEYS = {
  REFUSE: "error",
  DROP: "ignore",
} as const;

export type ExcessKeys = (typeof EXCESS_KEYS)[keyof typeof EXCESS_KEYS];
