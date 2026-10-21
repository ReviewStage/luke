import type {
  CodingAgentAttachment,
  CodingAgentBrief,
  CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { TERMINAL_ASK } from "@luke/features/terminal-entry";
import { HOST_CAPABILITY } from "@luke/settings";
import { type InlineRename, useInlineRename } from "@luke/ui/use-inline-rename";
import { useMemo } from "react";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { useSteadyDoor } from "../steady-door.js";
import type { AgentCallDoors, AgentCallPlace, AgentCallPress } from "../tasks/agent-call.js";
import type { AgentFork } from "../tasks/fork-model.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import { agentTranscript, readWholeTranscript } from "../tasks/transcript-copy.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import type { SidePanelControl } from "../tasks/use-side-panel.js";
import { useCapability } from "../use-app-state.js";
import { useAgentArchive, useAgentUnarchive } from "./agent-archive.js";
import { useAgentDelete } from "./agent-delete.js";
import { type TabDoors, type TranscriptRead, useTranscriptCopier } from "./strip-tabs.js";

/**
 * agent-actions.tsx -- one coding agent's actions, the same wherever the agent is drawn: its tab in a task's column and its own page, on a task or on none.
 *
 * Every surface that draws an agent offers what this hook answers, and
 * nothing of its own beside it, so an agent with no task, as an
 * automation's run starts, is acted on as a task's is: Rename, which opens
 * its name's field where the surface draws its name, while nothing it
 * stands under is archived; Open terminal, where the platform runs one,
 * and none for an archived agent, whose sandbox takes no shell; Copy link; its transcript's
 * two copies, read whole from the service; Archive agent, asked first
 * while it works (`agent-archive.tsx`), or Unarchive once it is archived;
 * and last and alone, Permanently delete, always asked first
 * (`agent-delete.tsx`), which closes the surface once it landed.
 * Run, which runs the agent's pushed branch on this Mac, stands on its
 * Pull request tab instead (`agent-pull-request-tab.tsx`).
 * The doors that open a terminal are the column's, from where it stands
 * (`useAgentTerminalDoors`), and so are those that open a fork of one of its
 * messages or a continue of it as a draft (`useAgentDraftDoors`): the
 * task's draft tab, or the draft on an agent's own page, each started
 * through the same control. So are the doors its Call takes a call through
 * (`useAgentCallDoors`), the window's one press told where the surface's
 * agents stand: the open task for its column, and the agent's own task, or
 * none, for its page.
 */

/** What an agent offers on itself, as a tab's menu and a toolbar's ⋯ draw it (`strip-tabs.tsx`). */
type AgentDoors = Pick<
  TabDoors,
  "onCopy" | "onRename" | "onOpenTerminal" | "archive" | "deletion" | "copyLink"
>;

/** The doors a column opens an agent's terminals through, by the agent; each none where it is not offered. */
export interface AgentTerminalDoors {
  /** Shows the agent's own Terminal tab in the side panel, adding no shell; none where the platform runs no terminals. */
  readonly onOpenTerminal: ((agentId: string) => void) | undefined;
  /** Runs the agent's pushed branch in a terminal of this Mac in the side panel, which its Pull request tab's Run offers (`side-panel.tsx`); none where no repository is known or the platform has no Mac terminal. */
  readonly onOpenOnMac: ((agentId: string) => void) | undefined;
  /** Whether the platform runs terminals, which ⌘J and New terminal stand on. */
  readonly terminals: boolean;
}

/** An agent's actions as a surface draws them: its doors, its rename where it is renamed, and the questions its Archive and its delete ask through, drawn beside them. */
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

/** The doors an agent's pane opens a fork or a continue of the agent through, each as the place's draft; none while what it stands under is archived. */
export interface AgentDraftDoors {
  readonly onFork: ((fork: AgentFork) => void) | undefined;
  readonly onContinue:
    | ((agentId: string, words: string, attachments: readonly CodingAgentAttachment[]) => void)
    | undefined;
}

/**
 * The doors a surface opens a fork or a continue of one of its agents
 * through: the control's draft, the task's or the agent page's, made a fork
 * of the message or a continue of the agent, then shown where the surface
 * shows a draft (`onOpenDraft`), by its key. Each is steady across renders
 * (`useSteadyDoor`), and none while what the agents stand under is archived.
 */
export function useAgentDraftDoors(
  agents: Pick<CodingAgentsControl, "onForkDraft" | "onContinueDraft">,
  archived: boolean,
  onOpenDraft: (draftId: string) => void,
): AgentDraftDoors {
  const onFork = useSteadyDoor(
    archived ? undefined : (fork: AgentFork) => onOpenDraft(agents.onForkDraft(fork)),
  );
  const onContinue = useSteadyDoor(
    archived
      ? undefined
      : (agentId: string, words: string, attachments: readonly CodingAgentAttachment[]) =>
          onOpenDraft(agents.onContinueDraft(agentId, words, attachments)),
  );
  return { onFork, onContinue };
}

/**
 * The doors a surface's agents take calls through: the window's press
 * (`TasksControl.calls`), told where the surface's agents stand, the task a
 * column holds or the task an agent's page's agent is on, none for an agent
 * with no task, and whether it is archived. Steady across renders, so a
 * pane handed them draws nothing again as the place moves; none where the
 * window has no voice.
 */
export function useAgentCallDoors(
  calls: AgentCallPress | undefined,
  place: AgentCallPlace,
): AgentCallDoors | undefined {
  const onPress = useSteadyDoor(
    calls === undefined ? undefined : (agentId: string) => calls.onPress(agentId, place),
  );
  return useMemo(() => (onPress === undefined ? undefined : { onPress }), [onPress]);
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
    readonly terminals: Pick<AgentTerminalDoors, "onOpenTerminal">;
    /** Closes what shows the agent, its tab or its page, once its delete landed. */
    readonly onDeleted?: (() => void) | undefined;
  },
): AgentActions {
  const { label, shown, terminals, onDeleted } = input;
  const copied = useTranscriptCopier();
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  const rename = useInlineRename(agent.id, agents.onRename);
  const archive = useAgentArchive(agent, agents, shown);
  const unarchive = useAgentUnarchive(agent.id, agents);
  const deletion = useAgentDelete(agent, agents, { shown, onDeleted });
  // Note that an Unarchive stands while the agent or its task is archived, and neither is renamed then.
  const renamable = agents.onUnarchive === undefined;
  const { onOpenTerminal } = terminals;
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
      // Note that an archived agent's sandbox takes no shell, so it offers no terminal.
      onOpenTerminal:
        onOpenTerminal === undefined || agent.archivedAt !== undefined
          ? undefined
          : () => onOpenTerminal(agent.id),
      archive: agent.archivedAt === undefined ? archive.action : unarchive,
      deletion: deletion.action,
      copyLink,
    },
    rename: renamable ? rename : undefined,
    dialog: (
      <>
        {archive.dialog}
        {deletion.dialog}
      </>
    ),
  };
}
