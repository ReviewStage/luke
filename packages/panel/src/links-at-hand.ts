import {
  channelPlace,
  LINK_PLACE,
  type LinkPlace,
  linkOf,
  type ReadLink,
} from "@luke/features/link-grammar";
import type { PagePlace } from "@luke/features/page-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import type { SettingsView } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { isAgentTab, isChangesTab, isPageTab, isSubagentTab } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION } from "@luke/ui/tasks-model";
import { createContext, useContext, useEffect, useState } from "react";
import { adminLinkFields } from "./admin/routing.js";
import { useAppCommand } from "./app-commands.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import { useHoldChordLinks } from "./copy-link-item.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { type ShownChannel, useInboxTask, useShownChannel } from "./tasks/use-channels.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "./tasks/use-tasks-tab.js";

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
 * workspaces are read, as a task's own is; an agent's page under the
 * workspace the page read its agent into, which only the page knows, so the
 * page tells the window (`usePageWorkspace`). A place whose workspace is
 * known by neither, as with no workspace listed, has no link, since a link
 * with no workspace would name a path of none.
 *
 * One of them names the step the window stands on, as its history counts
 * steps (`navigation-history.ts`): the task, or its version while its
 * version history stands, the Inbox, an agent's or a person's page, an
 * automation or the list, the Admin place's view, or a page of Settings. The history
 * writes that link as the step's address, so the address and Copy link
 * never disagree. The Board, a new automation's page, and the home page have none. A narrow
 * room, which shows one pane at a time, names the pane it shows as the
 * step: the side panel's tab over the plan, where the tab has a link, the
 * Inbox's item standing alone (as it is in an Inbox showing one column by
 * its own width, in a room still wide), Settings' page list, whose link
 * names no page, and the Admin
 * place's section list, whose link names no view.
 *
 * With Channels on, an Inbox narrowed to a channel has the channel's link
 * in the Inbox's, and its chosen thread's link is at hand before it as an
 * item's is, naming the step in its place where it stands alone. An Inbox
 * narrowed to a task, Channels on or off, has the task's Inbox link,
 * `/inbox/plan/<taskId>`, in the Inbox's.
 */

/** The side panel's own element, inside which the keyboard makes its tab the thing at hand. */
const SIDE_PANEL_SELECTOR = ".side-panel";

/** What a link at hand is called where it is offered: "Copy link to <thing>". */
const LINK_THING = {
  TASK: "task",
  VERSION: "version",
  PAGE: "page",
  AGENT: "agent",
  WORKER: "worker",
  CHANGES: "pull request",
  INBOX: "Inbox",
  INBOX_ITEM: "Inbox item",
  CHANNEL: "channel",
  THREAD: "thread",
  AUTOMATIONS: "Automations",
  AUTOMATION: "automation",
  SETTINGS: "settings page",
  PERSON: "profile",
  ADMIN: "Admin",
  ADMIN_PAGE: "admin page",
} as const;

type LinkThing = (typeof LINK_THING)[keyof typeof LINK_THING];

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
  readonly pageWorkspace?: PageWorkspace | undefined;
  /** Whether the room is narrow, showing one pane at a time. */
  readonly narrow?: boolean;
  /** The channel the Inbox is narrowed to, with Channels on. */
  readonly channel?: ShownChannel | undefined;
  /** The task the Inbox is narrowed to, Channels on or off. */
  readonly inboxTask?: string | undefined;
}

const PageWorkspaceContext = createContext<(held: PageWorkspace | undefined) => void>(
  () => undefined,
);

/** Hands an agent's page the window's ear for the workspace it read its agent into (`CopyLink`'s `onPageWorkspace`). */
export const PageWorkspaceProvider = PageWorkspaceContext.Provider;

/** A workspace as a link names it: its slug, or its id before its slug is read; empty where neither is known. */
function slugOf(workspaces: readonly Workspace[], workspaceId: string | undefined): string {
  const home = workspaces.find((each) => each.id === workspaceId);
  return home?.slug ?? workspaceId ?? "";
}

/**
 * The place a tab of the side panel shows, on the task or the agent's page
 * that holds the panel; none for a tab whose thing has no link of its own:
 * a file's, the Inbox, the comments, a terminal, the plan's of old,
 * whose task is the column's Overview and linked as the task, a pull request
 * the agent did not open, and a worker of Luke's own, which is drawn
 * nowhere a link opens. Note that a Changes or a
 * worker's tab is the agent's, so it is linked by the agent alone, on a
 * task's panel as on the agent's page.
 */
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
  // A Changes tab on another pull request of the agent's repository, by its number, is no place a link names.
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

/** An Inbox item's place, under its agent; under its task only while an older link opened it naming no agent. */
function inboxItemPlace(chosen: InboxChoice): LinkPlace {
  if (!("taskId" in chosen)) {
    return { kind: LINK_PLACE.INBOX_ITEM, agentId: chosen.agentId, itemId: chosen.itemId };
  }
  const { taskId, itemAgentId, itemId } = chosen;
  return itemAgentId === undefined
    ? { kind: LINK_PLACE.INBOX_ITEM, planId: taskId, itemId }
    : { kind: LINK_PLACE.INBOX_ITEM, agentId: itemAgentId, itemId };
}

/** The links of an Inbox narrowed to a channel: its chosen thread's, a step of its own where it stands alone, and the channel's. */
function channelLinks(
  tasks: TasksControl,
  shown: ShownChannel,
  alone: boolean,
  at: (place: LinkPlace, thing: LinkThing, step: boolean) => LinkAtHand,
): readonly LinkAtHand[] {
  const channel = channelPlace(shown.channel.id);
  const { chosen } = tasks.inboxView;
  if (chosen === undefined) return [at(channel, LINK_THING.CHANNEL, true)];
  const item = inboxItemPlace(chosen);
  if (alone) {
    return [at(item, LINK_THING.THREAD, true), at(channel, LINK_THING.CHANNEL, false)];
  }
  return [at(item, LINK_THING.THREAD, false), at(channel, LINK_THING.CHANNEL, true)];
}

/** The links of the task drawn: its version chosen, its tabs', and its own, the most specific first. */
function taskLinks(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const { region } = tasks;
  if (region.kind !== DOCUMENT_REGION.READY) return [];
  const { task: drawn } = region;
  const workspace = slugOf(tasks.workspaces, drawn.workspaceId);
  const task: LinkAtHand = {
    link: { workspace, place: { kind: LINK_PLACE.TASK, planId: drawn.id } },
    thing: LINK_THING.TASK,
    name: drawn.name,
  };
  if (tasks.history.open) {
    const revision = tasks.history.selected;
    // A narrow room's version list stands alone, and has no link of its own, so it is the task's step.
    const listedAlone = at.narrow === true && tasks.history.listed;
    return revision === undefined || listedAlone
      ? [{ ...task, step: true }]
      : [
          {
            link: { workspace, place: { kind: LINK_PLACE.VERSION, planId: drawn.id, revision } },
            thing: LINK_THING.VERSION,
            step: true,
          },
          task,
        ];
  }
  // Note that the column's Overview is the task itself, so it adds no link past the task's.
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
  const held = tasks.sidePanel.open
    ? panelTabPlace({ taskId: drawn.id }, tasks.sidePanel.tab)
    : undefined;
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

/** Every link the window can copy now, the most specific first; none on the home page, nor for a place whose workspace is unknown. */
function linksAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  return placesAtHand(tasks, at).filter((each) => each.link.workspace !== "");
}

/** The links of what is open or focused, the most specific first, each under the workspace it is in, empty where that is unknown. */
function placesAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const listed = slugOf(tasks.workspaces, tasks.workspace?.id);
  // `at_` writes the link of the step the window stands on, `within` one of something open in it.
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
    // A narrow room's page list stands alone, so its link names no page.
    const place: LinkPlace =
      at.narrow === true && at.settings.listed === true
        ? { kind: LINK_PLACE.SETTINGS }
        : { kind: LINK_PLACE.SETTINGS, page: view };
    return [at_(place, LINK_THING.SETTINGS, slug)];
  }
  const { agentId } = tasks.agentView;
  if (agentId !== undefined) {
    const page = at.pageWorkspace;
    const home = page?.agentId === agentId ? slugOf(tasks.workspaces, page.workspaceId) : listed;
    const own = at_({ kind: LINK_PLACE.AGENT, agentId }, LINK_THING.AGENT, home);
    // A tab of the panel beside it with a link of its own, a page the agent showed, its Changes, or a worker's, is at hand under the agent's link, first where the panel holds the keys.
    const held = tasks.sidePanel.open ? panelTabPlace({ agentId }, tasks.sidePanel.tab) : undefined;
    const thing = held === undefined ? undefined : panelThing(held);
    if (held === undefined || thing === undefined) return [own];
    const shown: LinkAtHand = { link: { workspace: home, place: held }, thing };
    return at.sidePanelFocused || tasks.sidePanel.fullScreen ? [shown, own] : [own, shown];
  }
  // A person's page is theirs in the workspace it opened in, which their link names.
  const { userId, workspaceId } = tasks.personView;
  if (userId !== undefined) {
    const home = workspaceId === undefined ? listed : slugOf(tasks.workspaces, workspaceId);
    return [at_({ kind: LINK_PLACE.PERSON, userId }, LINK_THING.PERSON, home)];
  }
  if (tasks.inboxView.open && at.channel !== undefined) {
    const alone = at.narrow === true || tasks.inboxView.single === true;
    return channelLinks(tasks, at.channel, alone, (place, thing, step) =>
      step ? at_(place, thing) : within(place, thing),
    );
  }
  if (tasks.inboxView.open) {
    // An Inbox narrowed to a task is linked by it, so a copied link or a reload opens it narrowed again.
    const inboxPlace: LinkPlace =
      at.inboxTask === undefined
        ? { kind: LINK_PLACE.INBOX }
        : { kind: LINK_PLACE.INBOX, planId: at.inboxTask };
    const inbox = at_(inboxPlace, LINK_THING.INBOX);
    const { chosen } = tasks.inboxView;
    if (chosen === undefined) return [inbox];
    const item = inboxItemPlace(chosen);
    // An item standing alone, in a narrow room or an Inbox showing one column by its own width, is a step of its own.
    if (at.narrow === true || tasks.inboxView.single === true) {
      return [at_(item, LINK_THING.INBOX_ITEM), within(inboxPlace, LINK_THING.INBOX)];
    }
    return [within(item, LINK_THING.INBOX_ITEM), inbox];
  }
  if (tasks.automationsView.open) {
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
    // A new automation's page is a step with no link of its own, so it offers the list it is in.
    if (place.kind === AUTOMATIONS_PAGE.NEW) return [within(list, LINK_THING.AUTOMATIONS)];
    return [at_(list, LINK_THING.AUTOMATIONS)];
  }
  // The Admin place stands over the plan, so its link is the step's rather than the plan's behind it.
  // Its workspace is only the one listed, since the place reads every workspace's accounts.
  if (tasks.adminView.open) {
    const root = { kind: LINK_PLACE.ADMIN } as const;
    const fields = adminLinkFields(tasks.adminView.view);
    if (Object.keys(fields).length === 0) return [at_(root, LINK_THING.ADMIN)];
    return [at_({ ...root, ...fields }, LINK_THING.ADMIN_PAGE), within(root, LINK_THING.ADMIN)];
  }
  // The Board has no link of its own either, on the same terms.
  if (tasks.boardView.open) return [];
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
): CopyLink {
  const copyWords = useCopyToast();
  const copy = (held: LinkAtHand) =>
    copyWords(linkOf(held.link.place, held.link.workspace), LINK_COPY.COPIED);
  const [pageWorkspace, onPageWorkspace] = useState<PageWorkspace | undefined>(undefined);
  const channel = useShownChannel(tasks.workspace?.id);
  const inboxTask = useInboxTask();
  const linksAt = (sidePanelFocused: boolean) =>
    linksAtHand(tasks, {
      settings,
      sidePanelFocused,
      pageWorkspace,
      narrow: room === SHELL_ROOM.NARROW,
      channel,
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
  return { linksAt, standing, copy, onPageWorkspace };
}
