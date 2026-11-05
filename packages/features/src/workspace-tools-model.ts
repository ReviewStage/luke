/**
 * workspace-tools-model.ts -- what an agent's MCP popover says of our own tools: each one's group and one line of what it does, and whether `run_on_mac` is on for the agent and why not.
 *
 * Which of our tools an agent is offered is the service's answer
 * (`workspace-tools-wire.ts`), read off the same rules its runtime narrows the
 * list by, so it never drifts from what the agent is handed. What each tool
 * is called beside its name, and the group it stands under, is said here,
 * once, for every tool in `AGENT_TOOL`: a tool added there does not build
 * until it has its line. A name the service answers that this build does not
 * know, a tool added after it, stands under the last group with no words.
 *
 * `run_on_mac` runs on the Mac of the agent's task's assignee, or its
 * starter's where no one is assigned, and is on unless one of two things
 * stops it, said in this order: this Mac's Settings › This Mac lets no
 * agent run commands on it, which only that member reading on a Mac can be
 * told; or no Mac of theirs is listening for commands. This Mac's setting
 * is the reason only where the service says `run_on_mac` is off, because
 * the service counts any listening Mac of theirs: one set to Never beside
 * another that listens still runs the agent's commands there.
 */

import { AGENT_TOOL, type AgentTool } from "./agent-tools.js";
import { PRODUCT_NAME } from "./product-name.js";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "./workspace-tools-wire.js";

/** The groups our tools stand under on their page, in the order they are drawn. */
export const WORKSPACE_TOOL_GROUP = {
  MAC: "Your Mac",
  THREADS: "Threads",
  AGENTS: "Agents and tasks",
  AUTOMATIONS: "Automations",
  PLAN: "Plan and comments",
  PAGES: "Pages and pictures",
  WEB: "Browser and web",
  CODE: "Code",
  MEMORY: "Memory",
  OTHER: "Other",
} as const;

export type WorkspaceToolGroup = (typeof WORKSPACE_TOOL_GROUP)[keyof typeof WORKSPACE_TOOL_GROUP];

const GROUP_ORDER: readonly WorkspaceToolGroup[] = Object.values(WORKSPACE_TOOL_GROUP);

/** One of our tools as its page says it: its group, and one line of what it does. */
interface WorkspaceToolWords {
  readonly group: WorkspaceToolGroup;
  readonly summary: string;
}

/** Every tool of ours, by its name: its group and one line of what it does. */
const WORKSPACE_TOOL_WORDS = {
  [AGENT_TOOL.RUN_ON_MAC]: {
    group: WORKSPACE_TOOL_GROUP.MAC,
    summary: "Runs a shell command on the task assignee's Mac",
  },
  [AGENT_TOOL.POST_THREAD]: {
    group: WORKSPACE_TOOL_GROUP.THREADS,
    summary: "Posts a thread to the inbox",
  },
  [AGENT_TOOL.READ_THREADS]: {
    group: WORKSPACE_TOOL_GROUP.THREADS,
    summary: "Reads the threads it posted and their answers",
  },
  [AGENT_TOOL.WITHDRAW_ASK]: {
    group: WORKSPACE_TOOL_GROUP.THREADS,
    summary: "Withdraws an ask it no longer needs answered",
  },
  [AGENT_TOOL.LIST_AGENTS]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Lists the workspace's agents",
  },
  [AGENT_TOOL.READ_AGENT]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Reads where another agent stands and what it published",
  },
  [AGENT_TOOL.MESSAGE_AGENT]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Sends another agent a message",
  },
  [AGENT_TOOL.START_AGENT]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Starts a new agent on a task",
  },
  [AGENT_TOOL.STOP_AGENT]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Stops another agent's turn",
  },
  [AGENT_TOOL.UPDATE_AGENT]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Renames, pins, moves, or archives an agent",
  },
  [AGENT_TOOL.LIST_MODELS]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Lists the models an agent may be started on",
  },
  [AGENT_TOOL.LIST_TASKS]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Lists the workspace's tasks",
  },
  [AGENT_TOOL.READ_TASK]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Reads a task and its plan",
  },
  [AGENT_TOOL.CREATE_TASK]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Makes a task",
  },
  [AGENT_TOOL.UPDATE_TASK]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Renames a task or changes where it stands",
  },
  [AGENT_TOOL.CREATE_SECTION]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Makes a section in the sidebar",
  },
  [AGENT_TOOL.DELETE_SECTION]: {
    group: WORKSPACE_TOOL_GROUP.AGENTS,
    summary: "Deletes a section of the sidebar",
  },
  [AGENT_TOOL.LIST_AUTOMATIONS]: {
    group: WORKSPACE_TOOL_GROUP.AUTOMATIONS,
    summary: "Lists the workspace's automations",
  },
  [AGENT_TOOL.CREATE_AUTOMATION]: {
    group: WORKSPACE_TOOL_GROUP.AUTOMATIONS,
    summary: "Makes an automation",
  },
  [AGENT_TOOL.UPDATE_AUTOMATION]: {
    group: WORKSPACE_TOOL_GROUP.AUTOMATIONS,
    summary: "Changes an automation",
  },
  [AGENT_TOOL.DELETE_AUTOMATION]: {
    group: WORKSPACE_TOOL_GROUP.AUTOMATIONS,
    summary: "Deletes an automation",
  },
  [AGENT_TOOL.RUN_AUTOMATION]: {
    group: WORKSPACE_TOOL_GROUP.AUTOMATIONS,
    summary: "Runs an automation now",
  },
  [AGENT_TOOL.EDIT_PLAN]: {
    group: WORKSPACE_TOOL_GROUP.PLAN,
    summary: "Takes notes in its task's plan",
  },
  [AGENT_TOOL.READ_COMMENTS]: {
    group: WORKSPACE_TOOL_GROUP.PLAN,
    summary: "Reads the comment threads on the plan",
  },
  [AGENT_TOOL.REPLY_TO_COMMENT]: {
    group: WORKSPACE_TOOL_GROUP.PLAN,
    summary: "Answers a comment thread it was mentioned in",
  },
  [AGENT_TOOL.UPDATE_COMMENT]: {
    group: WORKSPACE_TOOL_GROUP.PLAN,
    summary: "Resolves or reopens a comment thread",
  },
  [AGENT_TOOL.SHOW_PAGE]: {
    group: WORKSPACE_TOOL_GROUP.PAGES,
    summary: "Shows a page in the side panel",
  },
  [AGENT_TOOL.READ_PAGE]: {
    group: WORKSPACE_TOOL_GROUP.PAGES,
    summary: "Reads a page shown in the workspace",
  },
  [AGENT_TOOL.SHOW_IMAGE]: {
    group: WORKSPACE_TOOL_GROUP.PAGES,
    summary: "Shows pictures from its sandbox in the transcript",
  },
  [AGENT_TOOL.LOOK_AT_PICTURE]: {
    group: WORKSPACE_TOOL_GROUP.PAGES,
    summary: "Looks at a picture in the plan",
  },
  [AGENT_TOOL.BROWSER]: {
    group: WORKSPACE_TOOL_GROUP.WEB,
    summary: "Drives a browser in its sandbox you can watch",
  },
  [AGENT_TOOL.WEB_SEARCH]: {
    group: WORKSPACE_TOOL_GROUP.WEB,
    summary: "Searches the public web",
  },
  [AGENT_TOOL.READ_WEB_PAGE]: {
    group: WORKSPACE_TOOL_GROUP.WEB,
    summary: "Reads a public web page",
  },
  [AGENT_TOOL.BASH]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Runs a shell command in its sandbox",
  },
  [AGENT_TOOL.READ_FILE]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Reads a file in its checkout",
  },
  [AGENT_TOOL.WRITE_FILE]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Writes a file in its checkout",
  },
  [AGENT_TOOL.GLOB]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Finds files by their paths",
  },
  [AGENT_TOOL.GREP]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Searches files for a pattern",
  },
  [AGENT_TOOL.APPLY_PATCH]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Edits files in its checkout with a patch",
  },
  [AGENT_TOOL.OPEN_PULL_REQUEST]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Opens the pull request for a branch it pushed",
  },
  [AGENT_TOOL.DELEGATE]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Hands a read-only job to a worker",
  },
  [AGENT_TOOL.WRITE_TODOS]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Keeps its to-do list",
  },
  [AGENT_TOOL.LOAD_SKILL]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Loads one of the repository's skills",
  },
  [AGENT_TOOL.SLEEP]: {
    group: WORKSPACE_TOOL_GROUP.CODE,
    summary: "Waits before it checks on its checks or a deploy",
  },
  [AGENT_TOOL.SAVE_MEMORY]: {
    group: WORKSPACE_TOOL_GROUP.MEMORY,
    summary: "Keeps a fact in the workspace's memory",
  },
  [AGENT_TOOL.SEARCH_MEMORY]: {
    group: WORKSPACE_TOOL_GROUP.MEMORY,
    summary: "Searches the workspace's memory",
  },
} as const satisfies { readonly [Tool in AgentTool]: WorkspaceToolWords };

/** One tool as our tools' page draws it: its name, and one line of what it does where this build knows it. */
export interface WorkspaceToolRow {
  readonly name: string;
  readonly summary?: string;
}

/** One group of our tools' page: its heading and its tools, in the order the service answered them. */
export interface WorkspaceToolSection {
  readonly heading: WorkspaceToolGroup;
  readonly tools: readonly WorkspaceToolRow[];
}

function wordsOf(name: string): WorkspaceToolWords | undefined {
  return Object.hasOwn(WORKSPACE_TOOL_WORDS, name)
    ? WORKSPACE_TOOL_WORDS[name as AgentTool]
    : undefined;
}

/** One line of what a tool of ours does; nothing for a name this build does not know. */
export function workspaceToolSummary(name: string): string | undefined {
  return wordsOf(name)?.summary;
}

/** The tools the service named, under their groups in the page's order, each group's in the order named; no group stands empty. */
export function workspaceToolSections(names: readonly string[]): readonly WorkspaceToolSection[] {
  return GROUP_ORDER.flatMap((heading) => {
    const tools = names
      .filter((name) => (wordsOf(name)?.group ?? WORKSPACE_TOOL_GROUP.OTHER) === heading)
      .map((name): WorkspaceToolRow => {
        const summary = workspaceToolSummary(name);
        return summary === undefined ? { name } : { name, summary };
      });
    return tools.length === 0 ? [] : [{ heading, tools }];
  });
}

/** Why `run_on_mac` is off for an agent, the service's reason and the one this Mac knows first. */
export const RUN_ON_MAC_REASON = {
  SETTINGS_OFF: "settings-off",
  ...RUN_ON_MAC_OFF,
} as const;

export type RunOnMacReason = (typeof RUN_ON_MAC_REASON)[keyof typeof RUN_ON_MAC_REASON];

/** What we say of one reason: a short line for a row, and a sentence of detail for the tool's page where the short line leaves something unsaid. */
interface RunOnMacReasonWords {
  readonly short: string;
  readonly detail?: string;
}

/** What we say of each reason. Settings off has no detail, since the Open settings beside its short line says the rest. */
export const RUN_ON_MAC_REASON_WORDS = {
  [RUN_ON_MAC_REASON.SETTINGS_OFF]: { short: "Off in Settings" },
  [RUN_ON_MAC_REASON.MAC_AWAY]: {
    short: "No Mac listening",
    detail: `${PRODUCT_NAME} isn't open on any Mac of the member this agent's commands run on, its task's assignee or, where no one is assigned, its starter, or it stopped listening.`,
  },
} as const satisfies Record<RunOnMacReason, RunOnMacReasonWords>;

/** What `run_on_mac`'s own page says it does, above why it is off where it is. */
export const RUN_ON_MAC_DESCRIPTION =
  "Runs one shell command on the Mac of the member the agent's task is assigned to, or of its starter where no one is, in their login shell from their home folder, and reads what it printed. It reaches what their account on the Mac reaches: local checkouts, uncommitted work, installed tools, and running servers. The Mac asks first unless Settings › This Mac says otherwise.";

/** The sentence of detail `run_on_mac`'s page says under its reason, where it has one. */
export function runOnMacDetail(reason: RunOnMacReason): string | undefined {
  const words: RunOnMacReasonWords = RUN_ON_MAC_REASON_WORDS[reason];
  return words.detail;
}

/** What decides whether `run_on_mac` is on: this Mac's setting, where the reader may be told it, and the service's answer. */
export interface RunOnMacInput {
  /** Whether this Mac's Settings let no agent run commands on it; false where the reader is not the member the agent's commands run on or reads on no Mac. */
  readonly settingsOff: boolean;
  /** The service's answer; nothing while it is read or where it could not be. */
  readonly standing: RunOnMacStanding | undefined;
}

/** Why `run_on_mac` is off for the agent, the first of the two reasons that holds; nothing where it is on, or not known to be off. */
export function runOnMacReason(input: RunOnMacInput): RunOnMacReason | undefined {
  const { standing } = input;
  // Note that the service's answer comes first, because another Mac of the same member's may listen while this one is set to Never.
  if (standing === undefined || standing.on) return undefined;
  return input.settingsOff ? RUN_ON_MAC_REASON.SETTINGS_OFF : standing.reason;
}
