import type { Agent } from "@repo/database/models/agent-store";
import { CLAUDE_CODE_TOOL, CODEX_TOOL, RETIRED_TOOL } from "@repo/features/agent-tools";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { WireValueSchema } from "@repo/wire";
import { verbatimJsonSchema } from "@repo/wire/effect";
import type { ToolSet } from "ai";
import { wireValidatedTool } from "../../core.js";
import { connectionToolEntries } from "../../integrations/connection-tools.js";
import { AGENT_ROLE } from "../agent-runtime/role.js";
import { AGENT_TOOL, type AgentTool, toolsOf } from "../agent-runtime/tools.js";

export const CODER_TOOL = {
  BASH: AGENT_TOOL.BASH,
  READ_FILE: AGENT_TOOL.READ_FILE,
  WRITE_FILE: AGENT_TOOL.WRITE_FILE,
  GLOB: AGENT_TOOL.GLOB,
  GREP: AGENT_TOOL.GREP,
  APPLY_PATCH: AGENT_TOOL.APPLY_PATCH,
  WEB_SEARCH: AGENT_TOOL.WEB_SEARCH,
  READ_WEB_PAGE: AGENT_TOOL.READ_WEB_PAGE,
  DELEGATE: AGENT_TOOL.DELEGATE,
  EDIT_DESCRIPTION: AGENT_TOOL.EDIT_DESCRIPTION,
  LOOK_AT_PICTURE: AGENT_TOOL.LOOK_AT_PICTURE,
  WRITE_TODOS: AGENT_TOOL.WRITE_TODOS,
  POST_THREAD: AGENT_TOOL.POST_THREAD,
  WITHDRAW_ASK: AGENT_TOOL.WITHDRAW_ASK,
  READ_THREADS: AGENT_TOOL.READ_THREADS,
  OPEN_PULL_REQUEST: AGENT_TOOL.OPEN_PULL_REQUEST,
  LIST_AGENTS: AGENT_TOOL.LIST_AGENTS,
  READ_AGENT: AGENT_TOOL.READ_AGENT,
  MESSAGE_AGENT: AGENT_TOOL.MESSAGE_AGENT,
  START_AGENT: AGENT_TOOL.START_AGENT,
  STOP_AGENT: AGENT_TOOL.STOP_AGENT,
  UPDATE_AGENT: AGENT_TOOL.UPDATE_AGENT,
  LIST_TASKS: AGENT_TOOL.LIST_TASKS,
  READ_TASK: AGENT_TOOL.READ_TASK,
  CREATE_TASK: AGENT_TOOL.CREATE_TASK,
  CREATE_SECTION: AGENT_TOOL.CREATE_SECTION,
  DELETE_SECTION: AGENT_TOOL.DELETE_SECTION,
  UPDATE_TASK: AGENT_TOOL.UPDATE_TASK,
  LIST_AUTOMATIONS: AGENT_TOOL.LIST_AUTOMATIONS,
  CREATE_AUTOMATION: AGENT_TOOL.CREATE_AUTOMATION,
  UPDATE_AUTOMATION: AGENT_TOOL.UPDATE_AUTOMATION,
  DELETE_AUTOMATION: AGENT_TOOL.DELETE_AUTOMATION,
  RUN_AUTOMATION: AGENT_TOOL.RUN_AUTOMATION,
  LIST_MODELS: AGENT_TOOL.LIST_MODELS,
  SAVE_MEMORY: AGENT_TOOL.SAVE_MEMORY,
  SEARCH_MEMORY: AGENT_TOOL.SEARCH_MEMORY,
  LOAD_SKILL: AGENT_TOOL.LOAD_SKILL,
  SHOW_PAGE: AGENT_TOOL.SHOW_PAGE,
  READ_COMMENTS: AGENT_TOOL.READ_COMMENTS,
  REPLY_TO_COMMENT: AGENT_TOOL.REPLY_TO_COMMENT,
  UPDATE_COMMENT: AGENT_TOOL.UPDATE_COMMENT,
  READ_PAGE: AGENT_TOOL.READ_PAGE,
  RUN_ON_MAC: AGENT_TOOL.RUN_ON_MAC,
  BROWSER: AGENT_TOOL.BROWSER,
  SHOW_IMAGE: AGENT_TOOL.SHOW_IMAGE,
  SLEEP: AGENT_TOOL.SLEEP,
} as const;

export type RepositoryTool = typeof CODER_TOOL.OPEN_PULL_REQUEST | typeof CODER_TOOL.APPLY_PATCH;

export function repositoryToolsOf(agent: Pick<Agent, "repository">): ReadonlySet<RepositoryTool> {
  if (agent.repository === null) return new Set();
  return new Set([CODER_TOOL.OPEN_PULL_REQUEST, CODER_TOOL.APPLY_PATCH]);
}

export type MachineTool = typeof CODER_TOOL.BROWSER;

export function machineToolsOf(agent: Pick<Agent, "machine">): ReadonlySet<MachineTool> {
  return agent.machine === AGENT_MACHINE.DEVICE ? new Set() : new Set([CODER_TOOL.BROWSER]);
}

export type MacTool = typeof CODER_TOOL.RUN_ON_MAC;

export function macToolsOf(agent: Pick<Agent, "machine">): ReadonlySet<MacTool> {
  if (agent.machine === AGENT_MACHINE.DEVICE) return new Set();
  return new Set([CODER_TOOL.RUN_ON_MAC]);
}

export type CoderOfferedTo = Pick<Agent, "repository" | "machine">;

export interface OfferedBeside {
  readonly memoryOn: boolean;
  readonly descriptionsOn: boolean;
}

const NARROWED_CODER_TOOLS: ReadonlySet<AgentTool> = new Set<AgentTool>([
  ...repositoryToolsOf({ repository: "any" }),
  ...machineToolsOf({ machine: AGENT_MACHINE.VERCEL }),
  ...macToolsOf({ machine: AGENT_MACHINE.VERCEL }),
  CODER_TOOL.SAVE_MEMORY,
  CODER_TOOL.SEARCH_MEMORY,
  CODER_TOOL.EDIT_DESCRIPTION,
  CODER_TOOL.LOOK_AT_PICTURE,
]);

export function offeredCoderTools(
  agent: CoderOfferedTo,
  beside: OfferedBeside,
): readonly AgentTool[] {
  const offered: ReadonlySet<AgentTool> = new Set<AgentTool>([
    ...repositoryToolsOf(agent),
    ...machineToolsOf(agent),
    ...macToolsOf(agent),
    ...(beside.memoryOn ? [CODER_TOOL.SAVE_MEMORY, CODER_TOOL.SEARCH_MEMORY] : []),
    ...(beside.descriptionsOn ? [CODER_TOOL.EDIT_DESCRIPTION, CODER_TOOL.LOOK_AT_PICTURE] : []),
  ]);
  return [...toolsOf(AGENT_ROLE.CODER)].filter(
    (tool) => !NARROWED_CODER_TOOLS.has(tool) || offered.has(tool),
  );
}

export const RETIRED_CODER_TOOL = {
  WEB_FETCH: "web_fetch",
  SEARCH_WEB: RETIRED_TOOL.SEARCH_WEB,
  ARCHIVE_AGENT: RETIRED_TOOL.ARCHIVE_AGENT,
  UNARCHIVE_AGENT: RETIRED_TOOL.UNARCHIVE_AGENT,
  MOVE_TASK: RETIRED_TOOL.MOVE_TASK,
  CLOSE_INBOX_ITEM: RETIRED_TOOL.CLOSE_INBOX_ITEM,
  REPLY_INBOX: RETIRED_TOOL.REPLY_INBOX,
  POST_TO_INBOX: RETIRED_TOOL.POST_TO_INBOX,
  READ_INBOX: RETIRED_TOOL.READ_INBOX,
  POST_CHAT: RETIRED_TOOL.POST_CHAT,
  READ_CHAT: RETIRED_TOOL.READ_CHAT,
  RESOLVE_ASK: RETIRED_TOOL.RESOLVE_ASK,
  EDIT_CHANNEL: RETIRED_TOOL.EDIT_CHANNEL,
  CREATE_CHANNEL: RETIRED_TOOL.CREATE_CHANNEL,
  UPDATE_CHANNEL: RETIRED_TOOL.UPDATE_CHANNEL,
  MOVE_THREAD: RETIRED_TOOL.MOVE_THREAD,
  SHOW_CODE: RETIRED_TOOL.SHOW_CODE,
  DRAW_ON_BOARD: RETIRED_TOOL.DRAW_ON_BOARD,
  LOOK_AT_BOARD: RETIRED_TOOL.LOOK_AT_BOARD,
  QUEUE_QUESTION: RETIRED_TOOL.QUEUE_QUESTION,
  WITHDRAW_QUESTION: RETIRED_TOOL.WITHDRAW_QUESTION,
  END_CALL: RETIRED_TOOL.END_CALL,
  REMEMBER: RETIRED_TOOL.REMEMBER,
  RECALL: RETIRED_TOOL.RECALL,
  RESOLVE_THREAD: RETIRED_TOOL.RESOLVE_THREAD,
  REOPEN_THREAD: RETIRED_TOOL.REOPEN_THREAD,
} as const;

const TOOL_INPUT = verbatimJsonSchema(WireValueSchema, {
  type: "object",
  additionalProperties: true,
});

const CODER_TASK_TOOL = {
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

export const CODER_TOOL_SET: ToolSet = Object.fromEntries([
  ...[
    ...new Set([
      ...toolsOf(AGENT_ROLE.CODER),
      ...toolsOf(AGENT_ROLE.CODER_WORKER),
      ...Object.values(CODER_TASK_TOOL),
      ...Object.values(RETIRED_CODER_TOOL),
      ...Object.values(CLAUDE_CODE_TOOL),
      ...Object.values(CODEX_TOOL),
    ]),
  ].map((name) => [name, wireValidatedTool(`eve's ${name} tool`, TOOL_INPUT)]),
  ...connectionToolEntries(),
]);
