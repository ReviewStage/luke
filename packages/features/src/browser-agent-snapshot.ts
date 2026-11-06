import { EXCESS_KEYS, type UnparsedWireValue, WireValueSchema } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Result, Schema } from "effect";
import { BROWSER_AGENT_LIMITS, browserRefOf, cutBrowserText } from "./browser-agent-actions.js";

const WRAPPER_ROLES: ReadonlySet<string> = new Set([
  "generic",
  "none",
  "presentation",
  "GenericContainer",
  "Section",
  "LineBreak",
  "paragraph",
  "MenuListPopup",
]);

const HIDDEN_ROLES: ReadonlySet<string> = new Set(["InlineTextBox"]);

const UNREFERENCED_ROLES: ReadonlySet<string> = new Set(["RootWebArea", "StaticText"]);

const ROLE_WORDS: ReadonlyMap<string, string> = new Map([
  ["RootWebArea", "page"],
  ["StaticText", "text"],
]);

const FLAG_PROPERTIES: ReadonlySet<string> = new Set([
  "focused",
  "disabled",
  "required",
  "selected",
]);

const VALUED_PROPERTIES: ReadonlySet<string> = new Set(["checked", "pressed", "expanded", "level"]);

const INDENT = "  ";

const AxValueSchema = Schema.Struct({ value: Schema.optional(WireValueSchema) });

const AxNodeSchema = Schema.Struct({
  nodeId: Schema.String,
  ignored: Schema.optional(Schema.Boolean),
  role: Schema.optional(AxValueSchema),
  name: Schema.optional(AxValueSchema),
  value: Schema.optional(AxValueSchema),
  properties: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, value: AxValueSchema })),
  ),
  childIds: Schema.optional(Schema.Array(Schema.String)),
  parentId: Schema.optional(Schema.String),
  backendDOMNodeId: Schema.optional(Schema.Number),
});

type AxNode = typeof AxNodeSchema.Type;

const readTree = readEither(Schema.Struct({ nodes: Schema.Array(AxNodeSchema) }), {
  excess: EXCESS_KEYS.DROP,
});

export interface SnapshotText {
  readonly text: string;
  readonly truncated: boolean;
}

function wordsOf(value: AxNode["name"]): string {
  const raw = value?.value;
  if (raw === undefined || raw === null) return "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return cutBrowserText(
    text.replace(/\s+/gu, " ").trim(),
    BROWSER_AGENT_LIMITS.SNAPSHOT_NAME_MAX_CHARS,
  );
}

function marksOf(node: AxNode, role: string): string {
  const marks: string[] = [];
  for (const property of node.properties ?? []) {
    const value = property.value.value;
    if (FLAG_PROPERTIES.has(property.name) && value === true) marks.push(property.name);
    if (VALUED_PROPERTIES.has(property.name) && value !== undefined) {
      marks.push(`${property.name}=${String(value)}`);
    }
  }
  if (node.backendDOMNodeId !== undefined && !UNREFERENCED_ROLES.has(role)) {
    marks.push(`ref=${browserRefOf(node.backendDOMNodeId)}`);
  }
  return marks.length === 0 ? "" : ` [${marks.join(", ")}]`;
}

function lineOf(node: AxNode, depth: number, parentName: string): string | undefined {
  const role = wordsOf(node.role);
  const name = wordsOf(node.name);
  if (node.ignored === true || role === "") return undefined;
  if (WRAPPER_ROLES.has(role) && name === "") return undefined;
  if (role === "StaticText" && (name === "" || name === parentName)) return undefined;
  const value = wordsOf(node.value);
  const named = name === "" ? "" : ` ${JSON.stringify(name)}`;
  const valued = value === "" || value === name ? "" : ` value=${JSON.stringify(value)}`;
  const word = ROLE_WORDS.get(role) ?? role;
  return `${INDENT.repeat(depth)}- ${word}${named}${valued}${marksOf(node, role)}`;
}

const CUT_NOTE =
  "\n… the rest of the page was left out; scroll and take a snapshot again to read it";

function textOf(nodes: readonly AxNode[]): SnapshotText {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => node.parentId === undefined) ?? nodes[0];
  const budget = BROWSER_AGENT_LIMITS.SNAPSHOT_MAX_CHARS - CUT_NOTE.length;
  const lines: string[] = [];
  let length = 0;
  const stack = root === undefined ? [] : [{ node: root, depth: 0, parentName: "" }];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { node, depth, parentName } = next;
    if (HIDDEN_ROLES.has(wordsOf(node.role))) continue;
    const line = lineOf(node, depth, parentName);
    if (line !== undefined) {
      if (length + line.length + 1 > budget)
        return { text: `${lines.join("\n")}${CUT_NOTE}`, truncated: true };
      lines.push(line);
      length += line.length + 1;
    }
    const childDepth = line === undefined ? depth : depth + 1;
    const name = line === undefined ? parentName : wordsOf(node.name);
    const children = (node.childIds ?? []).flatMap((id) => byId.get(id) ?? []);
    for (const child of children.reverse())
      stack.push({ node: child, depth: childDepth, parentName: name });
  }
  return { text: lines.join("\n"), truncated: false };
}

export function snapshotTextOf(result: UnparsedWireValue): SnapshotText | undefined {
  const read = readTree(result);
  return Result.isFailure(read) ? undefined : textOf(read.success.nodes);
}
