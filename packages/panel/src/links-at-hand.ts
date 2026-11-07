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
import { STRIP_TAB_KIND } from "@repo/ui/tab-strip-model";
import { DOCUMENT_REGION } from "@repo/ui/tasks-model";
import { createContext, useContext, useEffect, useState } from "react";
import type { AdminView } from "./admin/routing.js";
import { useAppCommand } from "./app-commands.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import { useHoldChordLinks } from "./copy-link-item.js";
import type { RoutedPlace } from "./places/routed-places.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { stripTabLink } from "./tasks/strip-tab-kinds.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import type { InboxChoice, TasksControl } from "./tasks/use-tasks-tab.js";

/**
 * links-at-hand.ts -- the links the window can copy right now: what is open or focused, the most specific first.
 *
 * ⇧⌘C copies the first, as Linear's chord copies the open issue's, and the
 * command palette offers each as "Copy link to <thing>". Most specific
 * first: the tab of the side panel where the keyboard is in it or the panel
 * fills the window, else the
 * work column's agent, then the side panel's tab, then the task under them;
 * what stands in the plan's place (an agent's page, the Inbox on an item,
 * an automation, an Admin view) before the list it is in; and a page of Settings
 * while Settings stands. A tab with nothing of its own to link to, a
 * file's, the board, the code, the Inbox, or a terminal, is passed over for
 * the task, and so is the plan's, whose link is the task's.
 * Each link is written under its workspace's slug, or its id until the
 * workspaces are read, as a task's own is, and names a task by its number
 * where it has one (`taskLinkStep`); an Inbox item by its id alone; an agent's page under the
 * workspace the page read its agent into, which only the page knows, so the
 * page tells the window (`usePageWorkspace`). A place whose workspace is
 * known by neither, as with no workspace listed, has no link, since a link
 * with no workspace would name a path of none.
 *
 * One of them names the step the window stands on, as its history counts
 * steps (`navigation-history.ts`): the task, or its version while its
 * version history stands, the home page, the Board, the Inbox, an agent's or
 * a person's page, an automation or the list, the Admin place's view, or a
 * page of Settings. The history writes that link as the step's address, so
 * the address and Copy link never disagree. A new automation's page has
 * none. A narrow
 * room, which shows one pane at a time, names the pane it shows as the
 * step: the side panel's tab over the plan, where the tab has a link, the
 * Inbox's item standing alone (as it is in an Inbox showing one column by
 * its own width, in a room still wide), Settings' page list, whose link
 * names no page, and the Admin
 * place's section list, whose link names no view.
 *
 * An Inbox narrowed to a task has the task's Inbox link,
 * `/inbox/task/<taskId>`, in the Inbox's.
 */

/** The side panel's own element, inside which the keyboard makes its tab the thing at hand. */
const SIDE_PANEL_SELECTOR = ".side-panel";

/** What a link at hand is called where it is offered: "Copy link to <thing>". */
export const LINK_THING = {
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

export type LinkThing = (typeof LINK_THING)[keyof typeof LINK_THING];

/** A link the window can copy: the place, under its workspace, what it is called, its name where the window holds one, and whether it names the step the window stands on. */
export interface LinkAtHand {
  readonly link: ReadLink;
  readonly thing: LinkThing;
  readonly name?: string | undefined;
  /** Whether it names the step the window stands on, rather than something open within it or the task under it. */
  readonly step?: boolean;
}

/** The workspace an agent's page read its agent into, by the agent's id. */
interface PageWorkspace {
  readonly agentId: string;
  readonly workspaceId: string;
}

/** Where the window stands beyond the Plans tab: Settings on a page, whether the keyboard is in the side panel, and an agent's page's workspace. */
export interface WindowAt {
  readonly settings:
    | {
        readonly view: SettingsView;
        readonly workspace: Workspace | undefined;
        /** Whether its page list stands rather than the page, which only a narrow room draws apart. */
        readonly listed?: boolean;
      }
    | undefined;
  readonly sidePanelFocused: boolean;
  /** The routed place the router stands on, which offers its own links (`places/routed-places.ts`); none while the window's state says where it stands. */
  readonly place?: RoutedPlace | undefined;
  /** The Admin view the router stands on, while Admin stands. */
  readonly admin?: AdminView | undefined;
  /** Whether the links asked for are the place the window's state says, under whatever routed place stands, as a routed place is left for it. */
  readonly underRouted?: boolean;
  readonly pageWorkspace?: PageWorkspace | undefined;
  /** Whether the room is narrow, showing one pane at a time. */
  readonly narrow?: boolean;
  /** The task the Inbox is narrowed to. */
  readonly inboxTask?: string | undefined;
}

const PageWorkspaceContext = createContext<(held: PageWorkspace | undefined) => void>(
  () => undefined,
);

/** Hands an agent's page the window's ear for the workspace it read its agent into (`CopyLink`'s `onPageWorkspace`). */
export const PageWorkspaceProvider = PageWorkspaceContext.Provider;

/** A workspace as a link names it: its slug, or its id before its slug is read; empty where neither is known. */
export function slugOf(workspaces: readonly Workspace[], workspaceId: string | undefined): string {
  const home = workspaces.find((each) => each.id === workspaceId);
  return home?.slug ?? workspaceId ?? "";
}

/**
 * The place a tab of the side panel shows, on the task or the agent's page
 * that holds the panel; none for a tab whose thing has no link of its own:
 * a file's, the Inbox, the comments, a terminal, the plan's of old,
 * whose task is the column's Overview and linked as the task, a pull request
 * the agent did not open, and a worker of the app's own, which is drawn
 * nowhere a link opens. Note that a Changes or a
 * worker's tab is the agent's, so it is linked by the agent alone, on a
 * task's panel as on the agent's page.
 */
export function panelTabPlace(
  holder: PagePlace,
  tab: SidePanelTab | undefined,
): LinkPlace | undefined {
  return tab === undefined ? undefined : stripTabLink(tab, holder);
}

/** What a side panel tab's link is called, by the kind of place it names; none for a kind no tab of the panel shows. */
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

/** An Inbox item's place, by its id alone, whose agent, task, and workspace its reader asks the service for, as every Copy link of an item writes it. */
export function inboxItemPlace(chosen: InboxChoice): LinkPlace {
  return { kind: LINK_PLACE.INBOX_ITEM, itemId: chosen.itemId };
}

/** The links of the task drawn: its version chosen, its tabs', and its own, the most specific first. */
function taskLinks(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const { region } = tasks;
  if (region.kind !== DOCUMENT_REGION.READY) return [];
  const { task: drawn } = region;
  const workspace = slugOf(tasks.workspaces, drawn.workspaceId);
  // Note that the task's links name it by its number, where it has one, as every link to it is written.
  const planId = taskLinkStep(drawn);
  const task: LinkAtHand = {
    link: { workspace, place: { kind: LINK_PLACE.TASK, planId } },
    thing: LINK_THING.TASK,
    name: drawn.name,
  };
  // Note that the column's Overview is the task itself, so it adds no link past the task's.
  const shown = tasks.mainTabs.tab;
  const agentId =
    shown !== undefined && typeof shown !== "string" && shown.kind === STRIP_TAB_KIND.AGENT
      ? shown.agent
      : undefined;
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
  // A panel filling the window hides the work column, so its tab is at hand whatever holds the keyboard.
  const panelFirst = at.sidePanelFocused || tasks.sidePanel.fullScreen;
  // A narrow room's panel is a step of its own, which its tab's link names where it has one.
  if (at.narrow === true && panel !== undefined) {
    return [{ ...panel, step: true }, agent, task].filter(
      (each): each is LinkAtHand => each !== undefined,
    );
  }
  const standing: LinkAtHand = { ...task, step: true };
  const order = panelFirst ? [panel, agent, standing] : [agent, panel, standing];
  return order.filter((each): each is LinkAtHand => each !== undefined);
}

/** Every link the window can copy now, the most specific first; none for a place whose workspace is unknown. */
function linksAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  return placesAtHand(tasks, at).filter((each) => each.link.workspace !== "");
}

/** The links of what is open or focused, the most specific first, each under the workspace it is in, empty where that is unknown: a routed place's by its declaration, over the links of the place the window's state says. */
function placesAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const listed = slugOf(tasks.workspaces, tasks.workspace?.id);
  const under = () => stateLinks(tasks, at, listed);
  if (at.place === undefined || at.underRouted === true) return under();
  return at.place.links({ tasks, at, listed, under });
}

/** The links of an agent's own page: the page's, under the workspace the page read its agent into, else the one listed, and the tab of the panel beside it with a link of its own, first where the panel holds the keys. */
export function agentPageLinks(
  tasks: TasksControl,
  at: WindowAt,
  listed: string,
  agentId: string,
): readonly LinkAtHand[] {
  const page = at.pageWorkspace;
  const home = page?.agentId === agentId ? slugOf(tasks.workspaces, page.workspaceId) : listed;
  const own: LinkAtHand = {
    link: { workspace: home, place: { kind: LINK_PLACE.AGENT, agentId } },
    thing: LINK_THING.AGENT,
    step: true,
  };
  // A tab of the panel beside it with a link of its own, a page the agent showed, its Changes, or a worker's, is at hand under the agent's link.
  const held = tasks.sidePanel.open ? panelTabPlace({ agentId }, tasks.sidePanel.tab) : undefined;
  const thing = held === undefined ? undefined : panelThing(held);
  if (held === undefined || thing === undefined) return [own];
  const shown: LinkAtHand = { link: { workspace: home, place: held }, thing };
  return at.sidePanelFocused || tasks.sidePanel.fullScreen ? [shown, own] : [own, shown];
}

/** The links of the place the window's state says: the home page, or the task. */
function stateLinks(tasks: TasksControl, at: WindowAt, listed: string): readonly LinkAtHand[] {
  // `at_` writes the link of the step the window stands on.
  const at_ = (place: LinkPlace, thing: LinkThing, workspace = listed): LinkAtHand => ({
    link: { workspace, place },
    thing,
    step: true,
  });
  // With no task bound for, the window stands on the home page.
  if (tasks.boundFor === undefined) {
    return [at_({ kind: LINK_PLACE.HOME }, LINK_THING.HOME)];
  }
  return taskLinks(tasks, at);
}

/**
 * The links at hand, the most specific first, as the keyboard stood in or
 * out of the side panel, and the copy of one, as the command palette offers
 * them; the link of the step the window stands on, which its history writes
 * as that step's address; and the ear an agent's page tells its workspace to.
 */
export interface CopyLink {
  readonly linksAt: (sidePanelFocused: boolean) => readonly LinkAtHand[];
  readonly standing: ReadLink | undefined;
  /** The link of the place the window's state says, the step a routed place is left for. */
  readonly placed: ReadLink | undefined;
  readonly copy: (held: LinkAtHand) => void;
  readonly onPageWorkspace: (held: PageWorkspace | undefined) => void;
}

/** Whether `element` is in the side panel, which makes its tab the thing at hand while the keyboard is there. */
export function inSidePanel(element: Element | null): boolean {
  return element?.closest(SIDE_PANEL_SELECTOR) != null;
}

/** Tells the window the workspace `agentId`'s page read its agent into, so its links name that one rather than the one listed. */
export function usePageWorkspace(agentId: string, workspaceId: string | undefined): void {
  const tell = useContext(PageWorkspaceContext);
  useEffect(() => {
    if (workspaceId === undefined) return undefined;
    tell({ agentId, workspaceId });
    return () => tell(undefined);
  }, [tell, agentId, workspaceId]);
}

/**
 * The window's Copy link: ⇧⌘C, offered while anything has a link and the
 * window is `enabled`, copying the first link at hand as the keyboard
 * stands at the press, and saying "Link copied"; and the links at hand,
 * with their copy, for the command palette to offer each. The first link
 * as the keyboard stands outside the side panel and in it is held for the
 * menus, whose Copy link prints the chord where it copies the same.
 */
export function useCopyLink(
  tasks: TasksControl,
  settings: WindowAt["settings"],
  enabled: boolean,
  room: ShellRoom = SHELL_ROOM.WIDE,
  admin: AdminView | undefined = undefined,
  place: RoutedPlace | undefined = undefined,
): CopyLink {
  const copyWords = useCopyToast();
  const copy = (held: LinkAtHand) =>
    copyWords(linkOf(held.link.place, held.link.workspace), LINK_COPY.COPIED);
  const [pageWorkspace, onPageWorkspace] = useState<PageWorkspace | undefined>(undefined);
  const inboxTask = tasks.inboxView.narrowed;
  const linksAt = (sidePanelFocused: boolean) =>
    linksAtHand(tasks, {
      settings,
      place,
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
