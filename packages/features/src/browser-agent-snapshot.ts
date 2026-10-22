/**
 * browser-agent-snapshot.ts -- a page's accessibility tree as the compact text an agent reads: an element a line, indented under its parent, each one an agent can act on marked with its ref.
 *
 * The tree is Chromium's own (`Accessibility.getFullAXTree`). A node the
 * tree ignores, and a wrapper with no name of its own, is left out and its
 * children stand in its place, so what is printed is what a screen reader
 * would say. A text that only repeats the name of the element it stands in
 * is left out too. Each element printed with a DOM node behind it carries
 * its ref (`browserRefOf`), the node's backend id, which a click, a typing,
 * or a wait names; the page itself and its plain text carry none. Names and
 * values are cut, and the whole text stops at the snapshot cap with a note
 * saying the rest was left out.
 */

import { EXCESS_KEYS, type UnparsedWireValue, WireValueSchema } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result, Schema } from "effect";
import { BROWSER_AGENT_LIMITS, browserRefOf, cutBrowserText } from "./browser-agent-actions.js";

/** Roles a node is printed under only where it has a name: wrappers that say nothing themselves. */
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

/** Roles never printed, nor anything under them: the pieces a text is laid out in. */
const HIDDEN_ROLES: ReadonlySet<string> = new Set(["InlineTextBox"]);

/** Roles printed without a ref: the page itself, and a run of text. */
const UNREFERENCED_ROLES: ReadonlySet<string> = new Set(["RootWebArea", "StaticText"]);

/** How a role is printed where Chromium's own word for it is not the one a reader knows. */
const ROLE_WORDS: ReadonlyMap<string, string> = new Map([
  ["RootWebArea", "page"],
  ["StaticText", "text"],
]);

/** Properties printed as a flag where true. */
const FLAG_PROPERTIES: ReadonlySet<string> = new Set([
  "focused",
  "disabled",
  "required",
  "selected",
]);

/** Properties printed with their value, whatever it is. */
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

/** A snapshot's text, and whether its end was left out. */
export interface SnapshotText {
  readonly text: string;
  readonly truncated: boolean;
}

/** A value of the tree's as one line of words: its whitespace folded and its length cut. */
function wordsOf(value: AxNode["name"]): string {
  const raw = value?.value;
  if (raw === undefined || raw === null) return "";
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return cutBrowserText(
    text.replace(/\s+/gu, " ").trim(),
    BROWSER_AGENT_LIMITS.SNAPSHOT_NAME_MAX_CHARS,
  );
}

/** The flags and values a node is printed with, and its ref where it has one. */
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

/** The line a node is printed as, or none where it is left out and its children stand in its place. */
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

/** The note that ends a snapshot cut at its cap. */
const CUT_NOTE =
  "\n… the rest of the page was left out; scroll and take a snapshot again to read it";

/**
 * The tree's text, walked depth first from its root, a node's children in
 * their order. Note that the walk keeps its own stack rather than recursing,
 * because a page's tree can be deeper than the call stack.
 */
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

/** The snapshot text of what `Accessibility.getFullAXTree` answered, or none where it answered no tree. */
export function snapshotTextOf(result: UnparsedWireValue): SnapshotText | undefined {
  const read = readTree(result);
  return Result.isFailure(read) ? undefined : textOf(read.success.nodes);
}
