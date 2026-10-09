import { WireValueSchema } from "@sidecar/wire";
import { verbatimJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import { wireValidatedTool } from "../../core.js";

/**
 * tool-set.ts -- every tool a coding agent's rows may name, as the store writer holds them.
 *
 * The coding agent runs eve's own tools, authored one file each under
 * `coder/tools/` so the set is exactly this list and eve adds nothing
 * beside it: its shell and its file tools, the code extension's patch and
 * search, and the provider-run web reads. The writer holds every tool part
 * of a row to a registered tool, so each is registered here under the name
 * its part spells; eve declares each tool's input itself, so what is held
 * is that the input is an object and not its fields, which eve's own
 * schema already read before the call ran.
 */

/** The tools the coding agent is offered, by the name eve mounts each under. */
export const CODER_TOOL = {
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  GLOB: "glob",
  GREP: "grep",
  APPLY_PATCH: "apply_patch",
  WEB_FETCH: "web_fetch",
  WEB_SEARCH: "web_search",
} as const;

/** The tools whose every call runs in the agent's sandbox, which is what tells the host a sandbox was opened. */
export const SANDBOX_TOOLS: ReadonlySet<string> = new Set([
  CODER_TOOL.BASH,
  CODER_TOOL.READ_FILE,
  CODER_TOOL.WRITE_FILE,
  CODER_TOOL.GLOB,
  CODER_TOOL.GREP,
  CODER_TOOL.APPLY_PATCH,
]);

/** A call's input as the row keeps it: one JSON object, whose fields are eve's own tool's to read. */
const TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/** The coding agent's tools as stored rows are held to them, built once for the deployment. */
export const CODER_TOOL_SET: ToolSet = Object.fromEntries(
  Object.values(CODER_TOOL).map((name) => [
    name,
    wireValidatedTool(`eve's ${name} tool`, TOOL_INPUT),
  ]),
);
