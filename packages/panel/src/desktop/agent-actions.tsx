import type { CodingAgentBrief, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { TERMINAL_ASK } from "@luke/features/terminal-entry";
import { HOST_CAPABILITY } from "@luke/settings";
import { type InlineRename, useInlineRename } from "@luke/ui/use-inline-rename";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import { agentTranscript, readWholeTranscript } from "../tasks/transcript-copy.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import type { SidePanelControl } from "../tasks/use-side-panel.js";
import { useCapability } from "../use-app-state.js";
import { useAgentArchive, useAgentUnarchive } from "./agent-archive.js";
import { type TabDoors, type TranscriptRead, useTranscriptCopier } from "./strip-tabs.js";

/**
 * agent-actions.tsx -- one coding agent's actions, the same wherever the agent is drawn: its tab in a task's column and its own page, on a task or on none.
 *
 * Every surface that draws an agent offers what this hook answers, and
 * nothing of its own beside it, so an agent with no task, as an
 * automation's run starts, is acted on as a task's is: Rename, which opens
 * its name's field where the surface draws its name, while nothing it
 * stands under is archived; Open terminal and Run, where the platform runs
 * them and the agent's repository is known, and no terminal for an
 * archived agent, whose sandbox takes no shell; Copy link; its transcript's
 * two copies, read whole from the service; and Archive agent, asked first
 * while it works (`agent-archive.tsx`), or Unarchive once it is archived.
 * The doors that open a terminal are the column's, from where it stands
 * (`useAgentTerminalDoors`).
 */

/** What an agent offers on itself, as a tab's menu and a toolbar's ⋯ draw it (`strip-tabs.tsx`). */
type AgentDoors = Pick<
  TabDoors,
  "onCopy" | "onRename" | "onOpenTerminal" | "onOpenOnMac" | "archive" | "copyLink"
>;

/** The doors a column opens an agent's terminals through, by the agent; each none where it is not offered. */
export interface AgentTerminalDoors {
  /** Shows the agent's own Terminal tab in the side panel, adding no shell; none where the platform runs no terminals. */
  readonly onOpenTerminal: ((agentId: string) => void) | undefined;
  /** Runs the agent's pushed branch in a terminal of this Mac in the side panel; none where no repository is known or the platform has no Mac terminal. */
  readonly onOpenOnMac: ((agentId: string) => void) | undefined;
  /** Whether the platform runs terminals, which ⌘J and New terminal stand on. */
  readonly terminals: boolean;
}

/** An agent's actions as a surface draws them: its doors, its rename where it is renamed, and the question its Archive asks through, drawn beside them. */
export interface AgentActions {
  readonly doors: AgentDoors;
  /** The rename its Rename opens; none while what it stands under is archived. */
  readonly rename: InlineRename | undefined;
  readonly dialog: React.JSX.Element;
}

/** A coding agent's transcript read whole from the service under the title given, since its tab holds it only while shown. */
export function agentTranscriptRead(
  readTranscript: CodingAgentsControl["readTranscript"],
  agentId: string,
  title: string,
  brief: CodingAgentBrief | undefined,
  chatOn: boolean,
): TranscriptRead {
  return () =>
    readWholeTranscript(readTranscript, { agentId }).then((messages) =>
      messages === undefined ? undefined : agentTranscript({ title, messages, brief, chatOn }),
    );
}

/**
 * The doors a column opens its agents' terminals through: the agent's
 * Terminal tab shown in the side panel, and its branch run on this Mac
 * there, each handing the panel the keys (`onShown`).
 */
export function useAgentTerminalDoors(
  sidePanel: Pick<SidePanelControl, "onChoose">,
  repository: string | null | undefined,
  onShown: () => void,
): AgentTerminalDoors {
  const terminals = useCapability(HOST_CAPABILITY.TERMINALS);
  const macTerminal = useCapability(HOST_CAPABILITY.MAC_TERMINAL);
  const openTerminal = useOpenTerminal(sidePanel, onShown);
  return {
    terminals,
    onOpenTerminal: terminals ? (agentId) => openTerminal(agentId, TERMINAL_ASK.SHOW) : undefined,
    onOpenOnMac:
      repository == null || !macTerminal
        ? undefined
        : (agentId) => {
            sidePanel.onChoose({ macTerminal: agentId, repository, asked: Date.now() });
            onShown();
          },
  };
}

/** One agent's actions, as every surface that draws it offers them. */
export function useAgentActions(
  agent: CodingAgentSummary,
  agents: CodingAgentsControl,
  input: {
    /** The agent's name as the surface draws it, which a transcript copied is headed by. */
    readonly label: string;
    /** Whether the surface is on screen, which the Archive's question asks on. */
    readonly shown: boolean;
    readonly terminals: Pick<AgentTerminalDoors, "onOpenTerminal" | "onOpenOnMac">;
  },
): AgentActions {
  const { label, shown, terminals } = input;
  const copied = useTranscriptCopier();
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  const rename = useInlineRename(agent.id, agents.onRename);
  const archive = useAgentArchive(agent, agents, shown);
  const unarchive = useAgentUnarchive(agent.id, agents);
  // Note that an Unarchive stands while the agent or its task is archived, and neither is renamed then.
  const renamable = agents.onUnarchive === undefined;
  const { onOpenTerminal, onOpenOnMac } = terminals;
  const read = agentTranscriptRead(
    agents.readTranscript,
    agent.id,
    label,
    agent.brief,
    agents.chatOn,
  );
  return {
    doors: {
      onCopy: copied(read),
      onRename: renamable ? rename.begin : undefined,
      // Note that an archived agent's sandbox takes no shell, so it offers no terminal; Run reads only its pushed branch.
      onOpenTerminal:
        onOpenTerminal === undefined || agent.archivedAt !== undefined
          ? undefined
          : () => onOpenTerminal(agent.id),
      onOpenOnMac: onOpenOnMac === undefined ? undefined : () => onOpenOnMac(agent.id),
      archive: agent.archivedAt === undefined ? archive.action : unarchive,
      copyLink,
    },
    rename: renamable ? rename : undefined,
    dialog: archive.dialog,
  };
}
