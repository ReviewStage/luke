import { posix } from "node:path";
import { apply_patch as applyPatch, grep } from "eve/extensions/code/tools";
import { defineTool, serializeModelInputSchema, type ToolDefinition } from "eve/tools";
import { never } from "eve/tools/approval";
import glob from "eve/tools/glob";
import readFile from "eve/tools/read_file";
import writeFile from "eve/tools/write_file";

/**
 * files.ts -- the coding agent's file tools: eve's own, with every path resolved from the checkout.
 *
 * eve's `read_file`, `write_file`, `glob`, and `grep` resolve a path from
 * the sandbox's root, and the code extension's `apply_patch` wants the
 * checkout named as its `root`, while the shell starts every command in
 * the checkout (`shell.ts`), so a model told where the checkout is spells
 * it out on every call and wastes a call when it gets it wrong. The tools
 * here resolve each path from the checkout instead: a relative path lands
 * inside it, an absolute one is taken as written, a directory left out is
 * the checkout, and `apply_patch`'s `root` is the checkout unless named.
 * Note that the call's input stays what the model wrote, so the transcript
 * shows the model's own paths, as it does for the shell; and that each
 * tool advertises eve's own input schema with its path property described
 * anew, since the model reads the property's words beside the tool's.
 */

/** JSON Schema as eve serializes a tool's input schema for the model. */
type JsonSchema = ReturnType<typeof serializeModelInputSchema<Record<string, never>>>;

/** `apply_patch`'s input with the root optional, which eve's own requires. */
interface PatchInput {
  readonly root?: string;
  readonly patchText: string;
}

/** The path given, resolved from the checkout: inside it when relative, as written when absolute, the checkout itself when left out. */
function fromCheckout(checkout: string, path: string | undefined): string {
  return path === undefined ? checkout : posix.resolve(checkout, path);
}

/** The one sentence every tool's description and path property carry. */
function pathsStartIn(checkout: string): string {
  return `Paths start at ${checkout}, the repository's checkout: a relative path is resolved from it, and an absolute path is taken as written.`;
}

/** eve's description without its own line about absolute paths, where it has one. */
function withoutAbsolutePathLine(description: string): string {
  return description
    .split("\n")
    .filter((line) => !line.includes("absolute path"))
    .join("\n");
}

/**
 * The tool's input schema as the model reads it, with its path property
 * described anew, and left out of `required` where a call may omit it.
 */
function describingPath(
  schema: ToolDefinition["inputSchema"],
  property: string,
  description: string,
  required = true,
): JsonSchema {
  const json = serializeModelInputSchema(schema);
  // SAFETY: every tool wrapped here advertises an object schema, whose `properties` holds one schema per name.
  const properties = json.properties as Record<string, JsonSchema>;
  // SAFETY: an object schema's `required` is a list of its property names, where it has one.
  const names = (json.required ?? []) as string[];
  return {
    ...json,
    properties: { ...properties, [property]: { ...properties[property], description } },
    required: required ? names : names.filter((name) => name !== property),
  };
}

/** eve's `read_file`, with `filePath` resolved from the checkout given. */
export function readFileIn(checkout: string) {
  return defineTool({
    ...readFile,
    description: `${withoutAbsolutePathLine(readFile.description)}\n- ${pathsStartIn(checkout)}`,
    inputSchema: describingPath(
      readFile.inputSchema,
      "filePath",
      "The path to the file to read, relative to the checkout or absolute.",
    ),
    execute: (input, ctx) =>
      readFile.execute({ ...input, filePath: fromCheckout(checkout, input.filePath) }, ctx),
  });
}

/** eve's `write_file`, with `filePath` resolved from the checkout given. */
export function writeFileIn(checkout: string) {
  return defineTool({
    ...writeFile,
    description: `${writeFile.description}\n- ${pathsStartIn(checkout)}`,
    inputSchema: describingPath(
      writeFile.inputSchema,
      "filePath",
      "The path to the file to write, relative to the checkout or absolute.",
    ),
    execute: (input, ctx) =>
      writeFile.execute({ ...input, filePath: fromCheckout(checkout, input.filePath) }, ctx),
  });
}

/** eve's `glob`, searching the checkout given unless `path` names another directory. */
export function globIn(checkout: string) {
  return defineTool({
    ...glob,
    description: `${glob.description}\n- ${pathsStartIn(checkout)}`,
    inputSchema: describingPath(
      glob.inputSchema,
      "path",
      "The directory to search in, relative to the checkout or absolute. Omit to search the whole checkout.",
    ),
    execute: (input, ctx) =>
      glob.execute({ ...input, path: fromCheckout(checkout, input.path) }, ctx),
  });
}

/** The code extension's `grep`, searching the checkout given unless `path` names another directory or file. */
export function grepIn(checkout: string) {
  return defineTool({
    ...grep,
    description: `${grep.description} ${pathsStartIn(checkout)}`,
    inputSchema: describingPath(
      grep.inputSchema,
      "path",
      "Directory or file to search, relative to the checkout or absolute. Omit to search the whole checkout. Narrow this first.",
    ),
    execute: (input, ctx) =>
      grep.execute({ ...input, path: fromCheckout(checkout, input.path) }, ctx),
  });
}

/** The code extension's `apply_patch`, against the checkout given unless `root` names another. */
export function applyPatchIn(checkout: string) {
  // The approval key, which eve's tool declares none of, is typed on the required root and left out.
  const { approvalKey: _approvalKey, ...patch } = applyPatch;
  return defineTool({
    ...patch,
    description: `${applyPatch.description}\nThe checkout patched is ${checkout}, the repository's checkout, unless root names another.`,
    inputSchema: describingPath(
      applyPatch.inputSchema,
      "root",
      "The git checkout to patch. Omit it to patch the repository's checkout.",
      false,
    ),
    // eve's own approval, restated because the one spread in is typed on the required root.
    approval: never(),
    label: { start: ({ root }: PatchInput) => `Patch ${fromCheckout(checkout, root)}` },
    execute: ({ root, patchText }: PatchInput, ctx) =>
      applyPatch.execute({ root: fromCheckout(checkout, root), patchText }, ctx),
  });
}
