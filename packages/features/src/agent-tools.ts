import { AGENT_DELEGATE_TOOL, AGENT_MESSAGE_TOOL, AGENT_TODOS_TOOL } from "./agent-wire.js";
import { INBOX_TOOL } from "./inbox-wire.js";
import { SHOW_PAGE_TOOL_NAME } from "./page-wire.js";
import { DESCRIPTION_COMMENT_TOOL } from "./description-comment-wire.js";

export const AGENT_TOOL = {
  LOOK_AT_PICTURE: "look_at_picture",
  LIST_AGENTS: "list_agents",
  READ_AGENT: "read_agent",
  MESSAGE_AGENT: AGENT_MESSAGE_TOOL,
  START_AGENT: "start_agent",
  STOP_AGENT: "stop_agent",
  UPDATE_AGENT: "update_agent",
  LIST_TASKS: "list_tasks",
  READ_TASK: "read_task",
  CREATE_TASK: "create_task",
  CREATE_SECTION: "create_section",
  DELETE_SECTION: "delete_section",
  UPDATE_TASK: "update_task",
  LIST_AUTOMATIONS: "list_automations",
  CREATE_AUTOMATION: "create_automation",
  UPDATE_AUTOMATION: "update_automation",
  DELETE_AUTOMATION: "delete_automation",
  RUN_AUTOMATION: "run_automation",
  LIST_MODELS: "list_models",
  SAVE_MEMORY: "save_memory",
  SEARCH_MEMORY: "search_memory",
  WEB_SEARCH: "web_search",
  READ_WEB_PAGE: "read_web_page",
  RUN_ON_MAC: "run_on_mac",
  BROWSER: "browser",
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  GLOB: "glob",
  GREP: "grep",
  APPLY_PATCH: "apply_patch",
  DELEGATE: AGENT_DELEGATE_TOOL,
  EDIT_DESCRIPTION: "edit_description",
  WRITE_TODOS: AGENT_TODOS_TOOL,
  POST_THREAD: INBOX_TOOL.POST,
  WITHDRAW_ASK: INBOX_TOOL.WITHDRAW,
  READ_THREADS: INBOX_TOOL.READ,
  OPEN_PULL_REQUEST: "open_pull_request",
  LOAD_SKILL: "load_skill",
  SHOW_PAGE: SHOW_PAGE_TOOL_NAME,
  READ_COMMENTS: DESCRIPTION_COMMENT_TOOL.READ,
  REPLY_TO_COMMENT: DESCRIPTION_COMMENT_TOOL.REPLY,
  UPDATE_COMMENT: DESCRIPTION_COMMENT_TOOL.UPDATE,
  READ_PAGE: "read_page",
  SHOW_IMAGE: "show_image",
  SLEEP: "sleep",
} as const;

export type AgentTool = (typeof AGENT_TOOL)[keyof typeof AGENT_TOOL];

export const EVE_TOOL = {
  WORKER: "worker",
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

export const CONNECTION_TOOL = {
  SEARCH: "connection_search",
  EXECUTE: "connection_execute",
} as const;

export const RETIRED_TOOL = {
  WEB_FETCH: "web_fetch",
  SEARCH_WEB: "search_web",
  LIST_CODING_AGENTS: "list_coding_agents",
  READ_CODING_AGENT: "read_coding_agent",
  MESSAGE_CODING_AGENT: "message_coding_agent",
  START_CODING_AGENT: "start_coding_agent",
  ARCHIVE_AGENT: "archive_agent",
  UNARCHIVE_AGENT: "unarchive_agent",
  MOVE_TASK: "move_task",
  CLOSE_INBOX_ITEM: "close_inbox_item",
  REPLY_INBOX: "reply_inbox",
  LIST_ISSUES: "list_issues",
  READ_ISSUE: "read_issue",
  CREATE_ISSUE: "create_issue",
  UPDATE_ISSUE: "update_issue",
  POST_TO_INBOX: "post_to_inbox",
  READ_INBOX: "read_inbox",
  POST_CHAT: "post_chat",
  READ_CHAT: "read_chat",
  RESOLVE_ASK: "resolve_ask",
  EDIT_CHANNEL: "edit_channel",
  CREATE_CHANNEL: "create_channel",
  UPDATE_CHANNEL: "update_channel",
  MOVE_THREAD: "move_thread",
  SHOW_CODE: "show_code",
  DRAW_ON_BOARD: "draw_on_board",
  LOOK_AT_BOARD: "look_at_board",
  QUEUE_QUESTION: "queue_question",
  WITHDRAW_QUESTION: "withdraw_question",
  END_CALL: "end_call",
  REMEMBER: "remember",
  RECALL: "recall",
  RESOLVE_THREAD: "resolve_thread",
  REOPEN_THREAD: "reopen_thread",
  EDIT_PLAN: "edit_plan",
} as const;

export const RENAMED_TOOL: ReadonlyMap<string, AgentTool> = new Map([
  [RETIRED_TOOL.EDIT_PLAN, AGENT_TOOL.EDIT_DESCRIPTION],
]);

export const CLAUDE_CODE_TOOL = {
  BASH: "Bash",
  READ: "Read",
  EDIT: "Edit",
  WRITE: "Write",
  NOTEBOOK_EDIT: "NotebookEdit",
  GLOB: "Glob",
  GREP: "Grep",
  WEB_FETCH: "WebFetch",
  WEB_SEARCH: "WebSearch",
  TODO_WRITE: "TodoWrite",
  TASK_CREATE: "TaskCreate",
  TASK_UPDATE: "TaskUpdate",
  TASK_LIST: "TaskList",
  TASK_GET: "TaskGet",
  TASK_STOP: "TaskStop",
  AGENT: "Agent",
  SEND_MESSAGE: "SendMessage",
  SKILL: "Skill",
  MONITOR: "Monitor",
  SCHEDULE_WAKEUP: "ScheduleWakeup",
} as const;

export const CLAUDE_CODE_UNRECORDED_TOOL = {
  TOOL_SEARCH: "ToolSearch",
} as const;

export const WORKSPACE_MCP_SERVER = "workspace";

export const WORKSPACE_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  WORKSPACE_MCP_SERVER,
  "luke",
]);

export function claudeCodeWorkspaceTool(name: string): string | undefined {
  for (const server of WORKSPACE_MCP_SERVER_NAMES) {
    const prefix = `mcp__${server}__`;
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return undefined;
}

export const CODEX_TOOL = {
  COMMAND_EXECUTION: "commandExecution",
  FILE_CHANGE: "fileChange",
  MCP_TOOL_CALL: "mcpToolCall",
  WEB_SEARCH: "webSearch",
  TODO_LIST: "todoList",
  SUBAGENT: "collabAgentToolCall",
  IMAGE_VIEW: "imageView",
} as const;
