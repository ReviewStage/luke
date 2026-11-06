import type { IntegrationToolParameter } from "@repo/features/integration-wire";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@repo/wire";

const MAX_PARAMETERS = 64;

const SHORT_MAX_CHARS = 120;

const DESCRIPTION_MAX_CHARS = 500;

const MAX_VALUES = 24;

const MAX_DEPTH = 3;

const WALK_BUDGET = 200;

const ANY = "any";

const ENUM = "enum";

const LOCAL_REFERENCE = /^#\/(\$defs|definitions)\/([^/]+)$/;

interface Walk {
  readonly root: WireRecord;
  left: number;
}

interface Constraints {
  readonly schemas: readonly WireRecord[];
  readonly complete: boolean;
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function written(value: UnparsedWireValue): string {
  return cut(isWireString(value) ? value : JSON.stringify(value ?? null), SHORT_MAX_CHARS);
}

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

function describesObject(schema: WireRecord): boolean {
  const type = schema.type;
  if (type === undefined) return true;
  if (isWireString(type)) return type === "object";
  return Array.isArray(type) && type.includes("object");
}

function branchesOf(schema: WireRecord): readonly WireValue[] {
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) ? branches : [];
}

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

function typeOf(schema: UnparsedWireValue, walk: Walk, depth = 0): string {
  if (depth > MAX_DEPTH) return "object";
  const { schemas } = constraintsOf(schema, walk, depth);
  const named = schemas.flatMap((each) => namedType(each, walk, depth) ?? []);
  if (named.includes(ENUM)) return ENUM;
  return named[0] ?? (schemas.some((each) => isRecord(each.properties)) ? "object" : ANY);
}

function closedSet(
  schema: WireRecord,
  walk: Walk,
  depth: number,
): readonly UnparsedWireValue[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum;
  if ("const" in schema) return [schema.const];
  const branches = branchesOf(schema);
  if (branches.length === 0 || depth >= MAX_DEPTH) return undefined;
  const sets: UnparsedWireValue[][] = [];
  for (const branch of branches) {
    if (constraintsOf(branch, walk, depth + 1).schemas.some((each) => each.type === "null"))
      continue;
    const set = valuesOf(branch, walk, depth + 1);
    if (set.length === 0) return undefined;
    sets.push([...set]);
  }
  return sets.length > 0 ? sets.flat() : undefined;
}

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

export function toolParameters(
  inputSchema: UnparsedWireValue,
): readonly IntegrationToolParameter[] | undefined {
  if (!isRecord(inputSchema)) return undefined;
  const { schemas: parts, complete } = constraintsOf(inputSchema, {
    root: inputSchema,
    left: WALK_BUDGET,
  });
  const readable = parts.every(
    (part) => describesObject(part) && part.anyOf === undefined && part.oneOf === undefined,
  );
  if (!complete || !readable) return undefined;
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
  for (const name of required) {
    if (!declarations.has(name)) declarations.set(name, others.length > 0 ? others : [{}]);
  }
  const named = [...declarations];
  return [
    ...named.filter(([name]) => required.has(name)),
    ...named.filter(([name]) => !required.has(name)),
  ]
    .slice(0, MAX_PARAMETERS)
    .map(([name, schemas]) => parameterOf(name, schemas, required.has(name), inputSchema));
}
