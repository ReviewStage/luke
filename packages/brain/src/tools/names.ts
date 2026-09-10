/**
 * The names and bounds of the tools the brain answers itself, fixed here in
 * the tools' own directory so a module, the catalog, and the executor name
 * one thing.
 */
export const BRAIN_TOOL = {
  LIST_SESSIONS: "list_sessions",
  READ_TRANSCRIPT: "read_transcript",
  ANNOUNCE: "announce",
  READ_WORKSPACE_FILE: "read_workspace_file",
  WRITE_WORKSPACE_FILE: "write_workspace_file",
  LOAD_SKILL: "load_skill",
  SESSIONS_SPAWN: "sessions_spawn",
  SUBAGENTS: "subagents",
  SESSIONS_LIST: "sessions_list",
  SESSIONS_HISTORY: "sessions_history",
} as const;

export type BrainToolName = (typeof BRAIN_TOOL)[keyof typeof BRAIN_TOOL];

const BRAIN_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(BRAIN_TOOL));

/** Whether a call names a tool the agent answers itself rather than an action or the memory provider's. */
export function isBrainOnlyTool(name: string): name is BrainToolName {
  return BRAIN_ONLY_TOOL_NAMES.has(name);
}

export const TOOL_GROUP = {
  READ: "read",
  ACTIONS: "actions",
  SPEAK: "speak",
  WORKSPACE: "workspace",
  SKILLS: "skills",
  /** Delegation and the inspection of Luke's own conversations, OpenClaw's session tools. */
  SESSIONS: "sessions",
  /** The memory provider's tools and the notebook's two writes, OpenClaw's memory tools. */
  MEMORY: "memory",
} as const;

/** The longest briefing the mouth is handed; a briefing is a breath, not a report. */
export const maximumBriefingLength = 600;

/** The most of a child task's words a spawn carries; a task is a brief, not a transcript. */
export const maximumChildTaskLength = 8_000;

/** The most history lines one `sessions_history` read answers with. */
export const maximumSessionsConversationLines = 50;
