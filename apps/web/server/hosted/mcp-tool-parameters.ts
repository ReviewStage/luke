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
 * default.
 *
 * An argument is every schema its value must meet: each declaration of it
 * across the root's parts, what a `$ref` there points to, and its `allOf`
 * branches. Its type is named, never expanded: an array by what it holds
 * (`string[]`), a union by its branches (`string | null`), a closed set of
 * values as `enum` beside the values themselves, and anything nested as
 * `object`; where its schemas name several, a closed set is said before a
 * plain type, and otherwise the first named. Its values are those every
 * schema of it that closes the set allows, and its words and default are
 * its own before those of what it refers to. A value or a default is kept as
 * the server wrote it, cut only at its bound. Every walk through a schema
 * goes `MAX_DEPTH` deep at most and spends one budget, so a schema that
 * refers to itself or fans out without end cannot hold the read. Every part
 * is bounded, and how many arguments are kept is too, so one server's
 * sprawling schema cannot swell the answer. A schema that is no object's,
 * offers alternatives at its root, or points somewhere this read does not
 * follow says nothing of its arguments rather than that there are none.
 * None of this is handed to a model; the model is handed the server's own
 * schema, through its connection, untouched.
 */

import type { IntegrationToolParameter } from "@luke/features/integration-wire";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@luke/wire";

/** The most arguments a tool keeps. */
const MAX_PARAMETERS = 64;

/** The most of an argument's name, type, value, or default kept. */
const SHORT_MAX_CHARS = 120;

/** The most of an argument's description kept. */
const DESCRIPTION_MAX_CHARS = 500;

/** The most values an argument's closed set keeps. */
const MAX_VALUES = 24;

/** How deep a walk follows a reference, an `allOf`, a union, or an array's items. */
const MAX_DEPTH = 3;

/** How many schemas one walk may visit, whatever their shape. */
const WALK_BUDGET = 200;

/** The type an argument whose schema names none is said to have. */
const ANY = "any";

/** What a closed set of values is called where its values are listed beside it. */
const ENUM = "enum";

/** A reference to one of the schema's own definitions, the only kind followed. */
const LOCAL_REFERENCE = /^#\/(\$defs|definitions)\/([^/]+)$/;

/** One walk through a tool's schema: the root its references are read in, and how many schemas it may still visit. */
interface Walk {
  readonly root: WireRecord;
  left: number;
}

/** Every schema a value must meet, and whether the walk reached all of them. */
interface Constraints {
  readonly schemas: readonly WireRecord[];
  readonly complete: boolean;
}

/** A text cut to `max` characters, as it was written. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A value as an argument's values and default are written: a string as itself, anything else as its JSON. */
function written(value: UnparsedWireValue): string {
  return cut(isWireString(value) ? value : JSON.stringify(value ?? null), SHORT_MAX_CHARS);
}

/** The definition a schema's `$ref` names among the root's own, or nothing where it names none or one elsewhere. */
function referenced(schema: WireRecord, walk: Walk): WireRecord | undefined {
  const local = isWireString(schema.$ref) ? LOCAL_REFERENCE.exec(schema.$ref) : null;
  if (local === null) return undefined;
  const [, holder = "", pointer = ""] = local;
  const definitions = walk.root[holder];
  const target = isRecord(definitions)
    ? definitions[pointer.replaceAll("~1", "/").replaceAll("~0", "~")]
    : undefined;
  return isRecord(target) ? target : undefined;
}

/**
 * Every schema a value meeting `schema` meets: itself, what its `$ref`
 * points to, and its `allOf` branches, at most `MAX_DEPTH` deep and within
 * the walk's budget; `complete` is false where a reference could not be
 * followed or the walk stopped short.
 */
function constraintsOf(schema: UnparsedWireValue, walk: Walk, depth = 0): Constraints {
  if (!isRecord(schema) || depth > MAX_DEPTH || walk.left <= 0) {
    return { schemas: [], complete: false };
  }
  walk.left -= 1;
  const schemas: WireRecord[] = [schema];
  let complete = true;
  const next: WireValue[] = Array.isArray(schema.allOf) ? [...schema.allOf] : [];
  if (schema.$ref !== undefined) {
    const target = referenced(schema, walk);
    if (target === undefined) complete = false;
    else next.unshift(target);
  }
  for (const each of next) {
    const deeper = constraintsOf(each, walk, depth + 1);
    schemas.push(...deeper.schemas);
    complete &&= deeper.complete;
  }
  return { schemas, complete };
}

/** Whether a schema describes an object, which it does where it names no type or names `object` among its types. */
function describesObject(schema: WireRecord): boolean {
  const type = schema.type;
  if (type === undefined) return true;
  if (isWireString(type)) return type === "object";
  return Array.isArray(type) && type.includes("object");
}

/** The branches of a union, `anyOf` or `oneOf`. */
function branchesOf(schema: WireRecord): readonly WireValue[] {
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) ? branches : [];
}

/** The type one schema names by itself, or nothing where it names none. */
function namedType(schema: WireRecord, walk: Walk, depth: number): string | undefined {
  if (Array.isArray(schema.enum) || "const" in schema) return ENUM;
  const branches = branchesOf(schema);
  if (branches.length > 0) {
    return [...new Set(branches.map((branch) => typeOf(branch, walk, depth + 1)))].join(" | ");
  }
  const named = Array.isArray(schema.type) ? schema.type : [schema.type];
  const types = named.filter(isWireString).map((type) => {
    if (type !== "array") return type;
    const items = typeOf(schema.items, walk, depth + 1);
    return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
  });
  return types.length > 0 ? types.join(" | ") : undefined;
}

/** The words a value meeting `schema` is said in: a closed set before a plain type, else the first its schemas name. */
function typeOf(schema: UnparsedWireValue, walk: Walk, depth = 0): string {
  if (depth > MAX_DEPTH) return "object";
  const { schemas } = constraintsOf(schema, walk, depth);
  const named = schemas.flatMap((each) => namedType(each, walk, depth) ?? []);
  if (named.includes(ENUM)) return ENUM;
  return named[0] ?? (schemas.some((each) => isRecord(each.properties)) ? "object" : ANY);
}

/** The closed set one schema allows by itself, or nothing where it leaves the value open. */
function closedSet(
  schema: WireRecord,
  walk: Walk,
  depth: number,
): readonly UnparsedWireValue[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum;
  if ("const" in schema) return [schema.const];
  const branches = branchesOf(schema);
  if (branches.length === 0 || depth >= MAX_DEPTH) return undefined;
  // Note that a union closes the set only where every branch does: a `null`
  // branch closes it on nothing a list would show, and any open branch
  // opens the whole union, so its closed branches are never listed as if
  // they were every choice.
  const sets: UnparsedWireValue[][] = [];
  for (const branch of branches) {
    if (isRecord(branch) && branch.type === "null") continue;
    const set = valuesOf(branch, walk, depth + 1);
    if (set.length === 0) return undefined;
    sets.push([...set]);
  }
  return sets.length > 0 ? sets.flat() : undefined;
}

/** The values a value meeting `schema` may take: those every one of its schemas that closes the set allows. */
function valuesOf(schema: UnparsedWireValue, walk: Walk, depth = 0): readonly UnparsedWireValue[] {
  const { schemas } = constraintsOf(schema, walk, depth);
  const sets = schemas.flatMap((each) => {
    const set = closedSet(each, walk, depth);
    return set === undefined
      ? []
      : [new Map(set.map((value) => [JSON.stringify(value ?? null), value]))];
  });
  const [first, ...rest] = sets;
  if (first === undefined) return [];
  return [...first]
    .filter(([key]) => rest.every((set) => set.has(key)))
    .slice(0, MAX_VALUES)
    .map(([, value]) => value);
}

/** One argument as a list keeps it, from every schema its value must meet, its own words read first. */
function parameterOf(
  name: string,
  declarations: readonly WireValue[],
  required: boolean,
  root: WireRecord,
): IntegrationToolParameter {
  const fresh = (): Walk => ({ root, left: WALK_BUDGET });
  const [only] = declarations;
  const schema: WireValue =
    declarations.length === 1 && only !== undefined ? only : { allOf: [...declarations] };
  const { schemas } = constraintsOf(schema, fresh());
  const words =
    schemas
      .map((each) => each.description)
      .find(isWireString)
      ?.trim() ?? "";
  const fallback = schemas.find((each) => "default" in each);
  const values = valuesOf(schema, fresh());
  return {
    name: cut(name, SHORT_MAX_CHARS),
    type: cut(typeOf(schema, fresh()), SHORT_MAX_CHARS),
    required,
    ...(words !== "" ? { description: cut(words, DESCRIPTION_MAX_CHARS) } : undefined),
    ...(values.length > 0 ? { values: values.map(written) } : undefined),
    ...(fallback !== undefined ? { default: written(fallback.default) } : undefined),
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
  const { schemas: parts, complete } = constraintsOf(inputSchema, {
    root: inputSchema,
    left: WALK_BUDGET,
  });
  // Note that alternatives at the root are no one list of arguments, so they say nothing of them.
  const readable = parts.every(
    (part) => describesObject(part) && part.anyOf === undefined && part.oneOf === undefined,
  );
  if (!complete || !readable) return undefined;
  // An argument two parts both declare must meet both declarations; it stands where it first does.
  const declarations = new Map<string, WireValue[]>();
  const required = new Set<string>();
  const others: WireValue[] = [];
  for (const part of parts) {
    if (part.properties !== undefined && !isRecord(part.properties)) return undefined;
    for (const [name, schema] of Object.entries(part.properties ?? {})) {
      declarations.set(name, [...(declarations.get(name) ?? []), schema]);
    }
    if (Array.isArray(part.required)) {
      for (const name of part.required.filter(isWireString)) required.add(name);
    }
    if (isRecord(part.additionalProperties)) others.push(part.additionalProperties);
  }
  // A key the schema requires without declaring it is an argument too, of
  // whatever schema it gives every undeclared key.
  for (const name of required) {
    if (!declarations.has(name)) declarations.set(name, others.length > 0 ? others : [{}]);
  }
  // Note that the required stand first before the bound, so a long list of
  // optional arguments never crowds out one a call must give.
  const named = [...declarations];
  return [
    ...named.filter(([name]) => required.has(name)),
    ...named.filter(([name]) => !required.has(name)),
  ]
    .slice(0, MAX_PARAMETERS)
    .map(([name, schemas]) => parameterOf(name, schemas, required.has(name), inputSchema));
}
