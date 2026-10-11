import { CODING_AGENT_DELEGATE_TOOL } from "@sidecar/hosted/coding-agent-wire";
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
 * search, the provider-run web reads, and the delegation of a slice of its
 * work to a worker (`coder/tools/delegate.ts`). The worker's own rows name
 * the read-only few of the same tools (`WORKER_TOOL_NAMES`), so one writer
 * over this set holds both transcripts. The writer holds every tool part
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
  DELEGATE: CODING_AGENT_DELEGATE_TOOL,
} as const;

/**
 * The tools a worker is offered, authored one file each under
 * `coder/subagents/worker/tools/`: every read of the agent's, and nothing
 * that writes the checkout or publishes, so workers run in parallel without
 * colliding and the agent alone edits. The shell is among them, told to
 * change nothing; what holds it to that is the worker's instructions.
 */
export const WORKER_TOOL_NAMES: ReadonlySet<string> = new Set([
  CODER_TOOL.BASH,
  CODER_TOOL.READ_FILE,
  CODER_TOOL.GLOB,
  CODER_TOOL.GREP,
  CODER_TOOL.WEB_FETCH,
  CODER_TOOL.WEB_SEARCH,
]);

/**
 * The tools whose every call runs in the agent's sandbox, which is what
 * tells the host a sandbox was opened. A delegation is not among them: a
 * worker opens the agent's sandbox only when it reads the checkout, and a
 * refused or web-only delegation opens none, so counting it would have the
 * turn's end open a sandbox, checkout and all, only to stop it. A sandbox a
 * worker opened is stopped at the end of the first turn in which the agent
 * runs a sandbox tool of its own, which a turn that edits always does.
 */
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
