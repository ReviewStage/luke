import {
  CODING_AGENT_KIND,
  CODING_AGENT_MACHINE,
  type CodingAgentAttachment,
  type CodingAgentBrief,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { TERMINAL_ASK } from "@luke/features/terminal-entry";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { type InlineRename, useInlineRename } from "@luke/ui/use-inline-rename";
import { pressAct } from "../act.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { useSteadyDoor } from "../steady-door.js";
import type { AgentFork } from "../tasks/fork-model.js";
import { markReadItem, type ReadMark } from "../tasks/task-menu-items.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import {
  agentTranscript,
  readWholeTranscript,
  TRANSCRIPT_COPY,
  type TranscriptCopy,
} from "../tasks/transcript-copy.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import type { SidePanelControl } from "../tasks/use-side-panel.js";
import { useCapability } from "../use-app-state.js";
import type { MenuAction, MenuEntry } from "./action-menu.js";
import { useAgentArchive, useAgentUnarchive } from "./agent-archive.js";
import { useAgentDelete } from "./agent-delete.js";
import { type TranscriptRead, useTranscriptCopier } from "./strip-tabs.js";

/**
 * agent-actions.tsx -- one coding agent's menu, built once (`agentMenuGroups`) and drawn the same wherever the agent is drawn: its tab's right-click and its column's ⋯ on a task, its own page's ⋯, and its rows in the sidebar, a task's summary, a person's page, the sidebar's pins, and the summary's Archived.
 *
 * Every surface that draws an agent offers what `useAgentActions` answers,
 * laid out by `agentMenuGroups` in the one order every menu of the window
 * keeps, Copy, then name and read, then organize, then open elsewhere, then
 * lifecycle, and Delete last and alone: Copy link and the transcript's two
 * copies, read whole from the service; Rename, which opens its name's field
 * where the surface draws its name, while neither it nor what it stands
 * under is archived, and Mark as unread or Mark as read, for an agent with
 * no task, whose marks are a task's (`agent-read-marks.ts`); Pin or Unpin
 * and Move to section, the reader's own, for an agent with no task, which
 * has a row of its own among the sidebar's tasks (an agent on a task has
 * none, and its tab keeps Pin tab among its tab's keeping); Show terminal,
 * where the platform runs one, and none for an archived agent, whose sandbox
 * takes no shell, which for a local agent opens the Mac's own Terminal in
 * its worktree instead of the relayed tab; Archive, asked first while a
 * teammate's agent works (`agent-archive.tsx`), or Unarchive once it is
 * archived; and last and alone, Permanently delete, always asked first
 * (`agent-delete.tsx`), which closes the surface once it landed. A row
 * leaves out only what `NOT_ON_A_ROW` names, and nothing of its own is
 * added beside the menu but what the row's kind keeps, a pinned tab's Unpin
 * before it and a summary row's Show details (`row-menu.tsx`).
 * Run, which runs the agent's pushed branch on this Mac, stands on its
 * Pull request tab instead (`agent-pull-request-tab.tsx`).
 * The doors that open a terminal are the column's, from where it stands
 * (`useAgentTerminalDoors`), and so are those that open a fork of one of its
 * messages or a continue of it as a draft (`useAgentDraftDoors`): the
 * task's draft tab, or the draft on an agent's own page, each started
 * through the same control.
 */

/** A pin as a menu offers it, Pin or Unpin: whether it stands, and the press that sets it or takes it away. */
export interface PinDoor {
  pinned: boolean;
  onToggle: () => void;
}

/**
 * What an agent's menu is built from: each door none where the surface, or
 * the agent, offers no such act, which leaves its item out. A tab's doors
 * (`strip-tabs.tsx`'s `TabDoors`) hold the first six, and so does every
 * other tab's, whose menu is these same groups over the few doors it has.
 */
export interface AgentMenuDoors {
  /** Whether the menu is the chosen tab's or the page's, whose Show terminal alone prints ⌘J, which opens the chosen agent's terminal. */
  chosen?: boolean | undefined;
  /** Copies the link of what the menu is about (`copy-link-item.tsx`). */
  copyLink?: MenuAction | undefined;
  /** Copies the agent's transcript, concise or full. */
  onCopy?: ((copy: TranscriptCopy) => void) | undefined;
  /** Opens the agent's name's field where the surface draws its name. */
  onRename?: (() => void) | undefined;
  /** Mark as unread or Mark as read, for an agent with read marks: one with no task. */
  read?: ReadMark | undefined;
  /** Pin or Unpin, for an agent with a sidebar row of its own: one with no task, not archived. */
  agentPin?: PinDoor | undefined;
  /** Move to section ▸, the reader's own sections, for the same agents (`sidebar-sections.tsx`). */
  section?: MenuEntry | undefined;
  /** Opens the agent's own Terminal tab in the side panel, adding no shell. */
  onOpenTerminal?: (() => void) | undefined;
  /** Archives the agent, or Unarchive once it is archived (`agent-archive.tsx`). */
  archive?: MenuAction | undefined;
  /** Deletes the agent for good, asked first (`agent-delete.tsx`). */
  deletion?: MenuAction | undefined;
}

/**
 * The agent's menu, built once for every surface that draws it, in the
 * groups every menu of the window keeps: Copy link and the transcript's two
 * copies; Rename and the read mark; Pin and Move to section; Show terminal,
 * which prints ⌘J only where the menu is the chosen tab's, since the chord
 * opens that tab's terminal; Archive or Unarchive; and last and alone,
 * Permanently delete. A group with nothing in it is left out, so a surface
 * with few doors draws the few groups it has in the same order.
 */
export function agentMenuGroups(doors: AgentMenuDoors): MenuEntry[][] {
  const { copyLink, onCopy, onRename, read, agentPin, section, onOpenTerminal } = doors;
  const { archive, deletion } = doors;
  const copies: MenuEntry[] = [
    ...(copyLink === undefined ? [] : [copyLink]),
    ...(onCopy === undefined
      ? []
      : [
          commandAction(
            PANEL_COMMAND.COPY_CONCISE_TRANSCRIPT,
            () => onCopy(TRANSCRIPT_COPY.CONCISE),
            false,
          ),
          commandAction(
            PANEL_COMMAND.COPY_FULL_TRANSCRIPT,
            () => onCopy(TRANSCRIPT_COPY.FULL),
            false,
          ),
        ]),
  ];
  const named: MenuEntry[] = [
    ...(onRename === undefined ? [] : [commandAction(PANEL_COMMAND.RENAME, onRename, false)]),
    ...(read === undefined ? [] : [markReadItem(read)]),
  ];
  const organized: MenuEntry[] = [
    ...(agentPin === undefined
      ? []
      : [
          commandAction(
            agentPin.pinned ? PANEL_COMMAND.UNPIN_AGENT : PANEL_COMMAND.PIN_AGENT,
            agentPin.onToggle,
            false,
          ),
        ]),
    ...(section === undefined ? [] : [section]),
  ];
  const opened: MenuEntry[] =
    onOpenTerminal === undefined
      ? []
      : [commandAction(PANEL_COMMAND.SHOW_TERMINAL, onOpenTerminal, doors.chosen === true)];
  return [
    copies,
    named,
    organized,
    opened,
    archive === undefined ? [] : [archive],
    deletion === undefined ? [] : [deletion],
  ].filter((group) => group.length > 0);
}

/** What an agent offers on itself wherever it is drawn: the doors of its menu that are the agent's own, which a surface adds its own to (`read`, `agentPin`, `section`). */
export type AgentDoors = Pick<
  AgentMenuDoors,
  "onCopy" | "onRename" | "onOpenTerminal" | "archive" | "deletion" | "copyLink"
>;

/**
 * The doors an agent offers that its sidebar row leaves out, each with why,
 * and the one place that says so. Every other door this hook answers
 * stands in the row's menu (`sidebar-agent.tsx`), which
 * `sidebar-agent.test.ts` holds: a door added to `AgentDoors` either is
 * placed on the row or is named here, or that test fails.
 */
const NOT_ON_A_ROW = {
  onOpenTerminal: "The terminal opens in a side panel, and a row has none.",
  onCopy: "A task's row offers no transcript copy either, so an agent's row offers none.",
} as const satisfies Partial<Record<keyof AgentDoors, string>>;

/** The doors an agent's row offers: every one but those `NOT_ON_A_ROW` names. */
export type RowDoors = Omit<AgentDoors, keyof typeof NOT_ON_A_ROW>;

/** The doors a row offers of those an agent offers, `NOT_ON_A_ROW`'s left out. */
export function rowDoors(doors: AgentDoors): RowDoors {
  const offered = Object.entries(doors).filter(([door]) => !Object.hasOwn(NOT_ON_A_ROW, door));
  return Object.fromEntries(offered) as RowDoors;
}

/** The doors a column opens an agent's terminals through, by the agent; each none where it is not offered. */
export interface AgentTerminalDoors {
  /** Shows the agent's own Terminal tab in the side panel, adding no shell; none where the platform runs no terminals. */
  readonly onOpenTerminal: ((agentId: string) => void) | undefined;
  /** Runs a pushed branch in the agent's terminal of this Mac in the side panel, which every Pull request tab's Run offers (`side-panel.tsx`): the agent's own, or the head of the pull request `number` names; none where no repository is known or the platform has no Mac terminal. */
  readonly onOpenOnMac: ((agentId: string, number?: number) => void) | undefined;
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
  quiet = false,
): TranscriptRead {
  return () =>
    readWholeTranscript(readTranscript, { agentId }).then((messages) =>
      messages === undefined ? undefined : agentTranscript({ title, messages, brief, quiet }),
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
        : (agentId, number) => {
            sidePanel.onChoose({
              macTerminal: agentId,
              repository,
              asked: Date.now(),
              ...(number === undefined ? undefined : { number }),
            });
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
 * One agent's actions, as every surface that draws it offers them. Luke, the
 * member's operator, is known by his kind and offers neither Rename, Archive,
 * nor Delete wherever he is drawn, a Luke a Reset retired included: his
 * name is his kind's, his Reset archives him, and there is one of him.
 */
export function useAgentActions(
  agent: Pick<
    CodingAgentSummary,
    | "id"
    | "planId"
    | "status"
    | "title"
    | "automationName"
    | "model"
    | "archivedAt"
    | "brief"
    | "kind"
    | "machine"
    | "startedBy"
  >,
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
  const luke = agent.kind === CODING_AGENT_KIND.OPERATOR;
  // Note that an Unarchive stands while what the agent stands under is archived, and neither it nor
  // an archived agent is renamed then.
  const renamable = !luke && agents.onUnarchive === undefined && agent.archivedAt === undefined;
  const { onOpenTerminal } = terminals;
  const macTerminal = useCapability(HOST_CAPABILITY.MAC_TERMINAL);
  const local = agent.machine === CODING_AGENT_MACHINE.DEVICE;
  // Note that a local agent runs in a worktree on its starter's Mac, which no relayed tab reaches, so
  // its Terminal opens the Mac's own Terminal there, offered to its starter alone, whose Mac it is.
  const starter = agent.startedBy !== undefined && agent.startedBy.userId === agents.me;
  const terminal = local
    ? macTerminal && starter
      ? () => void pressAct(ACT_KIND.MAC_TERMINAL_LOCAL_AGENT, { agentId: agent.id })
      : undefined
    : onOpenTerminal === undefined
      ? undefined
      : () => onOpenTerminal(agent.id);
  const read = agentTranscriptRead(agents.readTranscript, agent.id, label, agent.brief, luke);
  return {
    doors: {
      onCopy: copied(read),
      onRename: renamable ? rename.begin : undefined,
      // Note that an archived agent's sandbox takes no shell, so it offers no terminal.
      onOpenTerminal: agent.archivedAt !== undefined ? undefined : terminal,
      archive: luke ? undefined : agent.archivedAt === undefined ? archive.action : unarchive,
      deletion: luke ? undefined : deletion.action,
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
