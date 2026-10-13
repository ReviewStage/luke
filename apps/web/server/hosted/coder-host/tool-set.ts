import { WireValueSchema } from "@sidecar/wire";
import { verbatimJsonSchema } from "@sidecar/wire/effect";
import type { ToolSet } from "ai";
import type { MessageStreamEvent } from "eve/client";
import { wireValidatedTool } from "../../core.js";
import { AGENT_ROLE } from "../agent-runtime/role.js";
import { AGENT_TOOL, toolsOf } from "../agent-runtime/tools.js";
import { connectionToolEntries } from "../connection-tools.js";

/**
 * tool-set.ts -- every tool a coding agent's rows may name, as the store writer holds them.
 *
 * The coding agent runs eve's own tools, authored one file each under
 * `coder/tools/` so the set is exactly this list and eve adds nothing
 * beside it but its two over the Linear connection (`../connection-tools.ts`): its shell and its file tools, the code extension's patch and
 * search, the hosted public search and page read the planning model has
 * too (`../public-research.ts`), the delegation of a slice of its
 * work to a worker (`coder/tools/delegate.ts`), the notes it takes on
 * its plan (`plan-edit.ts`), its to-do list (`todos.ts`), and the
 * developer's inbox it posts to (`inbox.ts`), the load of one of its
 * repository's skills (`skills.ts`), and the pages it shows the developer
 * (`../page-tool.ts`). The worker's own rows name
 * the read-only few of the same tools (`WORKER_TOOL_NAMES`), so one writer
 * over this set holds both transcripts. The writer holds every tool part
 * of a row to a registered tool, so each is registered here under the name
 * its part spells; eve declares each tool's input itself, so what is held
 * is that the input is an object and not its fields, which eve's own
 * schema already read before the call ran.
 */

/**
 * The tools the coding agent is offered, by the name eve mounts each under:
 * the coder's in the registry (`../agent-runtime/tools.ts`), named here for
 * the callers that pick one out. Its test holds this to the registry's role
 * and the files under `coder/tools/` to this.
 */
export const CODER_TOOL = {
  BASH: AGENT_TOOL.BASH,
  READ_FILE: AGENT_TOOL.READ_FILE,
  WRITE_FILE: AGENT_TOOL.WRITE_FILE,
  GLOB: AGENT_TOOL.GLOB,
  GREP: AGENT_TOOL.GREP,
  APPLY_PATCH: AGENT_TOOL.APPLY_PATCH,
  SEARCH_WEB: AGENT_TOOL.SEARCH_WEB,
  READ_WEB_PAGE: AGENT_TOOL.READ_WEB_PAGE,
  DELEGATE: AGENT_TOOL.DELEGATE,
  EDIT_PLAN: AGENT_TOOL.EDIT_PLAN,
  WRITE_TODOS: AGENT_TOOL.WRITE_TODOS,
  POST_TO_INBOX: AGENT_TOOL.POST_TO_INBOX,
  CLOSE_INBOX_ITEM: AGENT_TOOL.CLOSE_INBOX_ITEM,
  READ_INBOX: AGENT_TOOL.READ_INBOX,
  LOAD_SKILL: AGENT_TOOL.LOAD_SKILL,
  SHOW_PAGE: AGENT_TOOL.SHOW_PAGE,
  RUN_ON_MAC: AGENT_TOOL.RUN_ON_MAC,
} as const;

/**
 * The tools a worker is offered, authored one file each under
 * `coder/subagents/worker/tools/`: the coding worker's in the registry.
 * The shell is among them, told to change nothing; what holds it to that
 * is the worker's instructions.
 */
export const WORKER_TOOL_NAMES: ReadonlySet<string> = toolsOf(AGENT_ROLE.CODER_WORKER);

/**
 * eve's provider-run web reads, which coding agents ran before they had the
 * hosted pair: no agent is offered them now, but a transcript written then
 * names them, and reads back under the same set.
 */
export const RETIRED_CODER_TOOL = {
  WEB_FETCH: "web_fetch",
  WEB_SEARCH: "web_search",
} as const;

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

/**
 * Whether an event of the agent's session opened its sandbox: a request for
 * a sandbox tool, or for a page read from a file in the sandbox, or a
 * message received with files, which eve stages in the sandbox before the
 * turn opens, opening it to do so.
 */
export function opensSandbox(event: MessageStreamEvent): boolean {
  switch (event.type) {
    case "actions.requested":
      return event.data.actions.some(
        (action) =>
          action.kind === "tool-call" &&
          (SANDBOX_TOOLS.has(action.toolName) ||
            (action.toolName === CODER_TOOL.SHOW_PAGE && "path" in action.input)),
      );
    case "message.received":
      return event.data.parts?.some((part) => part.type === "file") ?? false;
    default:
      return false;
  }
}

/** A call's input as the row keeps it: one JSON object, whose fields are eve's own tool's to read. */
const TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

/**
 * The coding agent's tools as stored rows are held to them, built once for
 * the deployment, with the retired web reads a transcript written before
 * still names, and the Linear connection's calls beside them
 * (`../connection-tools.ts`), which the agent and its workers alike make.
 */
export const CODER_TOOL_SET: ToolSet = Object.fromEntries([
  ...[
    ...new Set([
      ...toolsOf(AGENT_ROLE.CODER),
      ...toolsOf(AGENT_ROLE.CODER_WORKER),
      ...Object.values(RETIRED_CODER_TOOL),
    ]),
  ].map((name) => [name, wireValidatedTool(`eve's ${name} tool`, TOOL_INPUT)]),
  ...connectionToolEntries(),
]);
