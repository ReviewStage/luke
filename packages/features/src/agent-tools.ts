/**
 * agent-tools.ts -- every tool name an agent's transcript may carry, which the service offers and the desktop draws.
 *
 * The service's tool registry (`packages/service/src/agents/agent-runtime/tools.ts`)
 * says which roles each of our tools serves; the names themselves are
 * declared here, once, so the desktop reads a call in a transcript by the
 * same name the service offered it under, the brain's as a coding
 * agent's. Beside them stand the names eve gives tools of its own that a
 * brain's transcript carries, and the coding agents' web reads that earlier
 * transcripts still name.
 */

import { AGENT_DELEGATE_TOOL, AGENT_MESSAGE_TOOL, AGENT_TODOS_TOOL } from "./agent-wire.js";
import { INBOX_TOOL } from "./inbox-wire.js";
import { SHOW_PAGE_TOOL_NAME } from "./page-wire.js";
import { DESCRIPTION_COMMENT_TOOL } from "./description-comment-wire.js";

/** Every tool we author or declare for a model, by the name the model calls it by. */
export const AGENT_TOOL = {
  // A look at one of the description's pictures, the planning model's and a coding agent's.
  LOOK_AT_PICTURE: "look_at_picture",
  // The tools about the workspace's coding agents, named for any agent offered them.
  LIST_AGENTS: "list_agents",
  READ_AGENT: "read_agent",
  // One agent's message to another of its workspace, shown in the two agents' transcripts alone.
  MESSAGE_AGENT: AGENT_MESSAGE_TOOL,
  START_AGENT: "start_agent",
  STOP_AGENT: "stop_agent",
  UPDATE_AGENT: "update_agent",
  LIST_TASKS: "list_tasks",
  READ_TASK: "read_task",
  CREATE_TASK: "create_task",
  // The sections the member keeps tasks in in the workspace's sidebar, named for any agent offered `list_tasks`.
  CREATE_SECTION: "create_section",
  DELETE_SECTION: "delete_section",
  // A task of the workspace renamed, given a repository, pinned, or archived, named for any agent offered `list_tasks`.
  UPDATE_TASK: "update_task",
  // The workspace's automations, listed, made, changed, and deleted for the member an agent acts for.
  LIST_AUTOMATIONS: "list_automations",
  CREATE_AUTOMATION: "create_automation",
  UPDATE_AUTOMATION: "update_automation",
  DELETE_AUTOMATION: "delete_automation",
  RUN_AUTOMATION: "run_automation",
  // The models an agent may be started on, named for any agent offered `start_agent`.
  LIST_MODELS: "list_models",
  // The workspace's shared memory, which a coding agent keeps and searches.
  SAVE_MEMORY: "save_memory",
  SEARCH_MEMORY: "search_memory",
  // The public reads, every role's: eve's provider-run search on the agent's own model call, and the page read.
  WEB_SEARCH: "web_search",
  READ_WEB_PAGE: "read_web_page",
  // A command on the developer's own Mac, every role's.
  RUN_ON_MAC: "run_on_mac",
  // A real browser in the agent's own sandbox, which the developer can watch and take over, every role's.
  BROWSER: "browser",
  // eve's shell and file tools and the code extension's, started in a coding agent's checkout.
  BASH: "bash",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  GLOB: "glob",
  GREP: "grep",
  APPLY_PATCH: "apply_patch",
  // A coding agent's own, and the delegation every agent makes.
  DELEGATE: AGENT_DELEGATE_TOOL,
  EDIT_DESCRIPTION: "edit_description",
  WRITE_TODOS: AGENT_TODOS_TOOL,
  POST_THREAD: INBOX_TOOL.POST,
  WITHDRAW_ASK: INBOX_TOOL.WITHDRAW,
  READ_THREADS: INBOX_TOOL.READ,
  OPEN_PULL_REQUEST: "open_pull_request",
  // eve's own, which loads one of the skills a session is offered.
  LOAD_SKILL: "load_skill",
  // An interactive page shown in the task's side panel, and a read of one by its id.
  SHOW_PAGE: SHOW_PAGE_TOOL_NAME,
  // The description's comment threads, read and answered by the planning model and every coding agent on the task.
  READ_COMMENTS: DESCRIPTION_COMMENT_TOOL.READ,
  REPLY_TO_COMMENT: DESCRIPTION_COMMENT_TOOL.REPLY,
  UPDATE_COMMENT: DESCRIPTION_COMMENT_TOOL.UPDATE,
  READ_PAGE: "read_page",
  // Pictures from a coding agent's sandbox, shown in its transcript.
  SHOW_IMAGE: "show_image",
  // eve's own durable pause, which a coding agent takes before it checks on its checks or a deploy again.
  SLEEP: "sleep",
} as const;

export type AgentTool = (typeof AGENT_TOOL)[keyof typeof AGENT_TOOL];

/**
 * The tools eve gives a brain session of its own, which its transcript
 * carries: its subagent tool for the worker, which earlier transcripts name
 * where the brain now calls its own `delegate`, and the two task
 * controls it adds beside any task. Note that their names are eve's own and
 * the tasks they name are eve's subagent tasks, not a task of ours.
 */
export const EVE_TOOL = {
  WORKER: "worker",
  TASK_WAIT: "task_wait",
  TASK_CANCEL: "task_cancel",
} as const;

/**
 * eve's own two tools for a connection, which any agent's transcript may
 * carry: one lists a connection's tools and one runs one. The call it ran
 * is stored beside the run, under its integration's remote name
 * (`integration-wire.ts`'s `INTEGRATION_REMOTE_TOOL`).
 */
export const CONNECTION_TOOL = {
  SEARCH: "connection_search",
  EXECUTE: "connection_execute",
} as const;

/**
 * Tools no agent is offered now whose calls a transcript written then still
 * names: eve's provider-run web reads, which coding agents ran before they
 * had the public reads, the planning model's four tools about the
 * task's coding agents, since named as `AGENT_TOOL`'s agent tools, the
 * four about the workspace's own issues, gone with them, the inbox's
 * post and read, since named for the threads they post and read,
 * the four of the workspace's Chat, removed with it, the three that made,
 * changed, and moved threads between channels, removed with them, the brain's lines of
 * code put on the developer's screen and its two whiteboard tools, removed
 * with the Code and Board tabs, a voice call's question queue and
 * hang-up, removed with GPT Live, the memory's two tools, since named for
 * the memory, the plan comments' resolve and reopen, folded into
 * `update_comment`, and the plan's edit, renamed for the description it
 * edits.
 */
export const RETIRED_TOOL = {
  WEB_FETCH: "web_fetch",
  // Our own search on our key, replaced by eve's provider-run `web_search` on the agent's own key.
  SEARCH_WEB: "search_web",
  LIST_CODING_AGENTS: "list_coding_agents",
  READ_CODING_AGENT: "read_coding_agent",
  MESSAGE_CODING_AGENT: "message_coding_agent",
  START_CODING_AGENT: "start_coding_agent",
  // Folded into `update_agent` (`archived`, `reason`) and `update_task` (`sectionId`).
  ARCHIVE_AGENT: "archive_agent",
  UNARCHIVE_AGENT: "unarchive_agent",
  MOVE_TASK: "move_task",
  // Folded into `post_to_inbox` (a post that asks nothing) and `withdraw_ask`.
  CLOSE_INBOX_ITEM: "close_inbox_item",
  REPLY_INBOX: "reply_inbox",
  // Our own issues, removed: a task carries its status and priority now.
  LIST_ISSUES: "list_issues",
  READ_ISSUE: "read_issue",
  CREATE_ISSUE: "create_issue",
  UPDATE_ISSUE: "update_issue",
  // Renamed `post_thread` and `read_threads`, for the threads they post and read.
  POST_TO_INBOX: "post_to_inbox",
  READ_INBOX: "read_inbox",
  // The workspace's Chat, removed with it.
  POST_CHAT: "post_chat",
  READ_CHAT: "read_chat",
  RESOLVE_ASK: "resolve_ask",
  EDIT_CHANNEL: "edit_channel",
  // The workspace's channels, made, changed, and a thread moved between them, removed with them.
  CREATE_CHANNEL: "create_channel",
  UPDATE_CHANNEL: "update_channel",
  MOVE_THREAD: "move_thread",
  // Code snippets and the task's whiteboard, removed with them.
  SHOW_CODE: "show_code",
  DRAW_ON_BOARD: "draw_on_board",
  LOOK_AT_BOARD: "look_at_board",
  // A voice call's own tools, removed with GPT Live.
  QUEUE_QUESTION: "queue_question",
  WITHDRAW_QUESTION: "withdraw_question",
  END_CALL: "end_call",
  // Renamed `save_memory` and `search_memory`, as every other tool names what it acts on.
  REMEMBER: "remember",
  RECALL: "recall",
  // Folded into `update_comment` (`resolved`), whose name no inbox thread's tool shares.
  RESOLVE_THREAD: "resolve_thread",
  REOPEN_THREAD: "reopen_thread",
  // Renamed `edit_description`, as the task's document is its description.
  EDIT_PLAN: "edit_plan",
} as const;

/**
 * The retired tools a call may still name, from an agent whose session
 * listed its tools before they were renamed, each with the tool that took
 * its place, which the service names in its refusal rather than answering
 * an unknown tool.
 */
export const RENAMED_TOOL: ReadonlyMap<string, AgentTool> = new Map([
  [RETIRED_TOOL.EDIT_PLAN, AGENT_TOOL.EDIT_DESCRIPTION],
]);

/**
 * Claude Code's own tools, by the names its CLI calls them, which a coding
 * agent running on Claude Code calls in place of our shell, file, search,
 * todo, delegation, skill, and web tools, and waits with (background Bash,
 * `Monitor`, `ScheduleWakeup`). Its to-dos are the CLI's task list, one
 * task created, updated, listed, and read at a time (the four `Task*`
 * tools, which replaced `TodoWrite`'s whole list in CLI 2.1.304; an older
 * transcript still names `TodoWrite`). It stops what it started in the
 * background with `TaskStop`, and sends one of its subagents more with
 * `SendMessage`. Its transcript stores each call under this name; a call to
 * our own MCP server is stored under our tool's name
 * (`claudeCodeWorkspaceTool`).
 */
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

/**
 * Claude Code's own tools no transcript records, by their CLI names:
 * `ToolSearch` loads a deferred tool's schema before its first call, which is
 * the harness reading its own catalog rather than work of the agent's.
 */
export const CLAUDE_CODE_UNRECORDED_TOOL = {
  TOOL_SEARCH: "ToolSearch",
} as const;

/** The name our MCP server is registered under, in Claude Code (`mcpServers.workspace`) and Codex (`mcp_servers.workspace`) alike. */
export const WORKSPACE_MCP_SERVER = "workspace";

/**
 * Every name a stored call may give our MCP server: today's, then `luke`,
 * which it was registered under before, so a transcript stored then still
 * draws its calls as our tools.
 */
export const WORKSPACE_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  WORKSPACE_MCP_SERVER,
  "luke",
]);

/** Our tool's own name from a Claude Code call's, `mcp__workspace__read_threads` being our `read_threads`; none for a tool of any other server. */
export function claudeCodeWorkspaceTool(name: string): string | undefined {
  for (const server of WORKSPACE_MCP_SERVER_NAMES) {
    const prefix = `mcp__${server}__`;
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return undefined;
}

/**
 * Codex's own work, by the type of the app-server item that does it (its
 * todo list by its own name, since Codex reports it as the turn's plan
 * rather than as an item), which a coding agent running on Codex does in
 * place of our shell, file, search, todo, and delegation tools, and a
 * picture it looked at with `view_image`. Its
 * transcript stores each under this name; a call to our own MCP server is
 * stored under our tool's name (`WORKSPACE_MCP_SERVER_NAMES`), and a call to
 * any other MCP server as `mcpToolCall`.
 */
export const CODEX_TOOL = {
  COMMAND_EXECUTION: "commandExecution",
  FILE_CHANGE: "fileChange",
  MCP_TOOL_CALL: "mcpToolCall",
  WEB_SEARCH: "webSearch",
  TODO_LIST: "todoList",
  SUBAGENT: "collabAgentToolCall",
  IMAGE_VIEW: "imageView",
} as const;
