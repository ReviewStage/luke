import { LINK_PLACE, type LinkPlace, linkOf, type ReadLink } from "@luke/features/luke-link";
import type { Workspace } from "@luke/features/workspace-wire";
import type { SettingsView } from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { CHAT_PLACE } from "@luke/ui/chat-model";
import { isAgentTab, isChangesTab, isPageTab, isSubagentTab } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION } from "@luke/ui/tasks-model";
import { createContext, useContext, useEffect, useState } from "react";
import { useAppCommand } from "./app-commands.js";
import { LINK_COPY, useCopyToast } from "./copy-feedback.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "./tasks/use-tasks-tab.js";

/**
 * links-at-hand.ts -- the links the window can copy right now: what is open or focused, the most specific first.
 *
 * ⌥⌘C copies the first, as Linear's chord copies the open issue's, and the
 * command palette offers each as "Copy link to <thing>". Most specific
 * first: the tab of the side panel where the keyboard is in it or the panel
 * fills the window, else the
 * work column's agent, then the side panel's tab, then the task under them;
 * what stands in the plan's place (an agent's page, the Inbox on an item,
 * an automation, Factory, a channel of Chat) before the list it is in; and a page of Settings
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
 * automation or the list, Factory, Chat, or a page of Settings. The history
 * writes that link as the step's address, so the address and Copy link
 * never disagree. Chat names its channel shown, or itself on For you. The
 * Board, a new automation's page, and the home page have none. A narrow
 * room, which shows one pane at a time, names the pane it shows as the
 * step: the side panel's tab over the plan, where the tab has a link, the
 * Inbox's item standing alone (as it is in an Inbox showing one column by
 * its own width, in a room still wide), Settings' page list, whose link
 * names no page, and Chat's rail, whose link names no channel.
 */

/** The side panel's own element, inside which the keyboard makes its tab the thing at hand. */
const SIDE_PANEL_SELECTOR = ".side-panel";

/** What a link at hand is called where it is offered: "Copy link to <thing>". */
const LINK_THING = {
  TASK: "task",
  VERSION: "version",
  PAGE: "page",
  CALL: "call",
  AGENT: "agent",
  WORKER: "worker",
  CHANGES: "pull request",
  INBOX: "Inbox",
  INBOX_ITEM: "Inbox item",
  AUTOMATIONS: "Automations",
  AUTOMATION: "automation",
  FACTORY: "Factory",
  SETTINGS: "settings page",
  PERSON: "profile",
  CHAT: "Chat",
  CHANNEL: "channel",
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

/** The place a tab of the side panel shows, on its task; none for a tab whose thing has no link of its own: a file's, the board, the code, the Inbox, a terminal. */
export function panelTabPlace(
  taskId: string,
  tab: SidePanelTab | undefined,
): LinkPlace | undefined {
  if (tab === undefined) return undefined;
  if (tab === SIDE_PANEL_TAB.PLAN) return { kind: LINK_PLACE.TASK, planId: taskId };
  if (isPageTab(tab)) return { kind: LINK_PLACE.PAGE, planId: taskId, pageId: tab.page };
  if (isChangesTab(tab)) return { kind: LINK_PLACE.CHANGES, planId: taskId, agentId: tab.changes };
  if (!isSubagentTab(tab)) return undefined;
  const agent = tab.delegation?.agent;
  return agent === undefined
    ? { kind: LINK_PLACE.WORKER, planId: taskId, callId: tab.subagent }
    : { kind: LINK_PLACE.WORKER, planId: taskId, agentId: agent, callId: tab.subagent };
}

/** What a side panel tab's link is called, by the kind of place it names; none for a kind no tab of the panel shows. */
function panelThing(place: LinkPlace): LinkThing | undefined {
  switch (place.kind) {
    case LINK_PLACE.CALL:
      return LINK_THING.CALL;
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
  const shown = tasks.mainTabs.tab;
  const agentId = isAgentTab(shown) ? shown.agent : undefined;
  const agent: LinkAtHand | undefined =
    agentId === undefined
      ? undefined
      : {
          link: { workspace, place: { kind: LINK_PLACE.AGENT, planId: drawn.id, agentId } },
          thing: LINK_THING.AGENT,
          name: tasks.agents.agents?.find((each) => each.id === agentId)?.title ?? undefined,
        };
  const held = tasks.sidePanel.open ? panelTabPlace(drawn.id, tasks.sidePanel.tab) : undefined;
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
    return [at_({ kind: LINK_PLACE.AGENT, agentId }, LINK_THING.AGENT, home)];
  }
  // A person's page is theirs in the workspace it opened in, which their link names.
  const { userId, workspaceId } = tasks.personView;
  if (userId !== undefined) {
    const home = workspaceId === undefined ? listed : slugOf(tasks.workspaces, workspaceId);
    return [at_({ kind: LINK_PLACE.PERSON, userId }, LINK_THING.PERSON, home)];
  }
  if (tasks.inboxView.open) {
    const inbox = at_({ kind: LINK_PLACE.INBOX }, LINK_THING.INBOX);
    const { chosen } = tasks.inboxView;
    if (chosen === undefined) return [inbox];
    const item: LinkPlace =
      "taskId" in chosen
        ? { kind: LINK_PLACE.INBOX_ITEM, planId: chosen.taskId, itemId: chosen.itemId }
        : { kind: LINK_PLACE.INBOX_ITEM, agentId: chosen.agentId, itemId: chosen.itemId };
    // An item standing alone, in a narrow room or an Inbox showing one column by its own width, is a step of its own.
    if ((at.narrow === true || tasks.inboxView.single === true) && !tasks.inboxView.listed) {
      return [
        at_(item, LINK_THING.INBOX_ITEM),
        within({ kind: LINK_PLACE.INBOX }, LINK_THING.INBOX),
      ];
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
  if (tasks.factoryView.open) return [at_({ kind: LINK_PLACE.FACTORY }, LINK_THING.FACTORY)];
  if (tasks.chatView.open) {
    const root = { kind: LINK_PLACE.CHAT } as const;
    const { place } = tasks.chatView;
    if (place.kind !== CHAT_PLACE.CHANNEL) return [at_(root, LINK_THING.CHAT)];
    // A narrow room's rail stands alone over the channel it hides, so the rail is the step, at Chat's own link.
    if (at.narrow === true && tasks.chatView.listed) return [at_(root, LINK_THING.CHAT)];
    const channel: LinkPlace = { kind: LINK_PLACE.CHAT, channelId: place.channelId };
    return [at_(channel, LINK_THING.CHANNEL), within(root, LINK_THING.CHAT)];
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
 * The window's Copy link: ⌥⌘C, offered while anything has a link and the
 * window is `enabled`, copying the first link at hand as the keyboard
 * stands at the press, and saying "Link copied"; and the links at hand,
 * with their copy, for the command palette to offer each.
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
  const linksAt = (sidePanelFocused: boolean) =>
    linksAtHand(tasks, {
      settings,
      sidePanelFocused,
      pageWorkspace,
      narrow: room === SHELL_ROOM.NARROW,
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
  const standing = linksAt(false).find((each) => each.step === true)?.link;
  return { linksAt, standing, copy, onPageWorkspace };
}
