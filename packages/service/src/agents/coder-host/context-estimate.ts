import type { StoredAgentStep } from "@luke/database/schemas/coding-agent";
import { emitJsonSchema } from "@luke/wire/effect";
import type { MessageStreamEvent } from "eve/client";
import { serializeModelInputSchema, type ToolDefinition } from "eve/tools";
import loadSkill from "eve/tools/load_skill";
import { SHOW_PAGE_TOOL } from "../../tasks/page-tool.js";
import { LOOK_AT_PICTURE_TOOL } from "../../tasks/picture-look.js";
import {
  LIST_AGENTS_TOOL,
  LIST_TASKS_TOOL,
  MESSAGE_AGENT_TOOL,
  START_AGENT_TOOL,
} from "../coding-agent-tools.js";
import { RUN_ON_MAC_TOOL } from "../mac-command.js";
import { READ_WEB_PAGE_TOOL, SEARCH_WEB_TOOL } from "../public-research.js";
import { CODER } from "./bounds.js";
import { DELEGATE_TOOL } from "./delegation.js";
import { applyPatchIn, globIn, grepIn, readFileIn, writeFileIn } from "./files.js";
import { INBOX_TOOLS } from "./inbox.js";
import { EDIT_PLAN_TOOL } from "./plan-edit.js";
import { OPEN_PULL_REQUEST_TOOL } from "./pull-request.js";
import { bashStartingIn } from "./shell.js";
import { SHOW_IMAGE_TOOL } from "./show-image.js";
import { SLEEP_TOOL } from "./sleep.js";
import { TODOS_TOOL } from "./todos.js";
import { CODER_TOOL } from "./tool-set.js";

/**
 * context-estimate.ts -- what a coding agent's newest step read: the counts its provider gave, and estimates of the parts no provider counts apart.
 *
 * A provider answers each step with the tokens it read, how many of those
 * its prefix cache read or wrote, and the tokens it wrote, and nothing of
 * how the read divides. Three parts of it are text the service composes,
 * so they are estimated here the way eve's own compaction estimates a
 * message, the bytes of its JSON over four: the instructions the session
 * runs under, the definitions of the tools the coder project authors
 * (`apps/dev/tools/`), built from the same functions and words those files
 * are, and the plan or task the agent was handed as its first message. The tools are the same
 * for every agent, so they are estimated once, as the module loads, which
 * is in eve's service alone: this module reaches eve's tools, which no
 * route may load.
 */

/** The bytes a token stands for in eve's own estimate. */
const BYTES_PER_TOKEN = 4;

/** A tool as the model is shown it: its words and its input's JSON Schema. */
interface ShownTool {
  readonly description: string;
  readonly inputSchema: unknown;
}

/** An eve tool as the model is shown it, its input schema serialized as eve serializes it for the model. */
function shown(tool: Pick<ToolDefinition, "description" | "inputSchema">): ShownTool {
  return {
    description: tool.description ?? "",
    inputSchema: serializeModelInputSchema(tool.inputSchema),
  };
}

/** Every tool the coder project authors, keyed so a tool added to the set without a definition here fails to compile. */
const AUTHORED_TOOLS = {
  [CODER_TOOL.BASH]: shown(bashStartingIn(CODER.CHECKOUT_PATH)),
  [CODER_TOOL.READ_FILE]: shown(readFileIn(CODER.CHECKOUT_PATH)),
  [CODER_TOOL.WRITE_FILE]: shown(writeFileIn(CODER.CHECKOUT_PATH)),
  [CODER_TOOL.GLOB]: shown(globIn(CODER.CHECKOUT_PATH)),
  [CODER_TOOL.GREP]: shown(grepIn(CODER.CHECKOUT_PATH)),
  [CODER_TOOL.APPLY_PATCH]: shown(applyPatchIn(CODER.CHECKOUT_PATH)),
  [CODER_TOOL.SEARCH_WEB]: {
    description: SEARCH_WEB_TOOL.description,
    inputSchema: emitJsonSchema(SEARCH_WEB_TOOL.inputSchema),
  },
  [CODER_TOOL.READ_WEB_PAGE]: {
    description: READ_WEB_PAGE_TOOL.description,
    inputSchema: emitJsonSchema(READ_WEB_PAGE_TOOL.inputSchema),
  },
  [CODER_TOOL.DELEGATE]: {
    description: DELEGATE_TOOL.description,
    inputSchema: emitJsonSchema(DELEGATE_TOOL.inputSchema),
  },
  [CODER_TOOL.EDIT_PLAN]: {
    description: EDIT_PLAN_TOOL.description,
    inputSchema: emitJsonSchema(EDIT_PLAN_TOOL.inputSchema),
  },
  [CODER_TOOL.LOOK_AT_PICTURE]: {
    description: LOOK_AT_PICTURE_TOOL.description,
    inputSchema: emitJsonSchema(LOOK_AT_PICTURE_TOOL.inputSchema),
  },
  [CODER_TOOL.WRITE_TODOS]: {
    description: TODOS_TOOL.description,
    inputSchema: emitJsonSchema(TODOS_TOOL.inputSchema),
  },
  [CODER_TOOL.POST_TO_INBOX]: {
    description: INBOX_TOOLS.POST.description,
    inputSchema: emitJsonSchema(INBOX_TOOLS.POST.inputSchema),
  },
  [CODER_TOOL.CLOSE_INBOX_ITEM]: {
    description: INBOX_TOOLS.CLOSE.description,
    inputSchema: emitJsonSchema(INBOX_TOOLS.CLOSE.inputSchema),
  },
  [CODER_TOOL.READ_INBOX]: {
    description: INBOX_TOOLS.READ.description,
    inputSchema: emitJsonSchema(INBOX_TOOLS.READ.inputSchema),
  },
  [CODER_TOOL.OPEN_PULL_REQUEST]: {
    description: OPEN_PULL_REQUEST_TOOL.description,
    inputSchema: emitJsonSchema(OPEN_PULL_REQUEST_TOOL.inputSchema),
  },
  [CODER_TOOL.LIST_AGENTS]: {
    description: LIST_AGENTS_TOOL.description,
    inputSchema: emitJsonSchema(LIST_AGENTS_TOOL.inputSchema),
  },
  [CODER_TOOL.MESSAGE_AGENT]: {
    description: MESSAGE_AGENT_TOOL.description,
    inputSchema: emitJsonSchema(MESSAGE_AGENT_TOOL.inputSchema),
  },
  [CODER_TOOL.START_AGENT]: {
    description: START_AGENT_TOOL.description,
    inputSchema: emitJsonSchema(START_AGENT_TOOL.inputSchema),
  },
  [CODER_TOOL.LIST_TASKS]: {
    description: LIST_TASKS_TOOL.description,
    inputSchema: emitJsonSchema(LIST_TASKS_TOOL.inputSchema),
  },
  [CODER_TOOL.LOAD_SKILL]: shown(loadSkill),
  [CODER_TOOL.SHOW_PAGE]: {
    description: SHOW_PAGE_TOOL.description,
    inputSchema: emitJsonSchema(SHOW_PAGE_TOOL.inputSchema),
  },
  [CODER_TOOL.RUN_ON_MAC]: {
    description: RUN_ON_MAC_TOOL.description,
    inputSchema: emitJsonSchema(RUN_ON_MAC_TOOL.inputSchema),
  },
  [CODER_TOOL.SHOW_IMAGE]: {
    description: SHOW_IMAGE_TOOL.description,
    inputSchema: emitJsonSchema(SHOW_IMAGE_TOOL.inputSchema),
  },
  [CODER_TOOL.SLEEP]: shown(SLEEP_TOOL),
} as const satisfies Record<(typeof CODER_TOOL)[keyof typeof CODER_TOOL], ShownTool>;

/** What a step's end says its provider counted; nothing where it counted nothing. */
type StepUsage = Extract<MessageStreamEvent, { type: "step.completed" }>["data"]["usage"];

/** What the step read beside the conversation: the instructions and the first message, as the service composed them. */
export interface StepText {
  readonly instructions: string;
  readonly brief: string;
}

/** The tokens of a value's JSON as eve's compaction estimates them: its bytes over four, rounded up. */
function estimatedTokens(json: string): number {
  return Math.ceil(new TextEncoder().encode(json).byteLength / BYTES_PER_TOKEN);
}

/** The definitions of the authored tools, estimated once: the same for every agent. */
const TOOL_DEFINITION_TOKENS = estimatedTokens(
  JSON.stringify(Object.entries(AUTHORED_TOOLS).map(([name, tool]) => ({ name, ...tool }))),
);

/** The step as the agent's row keeps it, at the instant given; nothing for a step whose provider counted no input, which leaves the last one standing. */
export function agentStepOf(
  usage: StepUsage,
  text: StepText,
  at: number,
): StoredAgentStep | undefined {
  if (usage?.inputTokens === undefined) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens ?? 0,
    ...(usage.cacheReadTokens === undefined
      ? undefined
      : { cachedInputTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined
      ? undefined
      : { cacheWriteTokens: usage.cacheWriteTokens }),
    systemPromptTokens: estimatedTokens(JSON.stringify(text.instructions)),
    toolDefinitionTokens: TOOL_DEFINITION_TOKENS,
    briefTokens: estimatedTokens(JSON.stringify(text.brief)),
    at,
  };
}
