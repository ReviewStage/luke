/**
 * connection-search.ts -- how a native agent's `connection_search` ranks an integration's tools and writes each one's signature, as eve's own search does.
 *
 * eve's agents find an integration's tools through eve's built-in
 * `connection_search`; a native harness's agent finds them through Luke's
 * MCP server (`connection-door.ts`), and is shown the same answer: the
 * tools ranked by the words asked for, and each written as a TypeScript
 * signature built from its input and output schemas. Both are written here
 * as eve 0.74 writes them, so an agent that moves from one runtime to the
 * other reads its integrations the same way.
 *
 * A query's words are matched against a tool's name (weight 6), its
 * arguments' names (3), its description (2), and its arguments' words (1),
 * and against the connection's name (4) and words (1); a word matches one
 * that starts with it, or one of three letters or more it starts with. An
 * empty query keeps every tool, ordered by connection and name.
 *
 * A signature walks a schema six levels deep at most and spends one budget
 * of a thousand nodes, so a schema that refers to itself or fans out
 * without end cannot hold the answer; the whole is cut at 4,000 characters.
 */

import { isRecord, type WireValue } from "@luke/wire";
import type { McpToolSchema } from "./mcp-tools.js";

/** One tool a search may answer, with the connection it is reached through. */
export interface ConnectionToolCandidate {
  readonly connection: { readonly connectionName: string; readonly description: string };
  readonly tool: McpToolSchema;
}

/** A field's words, and what a word matching one of them scores. */
type ScoredField = readonly [words: readonly string[], weight: number];

const WEIGHT = {
  TOOL_NAME: 6,
  CONNECTION_NAME: 4,
  ARGUMENT_NAME: 3,
  TOOL_DESCRIPTION: 2,
  ARGUMENT_DESCRIPTION: 1,
  CONNECTION_DESCRIPTION: 1,
} as const;

/** The shortest word a longer query word is matched by as its start. */
const SHORTEST_STEM = 3;

/** How deep a signature walks a schema, and how many nodes it may visit. */
const SIGNATURE_DEPTH = 6;
const SIGNATURE_BUDGET = 1000;

/** The most of a signature kept, and of a property's words. */
const SIGNATURE_MAX_CHARS = 4000;
const COMMENT_MAX_CHARS = 120;

/** The constraints a property's comment names beside its words. */
const CONSTRAINT_KEYS = [
  "format",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "default",
] as const;

/** A property name written bare; any other is quoted. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/** One walk through a schema: the root its references are read in, the references followed, how deep it is, and what is left of its budget. */
interface SignatureWalk {
  readonly root: WireValue;
  readonly refs: ReadonlySet<string>;
  readonly depth: number;
  readonly budget: { remaining: number };
}

/** A text's words, lower-cased, camel case split, each of two letters or more. */
function tokenize(text: string | undefined): readonly string[] {
  return (text ?? "")
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 1);
}

function matchesWord(word: string, asked: string): boolean {
  return word.startsWith(asked) || (word.length >= SHORTEST_STEM && asked.startsWith(word));
}

function scoreFields(asked: readonly string[], fields: readonly ScoredField[]): number {
  let score = 0;
  for (const word of asked) {
    for (const [words, weight] of fields) {
      if (words.some((each) => matchesWord(each, word))) score += weight;
    }
  }
  return score;
}

/** A tool's fields as a query is matched against them. */
function toolFields(tool: McpToolSchema): readonly ScoredField[] {
  const properties =
    isRecord(tool.inputSchema) && isRecord(tool.inputSchema.properties)
      ? Object.entries(tool.inputSchema.properties)
      : [];
  const argumentWords = properties.flatMap(([, property]) =>
    isRecord(property) && typeof property.description === "string" ? [property.description] : [],
  );
  return [
    [tokenize(tool.name), WEIGHT.TOOL_NAME],
    [properties.flatMap(([name]) => tokenize(name)), WEIGHT.ARGUMENT_NAME],
    [tokenize(tool.description), WEIGHT.TOOL_DESCRIPTION],
    [argumentWords.flatMap(tokenize), WEIGHT.ARGUMENT_DESCRIPTION],
  ];
}

/** The candidates a query keeps, best first, then by connection and tool name. */
export function rankConnectionTools(
  query: string,
  candidates: readonly ConnectionToolCandidate[],
): readonly ConnectionToolCandidate[] {
  const asked = tokenize(query);
  return candidates
    .map((candidate) => ({
      candidate,
      score:
        asked.length === 0
          ? 1
          : scoreFields(asked, [
              ...toolFields(candidate.tool),
              [tokenize(candidate.connection.connectionName), WEIGHT.CONNECTION_NAME],
              [tokenize(candidate.connection.description), WEIGHT.CONNECTION_DESCRIPTION],
            ]),
    }))
    .filter(({ score }) => score > 0)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        a.candidate.connection.connectionName.localeCompare(
          b.candidate.connection.connectionName,
        ) ||
        a.candidate.tool.name.localeCompare(b.candidate.tool.name),
    )
    .map(({ candidate }) => candidate);
}

/** The names of a connection's tools closest to one it lists none under, best first, at most `count`. */
export function closestToolNames(
  name: string,
  tools: readonly McpToolSchema[],
  count: number,
): readonly string[] {
  const asked = tokenize(name);
  if (asked.length === 0) return [];
  return tools
    .map((tool) => ({ name: tool.name, score: scoreFields(asked, toolFields(tool)) }))
    .filter(({ score }) => score > 0)
    .toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((each) => each.name);
}

function literal(value: WireValue | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function union(types: readonly string[]): string {
  const distinct = [...new Set(types)];
  return distinct.length === 0 ? "never" : distinct.join(" | ");
}

function wrap(type: string): string {
  return type.includes(" | ") || type.includes(" & ") ? `(${type})` : type;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function deeper(walk: SignatureWalk): SignatureWalk {
  return { ...walk, depth: walk.depth + 1 };
}

/** What a `#/…` reference points to in the walk's root; nothing for one already followed, or any other kind. */
function resolveRef(ref: string, walk: SignatureWalk): WireValue | undefined {
  if (walk.refs.has(ref) || !ref.startsWith("#")) return undefined;
  let node: WireValue | undefined = walk.root;
  for (const segment of ref.slice(1).split("/").filter(Boolean)) {
    if (!isRecord(node)) return undefined;
    node = node[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return node;
}

/** A property's comment: its words, cut, and the constraints it names. */
function propertyComment(property: Readonly<Record<string, WireValue>>): string {
  const parts: string[] = [];
  const words =
    typeof property.description === "string"
      ? property.description
          .replaceAll(/\s+/gu, " ")
          .replace(/[\s.;,:]+$/u, "")
          .trim()
      : "";
  if (words.length > 0) parts.push(cut(words, COMMENT_MAX_CHARS));
  for (const key of CONSTRAINT_KEYS) {
    if (property[key] !== undefined) parts.push(`${key}: ${JSON.stringify(property[key])}`);
  }
  return parts.length === 0 ? "" : ` /* ${parts.join("; ").replaceAll("*/", "* /")} */`;
}

function renderObject(schema: Readonly<Record<string, WireValue>>, walk: SignatureWalk): string {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const members = Object.entries(properties).map(([key, property]) => {
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    const optional = required.has(key) ? "" : "?";
    const comment = isRecord(property) ? propertyComment(property) : "";
    return `${name}${optional}: ${renderType(property, deeper(walk))}${comment}`;
  });
  const additional = schema.additionalProperties;
  if (isRecord(additional)) members.push(`[key: string]: ${renderType(additional, deeper(walk))}`);
  if (members.length > 0) return `{ ${members.join("; ")} }`;
  return additional === false ? "{}" : "Record<string, unknown>";
}

function renderPrimitive(
  type: string,
  schema: Readonly<Record<string, WireValue>>,
  walk: SignatureWalk,
): string {
  switch (type) {
    case "string":
    case "boolean":
    case "null":
      return type;
    case "number":
    case "integer":
      return "number";
    case "array":
      return `${wrap(renderType(schema.items, deeper(walk)))}[]`;
    case "object":
      return renderObject(schema, walk);
    default:
      return "unknown";
  }
}

/** One schema as a TypeScript type, within the walk's depth and budget. */
function renderType(schema: WireValue | undefined, walk: SignatureWalk): string {
  if (!isRecord(schema) || walk.depth > SIGNATURE_DEPTH || walk.budget.remaining <= 0) {
    return "unknown";
  }
  walk.budget.remaining -= 1;
  if (typeof schema.$ref === "string") {
    const target = resolveRef(schema.$ref, walk);
    return target === undefined
      ? "unknown"
      : renderType(target, { ...walk, refs: new Set([...walk.refs, schema.$ref]) });
  }
  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return union(schema.enum.map(literal));
  const branches = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : undefined;
  if (branches !== undefined) return union(branches.map((each) => renderType(each, deeper(walk))));
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map((each) => wrap(renderType(each, deeper(walk)))).join(" & ");
  }
  const named = (Array.isArray(schema.type) ? schema.type : [schema.type])
    .filter((type): type is string => typeof type === "string")
    .map((type) => renderPrimitive(type, schema, walk));
  if (named.length > 0) return union(named);
  if (isRecord(schema.properties) || schema.additionalProperties !== undefined) {
    return renderObject(schema, walk);
  }
  return schema.items === undefined ? "unknown" : renderPrimitive("array", schema, walk);
}

function renderRoot(schema: WireValue): string {
  return renderType(schema, {
    root: schema,
    refs: new Set(),
    depth: 0,
    budget: { remaining: SIGNATURE_BUDGET },
  });
}

/** A tool as the TypeScript signature a model reads: `name(input: …): Promise<…>`. */
export function toolSignature(tool: McpToolSchema): string {
  const input = tool.inputSchema === undefined ? "{}" : renderRoot(tool.inputSchema);
  const output = tool.outputSchema === undefined ? "unknown" : renderRoot(tool.outputSchema);
  return cut(`${tool.name}(input: ${input}): Promise<${output}>`, SIGNATURE_MAX_CHARS);
}
