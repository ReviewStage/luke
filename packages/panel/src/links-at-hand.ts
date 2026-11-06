import {
  LINK_PLACE,
  type LinkPlace,
  linkOf,
  type ReadLink,
  taskLinkStep,
  withTaskId,
} from "@repo/features/link-grammar";
import type { PagePlace } from "@repo/features/page-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import type { SettingsView } from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { isAgentTab, isChangesTab, isPageTab, isSubagentTab } from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION } from "@repo/ui/tasks-model";
import { createContext, useContext, useEffect, useState } from "react";
import { type AdminView, adminLinkFields } from "./admin/routing.js";
import { useAppCommand } from "./app-commands.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import { useHoldChordLinks } from "./copy-link-item.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { useInboxTask } from "./tasks/use-inbox-task.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "./tasks/use-tasks-tab.js";

const SIDE_PANEL_SELECTOR = ".side-panel";

const LINK_THING = {
  HOME: "Home",
  BOARD: "Tasks",
  TASK: "task",
  VERSION: "version",
  PAGE: "page",
  AGENT: "agent",
  WORKER: "worker",
  CHANGES: "pull request",
  INBOX: "Inbox",
  INBOX_ITEM: "Inbox item",
  AUTOMATIONS: "Automations",
  AUTOMATION: "automation",
  SETTINGS: "settings page",
  PERSON: "profile",
  ADMIN: "Admin",
  ADMIN_PAGE: "admin page",
} as const;

type LinkThing = (typeof LINK_THING)[keyof typeof LINK_THING];

export interface LinkAtHand {
  readonly link: ReadLink;
  readonly thing: LinkThing;
  readonly name?: string | undefined;
  readonly step?: boolean;
}

interface PageWorkspace {
  readonly agentId: string;
  readonly workspaceId: string;
}

export interface WindowAt {
  readonly settings:
    | {
        readonly view: SettingsView;
        readonly workspace: Workspace | undefined;
        readonly listed?: boolean;
      }
    | undefined;
  readonly sidePanelFocused: boolean;
  readonly admin?: AdminView | undefined;
  readonly underRouted?: boolean;
  readonly pageWorkspace?: PageWorkspace | undefined;
  readonly narrow?: boolean;
  readonly inboxTask?: string | undefined;
}

const PageWorkspaceContext = createContext<(held: PageWorkspace | undefined) => void>(
  () => undefined,
);

export const PageWorkspaceProvider = PageWorkspaceContext.Provider;

function slugOf(workspaces: readonly Workspace[], workspaceId: string | undefined): string {
  const home = workspaces.find((each) => each.id === workspaceId);
  return home?.slug ?? workspaceId ?? "";
}

export function panelTabPlace(
  holder: PagePlace,
  tab: SidePanelTab | undefined,
): LinkPlace | undefined {
  if (tab === undefined) return undefined;
  if (isPageTab(tab)) {
    return "taskId" in holder
      ? { kind: LINK_PLACE.PAGE, planId: holder.taskId, pageId: tab.page }
      : { kind: LINK_PLACE.PAGE, agentId: holder.agentId, pageId: tab.page };
  }
  if (isChangesTab(tab)) {
    return tab.number === undefined
      ? { kind: LINK_PLACE.CHANGES, agentId: tab.changes }
      : undefined;
  }
  if (!isSubagentTab(tab)) return undefined;
  const agent = tab.delegation?.agent ?? ("agentId" in holder ? holder.agentId : undefined);
  return agent === undefined
    ? undefined
    : { kind: LINK_PLACE.WORKER, agentId: agent, callId: tab.subagent };
}

function panelThing(place: LinkPlace): LinkThing | undefined {
  switch (place.kind) {
    case LINK_PLACE.PAGE:
      return LINK_THING.PAGE;
    case LINK_PLACE.CHANGES:
      return LINK_THING.CHANGES;
    case LINK_PLACE.WORKER:
      return LINK_THING.WORKER;
    default:
      return undefined;
  }
}

function inboxItemPlace(chosen: InboxChoice): LinkPlace {
  return { kind: LINK_PLACE.INBOX_ITEM, itemId: chosen.itemId };
}

function taskLinks(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const { region } = tasks;
  if (region.kind !== DOCUMENT_REGION.READY) return [];
  const { task: drawn } = region;
  const workspace = slugOf(tasks.workspaces, drawn.workspaceId);
  const planId = taskLinkStep(drawn);
  const task: LinkAtHand = {
    link: { workspace, place: { kind: LINK_PLACE.TASK, planId } },
    thing: LINK_THING.TASK,
    name: drawn.name,
  };
  if (tasks.history.open) {
    const revision = tasks.history.selected;
    const listedAlone = at.narrow === true && tasks.history.listed;
    return revision === undefined || listedAlone
      ? [{ ...task, step: true }]
      : [
          {
            link: { workspace, place: { kind: LINK_PLACE.VERSION, planId, revision } },
            thing: LINK_THING.VERSION,
            step: true,
          },
          task,
        ];
  }
  const shown = tasks.mainTabs.tab;
  const agentId = shown !== undefined && isAgentTab(shown) ? shown.agent : undefined;
  const agent: LinkAtHand | undefined =
    agentId === undefined
      ? undefined
      : {
          link: { workspace, place: { kind: LINK_PLACE.AGENT, agentId } },
          thing: LINK_THING.AGENT,
          name: tasks.agents.agents?.find((each) => each.id === agentId)?.title ?? undefined,
        };
  const tabPlace = tasks.sidePanel.open
    ? panelTabPlace({ taskId: drawn.id }, tasks.sidePanel.tab)
    : undefined;
  const held = tabPlace === undefined ? undefined : withTaskId(tabPlace, planId);
  const thing = held === undefined ? undefined : panelThing(held);
  const panel: LinkAtHand | undefined =
    held === undefined || thing === undefined
      ? undefined
      : { link: { workspace, place: held }, thing };
  const panelFirst = at.sidePanelFocused || tasks.sidePanel.fullScreen;
  if (at.narrow === true && panel !== undefined) {
    return [{ ...panel, step: true }, agent, task].filter(
      (each): each is LinkAtHand => each !== undefined,
    );
  }
  const standing: LinkAtHand = { ...task, step: true };
  const order = panelFirst ? [panel, agent, standing] : [agent, panel, standing];
  return order.filter((each): each is LinkAtHand => each !== undefined);
}

function linksAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  return placesAtHand(tasks, at).filter((each) => each.link.workspace !== "");
}

function placesAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const listed = slugOf(tasks.workspaces, tasks.workspace?.id);
  const at_ = (place: LinkPlace, thing: LinkThing, workspace = listed): LinkAtHand => ({
    link: { workspace, place },
    thing,
    step: true,
  });
  const within = (place: LinkPlace, thing: LinkThing): LinkAtHand => ({
    link: { workspace: listed, place },
    thing,
  });
  if (at.settings !== undefined) {
    const { view, workspace } = at.settings;
    const slug = workspace === undefined ? listed : slugOf(tasks.workspaces, workspace.id);
    const place: LinkPlace =
      at.narrow === true && at.settings.listed === true
        ? { kind: LINK_PLACE.SETTINGS }
        : { kind: LINK_PLACE.SETTINGS, page: view };
    return [at_(place, LINK_THING.SETTINGS, slug)];
  }
  if (at.admin !== undefined) {
    const root = { kind: LINK_PLACE.ADMIN } as const;
    const fields = adminLinkFields(at.admin);
    if (Object.keys(fields).length === 0) return [at_(root, LINK_THING.ADMIN)];
    return [at_({ ...root, ...fields }, LINK_THING.ADMIN_PAGE), within(root, LINK_THING.ADMIN)];
  }
  const { userId, workspaceId } = tasks.personView;
  if (userId !== undefined && at.underRouted !== true) {
    const home = workspaceId === undefined ? listed : slugOf(tasks.workspaces, workspaceId);
    return [at_({ kind: LINK_PLACE.PERSON, userId }, LINK_THING.PERSON, home)];
  }
  if (tasks.boardView.open && at.underRouted !== true) {
    return [at_({ kind: LINK_PLACE.BOARD }, LINK_THING.BOARD)];
  }
  if (tasks.automationsView.open && at.underRouted !== true) {
    const list: LinkPlace = { kind: LINK_PLACE.AUTOMATIONS };
    const { place } = tasks.automationsView;
    if (place.kind === AUTOMATIONS_PAGE.EDIT) {
      return [
        at_(
          { kind: LINK_PLACE.AUTOMATION, automationId: place.automationId },
          LINK_THING.AUTOMATION,
        ),
        within(list, LINK_THING.AUTOMATIONS),
      ];
    }
    if (place.kind === AUTOMATIONS_PAGE.NEW) return [within(list, LINK_THING.AUTOMATIONS)];
    return [at_(list, LINK_THING.AUTOMATIONS)];
  }
  const { agentId } = tasks.agentView;
  if (agentId !== undefined) {
    const page = at.pageWorkspace;
    const home = page?.agentId === agentId ? slugOf(tasks.workspaces, page.workspaceId) : listed;
    const own = at_({ kind: LINK_PLACE.AGENT, agentId }, LINK_THING.AGENT, home);
    const held = tasks.sidePanel.open ? panelTabPlace({ agentId }, tasks.sidePanel.tab) : undefined;
    const thing = held === undefined ? undefined : panelThing(held);
    if (held === undefined || thing === undefined) return [own];
    const shown: LinkAtHand = { link: { workspace: home, place: held }, thing };
    return at.sidePanelFocused || tasks.sidePanel.fullScreen ? [shown, own] : [own, shown];
  }
  if (tasks.inboxView.open) {
    const inboxPlace: LinkPlace =
      at.inboxTask === undefined
        ? { kind: LINK_PLACE.INBOX }
        : { kind: LINK_PLACE.INBOX, planId: at.inboxTask };
    const inbox = at_(inboxPlace, LINK_THING.INBOX);
    const { chosen } = tasks.inboxView;
    if (chosen === undefined) return [inbox];
    const item = inboxItemPlace(chosen);
    if (at.narrow === true || tasks.inboxView.single === true) {
      return [at_(item, LINK_THING.INBOX_ITEM), within(inboxPlace, LINK_THING.INBOX)];
    }
    return [within(item, LINK_THING.INBOX_ITEM), inbox];
  }
  if (tasks.unknownWorkspace.open) return [];
  if (tasks.boundFor === undefined) {
    return [at_({ kind: LINK_PLACE.HOME }, LINK_THING.HOME)];
  }
  return taskLinks(tasks, at);
}

export interface CopyLink {
  readonly linksAt: (sidePanelFocused: boolean) => readonly LinkAtHand[];
  readonly standing: ReadLink | undefined;
  readonly placed: ReadLink | undefined;
  readonly copy: (held: LinkAtHand) => void;
  readonly onPageWorkspace: (held: PageWorkspace | undefined) => void;
}

export function inSidePanel(element: Element | null): boolean {
  return element?.closest(SIDE_PANEL_SELECTOR) != null;
}

export function usePageWorkspace(agentId: string, workspaceId: string | undefined): void {
  const tell = useContext(PageWorkspaceContext);
  useEffect(() => {
    if (workspaceId === undefined) return undefined;
    tell({ agentId, workspaceId });
    return () => tell(undefined);
  }, [tell, agentId, workspaceId]);
}

export function useCopyLink(
  tasks: TasksControl,
  settings: WindowAt["settings"],
  enabled: boolean,
  room: ShellRoom = SHELL_ROOM.WIDE,
  admin: AdminView | undefined = undefined,
): CopyLink {
  const copyWords = useCopyToast();
  const copy = (held: LinkAtHand) =>
    copyWords(linkOf(held.link.place, held.link.workspace), LINK_COPY.COPIED);
  const [pageWorkspace, onPageWorkspace] = useState<PageWorkspace | undefined>(undefined);
  const inboxTask = useInboxTask();
  const linksAt = (sidePanelFocused: boolean) =>
    linksAtHand(tasks, {
      settings,
      admin,
      sidePanelFocused,
      pageWorkspace,
      narrow: room === SHELL_ROOM.NARROW,
      inboxTask,
    });
  useAppCommand(
    APP_COMMAND.COPY_LINK,
    enabled && linksAt(false).length > 0
      ? () => {
          const first = linksAt(inSidePanel(document.activeElement))[0];
          if (first !== undefined) copy(first);
        }
      : undefined,
  );
  const firstLink = (sidePanelFocused: boolean): string | undefined => {
    const first = enabled ? linksAt(sidePanelFocused)[0] : undefined;
    return first === undefined ? undefined : linkOf(first.link.place, first.link.workspace);
  };
  useHoldChordLinks(firstLink(false), firstLink(true));
  const standing = linksAt(false).find((each) => each.step === true)?.link;
  const placed = linksAtHand(tasks, {
    settings: undefined,
    underRouted: true,
    sidePanelFocused: false,
    pageWorkspace,
    narrow: room === SHELL_ROOM.NARROW,
    inboxTask,
  }).find((each) => each.step === true)?.link;
  return { linksAt, standing, placed, copy, onPageWorkspace };
}
