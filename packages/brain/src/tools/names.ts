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
  APPEND_DAILY_NOTE: "append_daily_note",
  LIST_DAILY_NOTES: "list_daily_notes",
  LOAD_SKILL: "load_skill",
  SESSIONS_SPAWN: "sessions_spawn",
  SUBAGENTS: "subagents",
  SESSIONS_LIST: "sessions_list",
  SESSIONS_HISTORY: "sessions_history",
} as const;

export type BrainToolName = (typeof BRAIN_TOOL)[keyof typeof BRAIN_TOOL];

/** What a `subagents` call does: list the children, the default, or cancel one. */
export const SUBAGENTS_ACTION = {
  LIST: "list",
  CANCEL: "cancel",
} as const;

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
  /** The memory provider's tools, the notebook's search and read, OpenClaw's memory tools; the notebook is written through `write_workspace_file`. */
  MEMORY: "memory",
} as const;

/**
 * The longest briefing the mouth is handed; a briefing is a breath, not a
 * report. Two short sentences, about twelve seconds aloud: voice UX research
 * puts a listener's drop-off at six seconds and most of them gone by ten, and
 * the persona already says one sentence, two only when the second earned its
 * place. The bound used to be 600, which is forty seconds of speech.
 */
export const maximumBriefingLength = 200;

/** The most of a child task's words a spawn carries; a task is a brief, not a transcript. */
export const maximumChildTaskLength = 8_000;

/** The most history lines one `sessions_history` read answers with. */
export const maximumSessionsConversationLines = 50;

/** The most dated notes one `list_daily_notes` read answers with, the newest first; two months of daily notes. */
export const maximumListedDailyNotes = 60;
