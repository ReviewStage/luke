/**
 * mcp-tool-parameters.ts -- the arguments an MCP tool takes, read off its input schema for a person to read.
 *
 * A tool's `inputSchema` is a JSON Schema object whose `properties` are its
 * arguments and whose `required` names those a call must give. What a list
 * keeps of each is what a developer reading a server's tools weighs: its
 * name, its type in a few words, whether it is required, what it is, the
 * values it may take, and its default. A type is named, never expanded: an
 * array by what it holds (`string[]`), a union by its branches
 * (`string | null`), a closed set of values as `enum` beside the values
 * themselves, and anything nested as `object`. Every part is bounded, and
 * how many arguments are kept is too, so one server's sprawling schema
 * cannot swell the answer. None of this is handed to a model; the model is
 * handed the server's own schema, through its connection, untouched.
 */

import type { IntegrationToolParameter } from "@luke/features/integration-wire";
import { isRecord, isWireString, type UnparsedWireValue, type WireRecord } from "@luke/wire";

/** The most arguments a tool keeps. */
const MAX_PARAMETERS = 64;

/** The most of an argument's name, type, value, or default kept. */
const SHORT_MAX_CHARS = 120;

/** The most of an argument's description kept. */
const DESCRIPTION_MAX_CHARS = 500;

/** The most values an argument's closed set keeps. */
const MAX_VALUES = 24;

/** How deep a type is named before it is only `object`, so a schema that nests without end cannot hold the read. */
const MAX_DEPTH = 3;

/** The type an argument whose schema names none is said to have. */
const ANY = "any";

/** What a closed set of values is called where its values are listed beside it. */
const ENUM = "enum";

/** A text bounded to `max` characters, its ends trimmed. */
function bounded(text: string, max: number): string {
  const whole = text.trim();
  return whole.length <= max ? whole : `${whole.slice(0, max - 1)}…`;
}

/** A value as an argument's values and default are written: a string as itself, anything else as its JSON. */
function written(value: UnparsedWireValue): string {
  return bounded(isWireString(value) ? value : JSON.stringify(value ?? null), SHORT_MAX_CHARS);
}

/** The branches of a union, `anyOf` or `oneOf`, that are schemas. */
function branchesOf(schema: WireRecord): readonly WireRecord[] {
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) ? branches.filter(isRecord) : [];
}

/** A schema's closed set of values: its `enum`, its `const`, or its branches'. */
function valuesOf(schema: WireRecord): readonly UnparsedWireValue[] {
  if (Array.isArray(schema.enum)) return schema.enum;
  if ("const" in schema) return [schema.const];
  return branchesOf(schema).flatMap(valuesOf);
}

/** The words a schema's type is said in, at most `depth` levels down. */
function typeOf(schema: UnparsedWireValue, depth = 0): string {
  if (!isRecord(schema)) return ANY;
  if (depth > MAX_DEPTH) return "object";
  if (Array.isArray(schema.enum) || "const" in schema) return ENUM;
  const branches = branchesOf(schema);
  if (branches.length > 0) {
    return [...new Set(branches.map((branch) => typeOf(branch, depth + 1)))].join(" | ");
  }
  const named = Array.isArray(schema.type) ? schema.type.filter(isWireString) : [schema.type];
  const types = named.filter(isWireString).map((type) => {
    if (type !== "array") return type;
    const items = typeOf(schema.items, depth + 1);
    return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
  });
  if (types.length > 0) return types.join(" | ");
  return isRecord(schema.properties) ? "object" : ANY;
}

/** One argument as a list keeps it. */
function parameterOf(
  name: string,
  schema: UnparsedWireValue,
  required: boolean,
): IntegrationToolParameter {
  const values = isRecord(schema) ? valuesOf(schema) : [];
  const description =
    isRecord(schema) && isWireString(schema.description) ? schema.description.trim() : "";
  const fallback = isRecord(schema) && "default" in schema ? written(schema.default) : undefined;
  return {
    name: bounded(name, SHORT_MAX_CHARS),
    type: bounded(typeOf(schema), SHORT_MAX_CHARS),
    required,
    ...(description !== ""
      ? { description: bounded(description, DESCRIPTION_MAX_CHARS) }
      : undefined),
    ...(values.length > 0 ? { values: values.slice(0, MAX_VALUES).map(written) } : undefined),
    ...(fallback !== undefined ? { default: fallback } : undefined),
  };
}

/**
 * The arguments a tool's input schema declares, in its order, at most
 * `MAX_PARAMETERS` of them; none where it declares none; and nothing at all
 * where what the server sent is no object schema, so a list says nothing of
 * arguments it could not read rather than that there are none.
 */
export function toolParameters(
  inputSchema: UnparsedWireValue,
): readonly IntegrationToolParameter[] | undefined {
  if (!isRecord(inputSchema)) return undefined;
  const properties = inputSchema.properties;
  if (properties === undefined) return [];
  if (!isRecord(properties)) return undefined;
  const required = new Set(
    Array.isArray(inputSchema.required) ? inputSchema.required.filter(isWireString) : [],
  );
  return Object.entries(properties)
    .slice(0, MAX_PARAMETERS)
    .map(([name, schema]) => parameterOf(name, schema, required.has(name)));
}
