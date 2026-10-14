/**
 * mcp-tool-parameters.ts -- the arguments an MCP tool takes, read off its input schema for a person to read.
 *
 * A tool's `inputSchema` is a JSON Schema object whose `properties` are its
 * arguments and whose `required` names those a call must give, gathered
 * from the schema itself and from every `allOf` branch, a reference to one
 * of the schema's own `$defs` (or `definitions`) followed where one stands
 * for a part. What a list keeps of each argument is what a developer
 * reading a server's tools weighs: its name, its type in a few words,
 * whether it is required, what it is, the values it may take, and its
 * default. A type is named, never expanded: an array by what it holds
 * (`string[]`), a union by its branches (`string | null`), a closed set of
 * values as `enum` beside the values themselves, and anything nested as
 * `object`. A value or a default is kept as the server wrote it, cut only at
 * its bound. Every part is bounded, and how many arguments are kept is too,
 * so one server's sprawling schema cannot swell the answer. A schema that is
 * no object's, offers alternatives at its root, or points somewhere this
 * read does not follow says nothing of its arguments rather than that there
 * are none. None of this is handed to a model; the model is handed the
 * server's own schema, through its connection, untouched.
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

/** How deep a type is named, or a reference or an `allOf` followed, so a schema that nests or points without end cannot hold the read. */
const MAX_DEPTH = 3;

/** The type an argument whose schema names none is said to have. */
const ANY = "any";

/** What a closed set of values is called where its values are listed beside it. */
const ENUM = "enum";

/** A reference to one of the schema's own definitions, the only kind followed. */
const LOCAL_REFERENCE = /^#\/(\$defs|definitions)\/([^/]+)$/;

/** A text cut to `max` characters, as it was written. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A value as an argument's values and default are written: a string as itself, anything else as its JSON. */
function written(value: UnparsedWireValue): string {
  return cut(isWireString(value) ? value : JSON.stringify(value ?? null), SHORT_MAX_CHARS);
}

/**
 * The schema `schema` stands for: itself, or where it is a reference to one
 * of `root`'s own definitions, that definition, followed `MAX_DEPTH` deep;
 * nothing where it is no schema or points anywhere else.
 */
function resolved(schema: UnparsedWireValue, root: WireRecord, depth = 0): WireRecord | undefined {
  if (!isRecord(schema)) return undefined;
  const reference = schema.$ref;
  if (reference === undefined) return schema;
  const local = isWireString(reference) ? LOCAL_REFERENCE.exec(reference) : null;
  if (local === null || depth >= MAX_DEPTH) return undefined;
  const [, holder = "", pointer = ""] = local;
  const definitions = root[holder];
  const name = pointer.replaceAll("~1", "/").replaceAll("~0", "~");
  return isRecord(definitions) ? resolved(definitions[name], root, depth + 1) : undefined;
}

/** Whether a schema describes an object, which it does where it names no type or names `object` among its types. */
function describesObject(schema: WireRecord): boolean {
  const type = schema.type;
  if (type === undefined) return true;
  if (isWireString(type)) return type === "object";
  return Array.isArray(type) && type.includes("object");
}

/**
 * The object schemas a tool's arguments are gathered from: the schema and
 * every `allOf` branch, references followed; nothing where any part is no
 * object's, offers alternatives, or cannot be followed.
 */
function objectParts(
  schema: UnparsedWireValue,
  root: WireRecord,
  depth = 0,
): readonly WireRecord[] | undefined {
  const part = resolved(schema, root);
  if (part === undefined || depth > MAX_DEPTH || !describesObject(part)) return undefined;
  // Note that alternatives at the root are no one list of arguments, so they say nothing of them.
  if (part.anyOf !== undefined || part.oneOf !== undefined) return undefined;
  if (part.allOf === undefined) return [part];
  if (!Array.isArray(part.allOf)) return undefined;
  const parts: WireRecord[] = [part];
  for (const branch of part.allOf) {
    const branchParts = objectParts(branch, root, depth + 1);
    if (branchParts === undefined) return undefined;
    parts.push(...branchParts);
  }
  return parts;
}

/** The branches of a union, `anyOf` or `oneOf`, that are schemas. */
function branchesOf(schema: WireRecord): readonly WireRecord[] {
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) ? branches.filter(isRecord) : [];
}

/** A schema's closed set of values: its `enum`, its `const`, or its branches'. */
function valuesOf(schema: WireRecord, root: WireRecord): readonly UnparsedWireValue[] {
  if (Array.isArray(schema.enum)) return schema.enum;
  if ("const" in schema) return [schema.const];
  return branchesOf(schema).flatMap((branch) => {
    const at = resolved(branch, root);
    return at === undefined ? [] : valuesOf(at, root);
  });
}

/** The words a schema's type is said in, at most `depth` levels down. */
function typeOf(schema: UnparsedWireValue, root: WireRecord, depth = 0): string {
  const at = resolved(schema, root);
  if (at === undefined) return isRecord(schema) ? "object" : ANY;
  if (depth > MAX_DEPTH) return "object";
  if (Array.isArray(at.enum) || "const" in at) return ENUM;
  const branches = branchesOf(at);
  if (branches.length > 0) {
    return [...new Set(branches.map((branch) => typeOf(branch, root, depth + 1)))].join(" | ");
  }
  const named = Array.isArray(at.type) ? at.type.filter(isWireString) : [at.type];
  const types = named.filter(isWireString).map((type) => {
    if (type !== "array") return type;
    const items = typeOf(at.items, root, depth + 1);
    return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
  });
  if (types.length > 0) return types.join(" | ");
  // A schema that is only the meeting of others is what its first one is.
  const first = Array.isArray(at.allOf) ? at.allOf.find(isRecord) : undefined;
  if (first !== undefined) return typeOf(first, root, depth + 1);
  return isRecord(at.properties) ? "object" : ANY;
}

/** One argument as a list keeps it, its own words read before those of what it refers to. */
function parameterOf(
  name: string,
  schema: UnparsedWireValue,
  required: boolean,
  root: WireRecord,
): IntegrationToolParameter {
  const own = isRecord(schema) ? schema : {};
  const at = resolved(schema, root) ?? own;
  const words = [own.description, at.description].find(isWireString)?.trim() ?? "";
  const values = valuesOf(at, root);
  const fallback = "default" in own ? own.default : "default" in at ? at.default : undefined;
  return {
    name: cut(name, SHORT_MAX_CHARS),
    type: cut(typeOf(schema, root), SHORT_MAX_CHARS),
    required,
    ...(words !== "" ? { description: cut(words, DESCRIPTION_MAX_CHARS) } : undefined),
    ...(values.length > 0 ? { values: values.slice(0, MAX_VALUES).map(written) } : undefined),
    ...("default" in own || "default" in at ? { default: written(fallback) } : undefined),
  };
}

/**
 * The arguments a tool's input schema declares, in its order, at most
 * `MAX_PARAMETERS` of them; none where it declares none; and nothing at all
 * where what the server sent cannot be read as an object's arguments, so a
 * list says nothing of arguments it could not read rather than that there
 * are none.
 */
export function toolParameters(
  inputSchema: UnparsedWireValue,
): readonly IntegrationToolParameter[] | undefined {
  if (!isRecord(inputSchema)) return undefined;
  const parts = objectParts(inputSchema, inputSchema);
  if (parts === undefined) return undefined;
  // Note that an argument two parts both declare is the first's, where it first stands.
  const properties = new Map<string, UnparsedWireValue>();
  const required = new Set<string>();
  for (const part of parts) {
    if (part.properties !== undefined && !isRecord(part.properties)) return undefined;
    for (const [name, schema] of Object.entries(part.properties ?? {})) {
      if (!properties.has(name)) properties.set(name, schema);
    }
    if (Array.isArray(part.required)) {
      for (const name of part.required.filter(isWireString)) required.add(name);
    }
  }
  return [...properties]
    .slice(0, MAX_PARAMETERS)
    .map(([name, schema]) => parameterOf(name, schema, required.has(name), inputSchema));
}
