/**
 * luke-tools-model.ts -- what an agent's MCP popover says of Luke's own tools: each one's group and one line of what it does, and whether `run_on_mac` is on for the agent and why not.
 *
 * Which of Luke's tools an agent is offered is the service's answer
 * (`luke-tools-wire.ts`), read off the same rules its runtime narrows the
 * list by, so it never drifts from what the agent is handed. What each tool
 * is called beside its name, and the group it stands under, is said here,
 * once, for every tool in `AGENT_TOOL`: a tool added there does not build
 * until it has its line. A name the service answers that this build does not
 * know, a tool added after it, stands under the last group with no words.
 *
 * `run_on_mac` is on for an agent unless one of three things stops it,
 * said in this order: this Mac's Settings › This Mac lets no agent run
 * commands on it, which only the agent's starter reading on a Mac can be
 * told; no Mac of the starter's is listening for commands; or someone
 * other than the starter has put words into the agent's conversation,
 * which turns it off for the rest of the agent's life. This Mac's setting
 * is the reason only where the service says `run_on_mac` is off, because
 * the service counts any listening Mac of the starter's: one set to Never
 * beside another that listens still runs the agent's commands there.
 */

import { AGENT_TOOL, type AgentTool } from "./agent-tools.js";
import { MESSAGE_SENDER, type MessageSender } from "./agent-wire.js";
import { RUN_ON_MAC_OFF, type RunOnMacStanding } from "./luke-tools-wire.js";
import { dayAndTimeText } from "./time-format.js";

/** The groups Luke's tools stand under on his page, in the order they are drawn. */
export const LUKE_TOOL_GROUP = {
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

export type LukeToolGroup = (typeof LUKE_TOOL_GROUP)[keyof typeof LUKE_TOOL_GROUP];

const GROUP_ORDER: readonly LukeToolGroup[] = Object.values(LUKE_TOOL_GROUP);

/** One of Luke's tools as his page says it: its group, and one line of what it does. */
interface LukeToolWords {
  readonly group: LukeToolGroup;
  readonly summary: string;
}

/** Every tool of Luke's, by its name: its group and one line of what it does. */
const LUKE_TOOL_WORDS = {
  [AGENT_TOOL.RUN_ON_MAC]: {
    group: LUKE_TOOL_GROUP.MAC,
    summary: "Runs a shell command on the developer's own Mac",
  },
  [AGENT_TOOL.POST_THREAD]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Posts a thread to one of the workspace's channels",
  },
  [AGENT_TOOL.READ_THREADS]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Reads the threads it posted and their answers",
  },
  [AGENT_TOOL.WITHDRAW_ASK]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Withdraws an ask it no longer needs answered",
  },
  [AGENT_TOOL.LIST_OPEN_ASKS]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Lists every open ask to its member across their agents",
  },
  [AGENT_TOOL.CREATE_CHANNEL]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Makes a channel in the workspace",
  },
  [AGENT_TOOL.UPDATE_CHANNEL]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Renames, describes, or archives a channel",
  },
  [AGENT_TOOL.MOVE_THREAD]: {
    group: LUKE_TOOL_GROUP.THREADS,
    summary: "Moves a thread to another channel",
  },
  [AGENT_TOOL.LIST_AGENTS]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Lists the workspace's agents",
  },
  [AGENT_TOOL.READ_AGENT]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Reads where another agent stands and what it published",
  },
  [AGENT_TOOL.MESSAGE_AGENT]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Sends another agent a message",
  },
  [AGENT_TOOL.START_AGENT]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Starts a new agent on a task",
  },
  [AGENT_TOOL.STOP_AGENT]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Stops another agent's turn",
  },
  [AGENT_TOOL.UPDATE_AGENT]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Renames, pins, moves, or archives an agent",
  },
  [AGENT_TOOL.LIST_MODELS]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Lists the models an agent may be started on",
  },
  [AGENT_TOOL.LIST_TASKS]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Lists the workspace's tasks",
  },
  [AGENT_TOOL.READ_TASK]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Reads a task and its plan",
  },
  [AGENT_TOOL.CREATE_TASK]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Makes a task",
  },
  [AGENT_TOOL.UPDATE_TASK]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Renames a task or changes where it stands",
  },
  [AGENT_TOOL.CREATE_SECTION]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Makes a section in the sidebar",
  },
  [AGENT_TOOL.DELETE_SECTION]: {
    group: LUKE_TOOL_GROUP.AGENTS,
    summary: "Deletes a section of the sidebar",
  },
  [AGENT_TOOL.LIST_AUTOMATIONS]: {
    group: LUKE_TOOL_GROUP.AUTOMATIONS,
    summary: "Lists the workspace's automations",
  },
  [AGENT_TOOL.CREATE_AUTOMATION]: {
    group: LUKE_TOOL_GROUP.AUTOMATIONS,
    summary: "Makes an automation",
  },
  [AGENT_TOOL.UPDATE_AUTOMATION]: {
    group: LUKE_TOOL_GROUP.AUTOMATIONS,
    summary: "Changes an automation",
  },
  [AGENT_TOOL.DELETE_AUTOMATION]: {
    group: LUKE_TOOL_GROUP.AUTOMATIONS,
    summary: "Deletes an automation",
  },
  [AGENT_TOOL.RUN_AUTOMATION]: {
    group: LUKE_TOOL_GROUP.AUTOMATIONS,
    summary: "Runs an automation now",
  },
  [AGENT_TOOL.EDIT_PLAN]: {
    group: LUKE_TOOL_GROUP.PLAN,
    summary: "Takes notes in its task's plan",
  },
  [AGENT_TOOL.READ_COMMENTS]: {
    group: LUKE_TOOL_GROUP.PLAN,
    summary: "Reads the comment threads on the plan",
  },
  [AGENT_TOOL.REPLY_TO_COMMENT]: {
    group: LUKE_TOOL_GROUP.PLAN,
    summary: "Answers a comment thread it was mentioned in",
  },
  [AGENT_TOOL.RESOLVE_THREAD]: {
    group: LUKE_TOOL_GROUP.PLAN,
    summary: "Resolves a comment thread",
  },
  [AGENT_TOOL.REOPEN_THREAD]: {
    group: LUKE_TOOL_GROUP.PLAN,
    summary: "Reopens a comment thread",
  },
  [AGENT_TOOL.SHOW_PAGE]: {
    group: LUKE_TOOL_GROUP.PAGES,
    summary: "Shows a page in the side panel",
  },
  [AGENT_TOOL.READ_PAGE]: {
    group: LUKE_TOOL_GROUP.PAGES,
    summary: "Reads a page shown in the workspace",
  },
  [AGENT_TOOL.SHOW_IMAGE]: {
    group: LUKE_TOOL_GROUP.PAGES,
    summary: "Shows pictures from its sandbox in the transcript",
  },
  [AGENT_TOOL.LOOK_AT_PICTURE]: {
    group: LUKE_TOOL_GROUP.PAGES,
    summary: "Looks at a picture in the plan",
  },
  [AGENT_TOOL.BROWSER]: {
    group: LUKE_TOOL_GROUP.WEB,
    summary: "Drives a browser in its sandbox you can watch",
  },
  [AGENT_TOOL.WEB_SEARCH]: {
    group: LUKE_TOOL_GROUP.WEB,
    summary: "Searches the public web",
  },
  [AGENT_TOOL.READ_WEB_PAGE]: {
    group: LUKE_TOOL_GROUP.WEB,
    summary: "Reads a public web page",
  },
  [AGENT_TOOL.BASH]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Runs a shell command in its sandbox",
  },
  [AGENT_TOOL.READ_FILE]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Reads a file in its checkout",
  },
  [AGENT_TOOL.WRITE_FILE]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Writes a file in its checkout",
  },
  [AGENT_TOOL.GLOB]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Finds files by their paths",
  },
  [AGENT_TOOL.GREP]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Searches files for a pattern",
  },
  [AGENT_TOOL.APPLY_PATCH]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Edits files in its checkout with a patch",
  },
  [AGENT_TOOL.OPEN_PULL_REQUEST]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Opens the pull request for a branch it pushed",
  },
  [AGENT_TOOL.DELEGATE]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Hands a read-only job to a worker",
  },
  [AGENT_TOOL.WRITE_TODOS]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Keeps its to-do list",
  },
  [AGENT_TOOL.LOAD_SKILL]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Loads one of the repository's skills",
  },
  [AGENT_TOOL.SLEEP]: {
    group: LUKE_TOOL_GROUP.CODE,
    summary: "Waits before it checks on its checks or a deploy",
  },
  [AGENT_TOOL.REMEMBER]: {
    group: LUKE_TOOL_GROUP.MEMORY,
    summary: "Keeps a fact in the workspace's memory",
  },
  [AGENT_TOOL.RECALL]: {
    group: LUKE_TOOL_GROUP.MEMORY,
    summary: "Searches the workspace's memory",
  },
} as const satisfies { readonly [Tool in AgentTool]: LukeToolWords };

/** One tool as Luke's page draws it: its name, and one line of what it does where this build knows it. */
export interface LukeToolRow {
  readonly name: string;
  readonly summary?: string;
}

/** One group of Luke's page: its heading and its tools, in the order the service answered them. */
export interface LukeToolSection {
  readonly heading: LukeToolGroup;
  readonly tools: readonly LukeToolRow[];
}

function wordsOf(name: string): LukeToolWords | undefined {
  return Object.hasOwn(LUKE_TOOL_WORDS, name) ? LUKE_TOOL_WORDS[name as AgentTool] : undefined;
}

/** One line of what a tool of Luke's does; nothing for a name this build does not know. */
export function lukeToolSummary(name: string): string | undefined {
  return wordsOf(name)?.summary;
}

/** The tools the service named, under their groups in the page's order, each group's in the order named; no group stands empty. */
export function lukeToolSections(names: readonly string[]): readonly LukeToolSection[] {
  return GROUP_ORDER.flatMap((heading) => {
    const tools = names
      .filter((name) => (wordsOf(name)?.group ?? LUKE_TOOL_GROUP.OTHER) === heading)
      .map((name): LukeToolRow => {
        const summary = lukeToolSummary(name);
        return summary === undefined ? { name } : { name, summary };
      });
    return tools.length === 0 ? [] : [{ heading, tools }];
  });
}

/** Why `run_on_mac` is off for an agent, the service's two reasons and the one this Mac knows first. */
export const RUN_ON_MAC_REASON = {
  SETTINGS_OFF: "settings-off",
  ...RUN_ON_MAC_OFF,
} as const;

export type RunOnMacReason = (typeof RUN_ON_MAC_REASON)[keyof typeof RUN_ON_MAC_REASON];

/** What Luke says of each reason: a short line for a row, and a sentence of detail for the tool's page. */
export const RUN_ON_MAC_REASON_WORDS = {
  [RUN_ON_MAC_REASON.SETTINGS_OFF]: {
    short: "Off in Settings",
    detail: "This Mac's Settings let no agent run commands on it.",
  },
  [RUN_ON_MAC_REASON.MAC_AWAY]: {
    short: "No Mac listening",
    detail:
      "No Mac of the developer who started this agent is listening for commands: Luke isn't open on one, or it stopped listening.",
  },
  [RUN_ON_MAC_REASON.OUTSIDE_WORDS]: {
    short: "Someone else's words",
    detail:
      "Someone other than the developer who started this agent put words into it, such as a teammate's message, a webhook's body, or a review on its pull request, so it never runs commands on their Mac again.",
  },
} as const satisfies Record<RunOnMacReason, { readonly short: string; readonly detail: string }>;

/** What `run_on_mac`'s own page says it does, above why it is off where it is. */
export const RUN_ON_MAC_DESCRIPTION =
  "Runs one shell command on the developer's own Mac, in their login shell from their home folder, and reads what it printed. It reaches what their account on the Mac reaches: local checkouts, uncommitted work, installed tools, and running servers. The Mac asks first unless Settings › This Mac says otherwise.";

/** Who put the first outside words into an agent, by what kind of sender carried them, as a sentence opens. */
const OUTSIDE_WORDS_FROM = {
  [MESSAGE_SENDER.MEMBER]: "A teammate's message",
  [MESSAGE_SENDER.AGENT]: "A teammate's agent's message",
  [MESSAGE_SENDER.AUTOMATION]: "An automation's webhook or event",
  [MESSAGE_SENDER.GITHUB]: "A review or comment on its pull request",
  [MESSAGE_SENDER.LUKE]: "A message",
} as const satisfies Record<MessageSender, string>;

/**
 * The sentence of detail `run_on_mac`'s page says under its reason: for
 * outside words, who put the first of them in and when, where the service
 * could say; the reason's own sentence otherwise.
 */
export function runOnMacDetail(
  reason: RunOnMacReason,
  standing: RunOnMacStanding | undefined,
): string {
  const general = RUN_ON_MAC_REASON_WORDS[reason].detail;
  if (reason !== RUN_ON_MAC_REASON.OUTSIDE_WORDS || standing === undefined || standing.on) {
    return general;
  }
  if (standing.from === undefined || standing.at === undefined) return general;
  return `${OUTSIDE_WORDS_FROM[standing.from]} put words into this agent on ${dayAndTimeText(standing.at)}. It no longer runs commands on the Mac of the developer who started it, since those words were not theirs.`;
}

/** What decides whether `run_on_mac` is on: this Mac's setting, where the reader may be told it, and the service's answer. */
export interface RunOnMacInput {
  /** Whether this Mac's Settings let no agent run commands on it; false where the reader is not the agent's starter or reads on no Mac. */
  readonly settingsOff: boolean;
  /** The service's answer; nothing while it is read or where it could not be. */
  readonly standing: RunOnMacStanding | undefined;
}

/** Why `run_on_mac` is off for the agent, the first of the three reasons that holds; nothing where it is on, or not known to be off. */
export function runOnMacReason(input: RunOnMacInput): RunOnMacReason | undefined {
  const { standing } = input;
  // Note that the service's answer comes first, because another Mac of the starter's may listen while this one is set to Never.
  if (standing === undefined || standing.on) return undefined;
  return input.settingsOff ? RUN_ON_MAC_REASON.SETTINGS_OFF : standing.reason;
}
