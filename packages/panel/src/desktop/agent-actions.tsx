import {
  AGENT_MACHINE,
  AGENT_SOURCE,
  type AgentAttachment,
  type AgentBrief,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { TERMINAL_ASK } from "@repo/features/terminal-entry";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { GLYPH } from "@repo/ui/icons";
import { type InlineRename, useInlineRename } from "@repo/ui/use-inline-rename";
import { useMutation, useQuery } from "@tanstack/react-query";
import { pressMutation } from "../act-mutations.js";
import { appPlatform } from "../app-platform.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { agentPlace, useCopyLinkItem } from "../copy-link-item.js";
import { useThisMac } from "../machine-name.js";
import { renameWrite } from "../rename-write.js";
import { useSteadyDoor } from "../steady-door.js";
import { useAddRepository } from "../tasks/add-repository.js";
import type { AgentFork } from "../tasks/fork-model.js";
import { useMoveToEntry } from "../tasks/move-agent.js";
import { markReadItem, type ReadMark } from "../tasks/task-menu-items.js";
import { useOpenTerminal } from "../tasks/terminal-commands.js";
import {
  agentTranscript,
  readWholeTranscript,
  TRANSCRIPT_COPY,
  type TranscriptCopy,
} from "../tasks/transcript-copy.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useOpenLocal } from "../tasks/use-local-session.js";
import type { SidePanelControl } from "../tasks/use-side-panel.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
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
 * lifecycle, and Delete last and alone: Copy link and Copy transcript ›,
 * Concise or Full, read whole from the service; Rename, which opens its name's field
 * where the surface draws its name, while neither it nor what it stands
 * under is archived, and Mark as unread or Mark as read, for an agent with
 * no task, whose marks are a task's (`agent-read-marks.ts`); Pin or Unpin
 * and Move to section, the reader's own, for an agent with no task, which
 * has a row of its own among the sidebar's tasks (an agent on a task has
 * none, and its tab keeps Pin tab among its tab's keeping); Show terminal,
 * where the platform runs one, and none for an archived agent, whose sandbox
 * takes no shell, which for a local agent opens the Mac's own Terminal in
 * its worktree instead of the relayed tab; Open in Slack, for an agent
 * started from a Slack message, which opens that message; Add repository…,
 * a repository added beside the ones the agent works in, while Several
 * repositories is on (`add-repository.tsx`); Move to ›, the
 * cloud or another of the member's devices, while the agent may be
 * continued there (`move-agent.tsx`); Archive, asked
 * first while a teammate's agent works (`agent-archive.tsx`), or Unarchive once it is
 * archived; and last and alone, Permanently delete, always asked first
 * (`agent-delete.tsx`), which closes the surface once it landed. A row
 * leaves out only what `NOT_ON_A_ROW` names, and nothing of its own is
 * added beside the menu but what the row's kind keeps, a pinned tab's Unpin
 * before it.
 * The doors that open a terminal are the column's, from where it stands
 * (`useAgentTerminalDoors`), and so are those that open a fork of one of its
 * messages or a continue of it as a draft (`useAgentDraftDoors`): the
 * task's draft tab, or the draft on an agent's own page, each started
 * through the same control.
 */

/** What the agent menu's one copy of its words is called, and the two ways it copies them. */
const COPY_TRANSCRIPT = "Copy transcript";
const TRANSCRIPT_WAY = { CONCISE: "Concise", FULL: "Full" } as const;

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
  /** Opens the cloud agent's own Local tab in the side panel, adding no shell. */
  onOpenLocal?: (() => void) | undefined;
  /** Opens a new tab of the agent's cloud browser in the side panel: a phone's, which lists the panel's tabs nowhere else (`task-pane-switcher.tsx`). */
  onOpenBrowser?: (() => void) | undefined;
  /** Opens the agent in its full place, its tab on its task, from where it stands apart from it: beside the Inbox. */
  onOpenInTask?: (() => void) | undefined;
  /** Opens the Slack message the agent was started from, for an agent started from Slack whose link Slack answered. */
  onOpenInSlack?: (() => void) | undefined;
  /** Add repository…, a repository added beside the ones the agent works in (`add-repository.tsx`). */
  addRepository?: MenuAction | undefined;
  /** Move to ›, the places the agent may be continued at (`move-agent.tsx`). */
  moveTo?: MenuEntry | undefined;
  /** Archives the agent, or Unarchive once it is archived (`agent-archive.tsx`). */
  archive?: MenuAction | undefined;
  /** Deletes the agent for good, asked first (`agent-delete.tsx`). */
  deletion?: MenuAction | undefined;
  /** Whether U and P act on the agent from its row while the row is focused, a sidebar row's, so its read mark and pin print them. */
  rowKeys?: boolean | undefined;
}

/**
 * The agent's menu, built once for every surface that draws it, in the
 * groups every menu of the window keeps: Copy link and the transcript's two
 * copies; Rename and the read mark; Pin and Move to section; Show terminal,
 * Show browser where a phone offers it, Open in task, for an agent drawn
 * apart from its task, and Open in Slack, for one started from Slack;
 * Add repository…, Move to ›, and Archive or Unarchive; and last and alone, Permanently delete. The copies, Show
 * terminal, Open in task, and Permanently delete print ⌥⌘C, ⇧⌥⌘C, ⌘J, ⌘O,
 * and ⌘⌫ only where the menu is the chosen tab's or the agent's page's,
 * since each chord acts on that agent; the read mark and Pin print U and P
 * there too, and on a sidebar row, whose focus the letters act on
 * (`rowKeys`). A group with nothing in it is left out, so a surface
 * with few doors draws the few groups it has in the same order.
 */
export function agentMenuGroups(doors: AgentMenuDoors): MenuEntry[][] {
  const { copyLink, onCopy, onRename, read, agentPin, section, onOpenTerminal, onOpenLocal } =
    doors;
  const { onOpenInTask } = doors;
  const { onOpenBrowser, onOpenInSlack } = doors;
  const { addRepository, moveTo, archive, deletion } = doors;
  const chosen = doors.chosen === true;
  const lettered = chosen || doors.rowKeys === true;
  const copies: MenuEntry[] = [
    ...(copyLink === undefined ? [] : [copyLink]),
    // Note that the two copies share one Copy transcript beside Copy link, so the menu leads with one copy of the agent's words rather than two.
    ...(onCopy === undefined
      ? []
      : [
          {
            label: COPY_TRANSCRIPT,
            icon: <GLYPH.COPY />,
            items: [
              {
                ...commandAction(
                  PANEL_COMMAND.COPY_CONCISE_TRANSCRIPT,
                  () => onCopy(TRANSCRIPT_COPY.CONCISE),
                  chosen,
                ),
                label: TRANSCRIPT_WAY.CONCISE,
              },
              {
                ...commandAction(
                  PANEL_COMMAND.COPY_FULL_TRANSCRIPT,
                  () => onCopy(TRANSCRIPT_COPY.FULL),
                  chosen,
                ),
                label: TRANSCRIPT_WAY.FULL,
              },
            ],
          },
        ]),
  ];
  const named: MenuEntry[] = [
    ...(onRename === undefined ? [] : [commandAction(PANEL_COMMAND.RENAME, onRename, false)]),
    ...(read === undefined ? [] : [markReadItem(read, lettered)]),
  ];
  const organized: MenuEntry[] = [
    ...(agentPin === undefined
      ? []
      : [
          commandAction(
            agentPin.pinned ? PANEL_COMMAND.UNPIN_AGENT : PANEL_COMMAND.PIN_AGENT,
            agentPin.onToggle,
            lettered,
          ),
        ]),
    ...(section === undefined ? [] : [section]),
  ];
  const opened: MenuEntry[] = [
    ...(onOpenTerminal === undefined
      ? []
      : [commandAction(PANEL_COMMAND.SHOW_TERMINAL, onOpenTerminal, chosen)]),
    ...(onOpenLocal === undefined
      ? []
      : [commandAction(PANEL_COMMAND.SHOW_LOCAL, onOpenLocal, false)]),
    ...(onOpenBrowser === undefined
      ? []
      : [commandAction(PANEL_COMMAND.SHOW_BROWSER, onOpenBrowser, false)]),
    ...(onOpenInTask === undefined
      ? []
      : [commandAction(PANEL_COMMAND.OPEN_IN_TASK, onOpenInTask, chosen)]),
    ...(onOpenInSlack === undefined
      ? []
      : [commandAction(PANEL_COMMAND.OPEN_IN_SLACK, onOpenInSlack, false)]),
  ];
  return [
    copies,
    named,
    organized,
    opened,
    [
      ...(addRepository === undefined ? [] : [addRepository]),
      ...(moveTo === undefined ? [] : [moveTo]),
      ...(archive === undefined ? [] : [archive]),
    ],
    deletion === undefined
      ? []
      : [chosen ? { ...deletion, command: APP_COMMAND.DELETE } : deletion],
  ].filter((group) => group.length > 0);
}

/** What an agent offers on itself wherever it is drawn: the doors of its menu that are the agent's own, which a surface adds its own to (`read`, `agentPin`, `section`). */
export type AgentDoors = Pick<
  AgentMenuDoors,
  | "onCopy"
  | "onRename"
  | "onOpenTerminal"
  | "onOpenLocal"
  | "onOpenBrowser"
  | "onOpenInSlack"
  | "addRepository"
  | "moveTo"
  | "archive"
  | "deletion"
  | "copyLink"
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
  onOpenLocal: "The Local tab opens in a side panel, and a row has none.",
  onOpenBrowser: "The browser opens in a side panel, and a row has none.",
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
  /** Shows a cloud agent's own Local tab in the side panel, adding no shell; none where the platform mirrors no agent's files. */
  readonly onOpenLocal?: ((agentId: string) => void) | undefined;
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
  readTranscript: AgentsControl["readTranscript"],
  agentId: string,
  title: string,
  brief: AgentBrief | undefined,
): TranscriptRead {
  return () =>
    readWholeTranscript(readTranscript, { agentId }).then((messages) =>
      "unread" in messages ? messages : agentTranscript({ title, messages, brief }),
    );
}

/**
 * The doors a column opens its agents' terminals through: the agent's
 * Terminal tab shown in the side panel, handing the panel the keys
 * (`onShown`).
 */
export function useAgentTerminalDoors(
  sidePanel: Pick<SidePanelControl, "onChoose">,
  onShown: () => void,
): AgentTerminalDoors {
  const terminals =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.TERMINALS) }).data ===
    true;
  const locals =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.LOCAL_TERMINALS) })
      .data === true;
  const openTerminal = useOpenTerminal(sidePanel, onShown);
  const openLocal = useOpenLocal(sidePanel, onShown);
  return {
    terminals,
    onOpenTerminal: terminals ? (agentId) => openTerminal(agentId, TERMINAL_ASK.SHOW) : undefined,
    onOpenLocal: locals ? (agentId) => openLocal(agentId, false) : undefined,
  };
}

/** The doors an agent's pane opens a fork or a continue of the agent through, each as the place's draft; none while what it stands under is archived. */
export interface AgentDraftDoors {
  readonly onFork: ((fork: AgentFork) => void) | undefined;
  readonly onContinue:
    | ((agentId: string, words: string, attachments: readonly AgentAttachment[]) => void)
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
  agents: Pick<AgentsControl, "onForkDraft" | "onContinueDraft">,
  archived: boolean,
  onOpenDraft: (draftId: string) => void,
): AgentDraftDoors {
  const onFork = useSteadyDoor(
    archived ? undefined : (fork: AgentFork) => onOpenDraft(agents.onForkDraft(fork)),
  );
  const onContinue = useSteadyDoor(
    archived
      ? undefined
      : (agentId: string, words: string, attachments: readonly AgentAttachment[]) =>
          onOpenDraft(agents.onContinueDraft(agentId, words, attachments)),
  );
  return { onFork, onContinue };
}

/** One agent's actions, as every surface that draws it offers them. */
export function useAgentActions(
  agent: Pick<
    AgentSummary,
    | "id"
    | "planId"
    | "status"
    | "title"
    | "automationName"
    | "model"
    | "archivedAt"
    | "brief"
    | "machine"
    | "mac"
    | "startedBy"
    | "source"
    | "pilot"
  >,
  agents: AgentsControl,
  input: {
    /** The agent's name as the surface draws it, which a transcript copied is headed by. */
    readonly label: string;
    /** Whether the surface is on screen, which the Archive's question asks on. */
    readonly shown: boolean;
    readonly terminals: Pick<AgentTerminalDoors, "onOpenTerminal" | "onOpenLocal">;
    /** Opens a new tab of an agent's cloud browser in the side panel; none where the surface offers none, as off a phone. */
    readonly onOpenBrowser?: ((agentId: string) => void) | undefined;
    /** Closes what shows the agent, its tab or its page, once its delete landed. */
    readonly onDeleted?: (() => void) | undefined;
  },
): AgentActions {
  const { label, shown, terminals, onOpenBrowser, onDeleted } = input;
  const copied = useTranscriptCopier();
  const copyLink = useCopyLinkItem()(agentPlace(agent.id));
  const renaming = useMutation(agents.rename.options);
  const rename = useInlineRename(agent.id, renameWrite(renaming, agents.rename));
  const archive = useAgentArchive(agent, agents, shown);
  const unarchive = useAgentUnarchive(agent.id, agents);
  const deletion = useAgentDelete(agent, agents, { shown, onDeleted });
  const moveTo = useMoveToEntry(agent, agents);
  const added = useAddRepository(agent, agents, shown);
  // Note that an Unarchive stands while what the agent stands under is archived, and neither it nor
  // an archived agent is renamed then.
  const renamable = agents.onUnarchive === undefined && agent.archivedAt === undefined;
  const { onOpenTerminal, onOpenLocal } = terminals;
  const macTerminal =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_TERMINAL) }).data ===
    true;
  const { mutate: openMacTerminal } = useMutation(pressMutation(ACT_KIND.MAC_TERMINAL_LOCAL_AGENT));
  const thisMac = useThisMac();
  const local = agent.machine === AGENT_MACHINE.DEVICE;
  // Note that a local agent runs in a worktree on its device, which no relayed tab reaches, so its
  // Terminal opens the Mac's own Terminal there, offered only where that device is This Mac.
  const onThisMac = thisMac?.deviceId !== undefined && agent.mac?.deviceId === thisMac.deviceId;
  const terminal = local
    ? macTerminal && onThisMac
      ? () => openMacTerminal({ agentId: agent.id })
      : undefined
    : onOpenTerminal === undefined
      ? undefined
      : () => onOpenTerminal(agent.id);
  const read = agentTranscriptRead(agents.readTranscript, agent.id, label, agent.brief);
  const slackUrl = agent.source?.kind === AGENT_SOURCE.SLACK ? agent.source.url : undefined;
  return {
    doors: {
      onCopy: copied(read),
      onRename: renamable ? rename.begin : undefined,
      // Note that an archived agent's sandbox takes no shell, so it offers no terminal.
      onOpenTerminal: agent.archivedAt !== undefined ? undefined : terminal,
      // Note that only a cloud agent has a mirror, so an agent on a Mac offers no Local tab.
      onOpenLocal:
        agent.archivedAt !== undefined || local || onOpenLocal === undefined
          ? undefined
          : () => onOpenLocal(agent.id),
      // Note that only a cloud sandbox runs a browser, so an agent on a Mac offers none.
      onOpenBrowser:
        agent.archivedAt !== undefined || local || onOpenBrowser === undefined
          ? undefined
          : () => onOpenBrowser(agent.id),
      onOpenInSlack: slackUrl === undefined ? undefined : () => appPlatform().openWeb(slackUrl),
      addRepository: added.action,
      moveTo,
      archive: agent.archivedAt === undefined ? archive.action : unarchive,
      deletion: deletion.action,
      copyLink,
    },
    rename: renamable ? rename : undefined,
    dialog: (
      <>
        {added.dialog}
        {archive.dialog}
        {deletion.dialog}
      </>
    ),
  };
}
