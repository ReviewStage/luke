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

const COPY_TRANSCRIPT = "Copy transcript";
const TRANSCRIPT_WAY = { CONCISE: "Concise", FULL: "Full" } as const;

export interface PinDoor {
  pinned: boolean;
  onToggle: () => void;
}

export interface AgentMenuDoors {
  chosen?: boolean | undefined;
  copyLink?: MenuAction | undefined;
  onCopy?: ((copy: TranscriptCopy) => void) | undefined;
  onRename?: (() => void) | undefined;
  read?: ReadMark | undefined;
  agentPin?: PinDoor | undefined;
  section?: MenuEntry | undefined;
  onOpenTerminal?: (() => void) | undefined;
  onOpenLocal?: (() => void) | undefined;
  onOpenBrowser?: (() => void) | undefined;
  onOpenInTask?: (() => void) | undefined;
  onOpenInSlack?: (() => void) | undefined;
  addRepository?: MenuAction | undefined;
  moveTo?: MenuEntry | undefined;
  archive?: MenuAction | undefined;
  deletion?: MenuAction | undefined;
  rowKeys?: boolean | undefined;
}

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

const NOT_ON_A_ROW = {
  onOpenTerminal: "The terminal opens in a side panel, and a row has none.",
  onOpenLocal: "The Local tab opens in a side panel, and a row has none.",
  onOpenBrowser: "The browser opens in a side panel, and a row has none.",
  onCopy: "A task's row offers no transcript copy either, so an agent's row offers none.",
} as const satisfies Partial<Record<keyof AgentDoors, string>>;

export type RowDoors = Omit<AgentDoors, keyof typeof NOT_ON_A_ROW>;

export function rowDoors(doors: AgentDoors): RowDoors {
  const offered = Object.entries(doors).filter(([door]) => !Object.hasOwn(NOT_ON_A_ROW, door));
  return Object.fromEntries(offered) as RowDoors;
}

export interface AgentTerminalDoors {
  readonly onOpenTerminal: ((agentId: string) => void) | undefined;
  readonly onOpenLocal?: ((agentId: string) => void) | undefined;
  readonly terminals: boolean;
}

export interface AgentActions {
  readonly doors: AgentDoors;
  readonly rename: InlineRename | undefined;
  readonly dialog: React.JSX.Element;
}

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

export interface AgentDraftDoors {
  readonly onFork: ((fork: AgentFork) => void) | undefined;
  readonly onContinue:
    | ((agentId: string, words: string, attachments: readonly AgentAttachment[]) => void)
    | undefined;
}

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
    readonly label: string;
    readonly shown: boolean;
    readonly terminals: Pick<AgentTerminalDoors, "onOpenTerminal" | "onOpenLocal">;
    readonly onOpenBrowser?: ((agentId: string) => void) | undefined;
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
  const renamable = agents.onUnarchive === undefined && agent.archivedAt === undefined;
  const { onOpenTerminal, onOpenLocal } = terminals;
  const macTerminal =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_TERMINAL) }).data ===
    true;
  const { mutate: openMacTerminal } = useMutation(pressMutation(ACT_KIND.MAC_TERMINAL_LOCAL_AGENT));
  const thisMac = useThisMac();
  const local = agent.machine === AGENT_MACHINE.DEVICE;
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
      onOpenTerminal: agent.archivedAt !== undefined ? undefined : terminal,
      onOpenLocal:
        agent.archivedAt !== undefined || local || onOpenLocal === undefined
          ? undefined
          : () => onOpenLocal(agent.id),
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
