import { LINK_PLACE, type LinkPlace, linkOf, type ReadLink } from "@luke/features/luke-link";
import type { Workspace } from "@luke/features/workspace-wire";
import type { SettingsView } from "@luke/settings/settings-views";
import { isAgentTab, isChangesTab, isPageTab, isSubagentTab } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION } from "@luke/ui/tasks-model";
import { createContext, useContext, useEffect, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "./app-commands";
import { LINK_COPY, useCopyToast } from "./copy-feedback";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel";
import { AUTOMATIONS_PAGE, type TasksControl } from "./tasks/use-tasks-tab";

/**
 * links-at-hand.ts -- the links the window can copy right now: what is open or focused, the most specific first.
 *
 * ⌥⌘C copies the first, as Linear's chord copies the open issue's, and the
 * command palette offers each as "Copy link to <thing>". Most specific
 * first: the tab of the side panel where the keyboard is in it or the panel
 * fills the window, else the
 * work column's agent, then the side panel's tab, then the task under them;
 * what stands in the plan's place (an agent's page, the Inbox on an item,
 * an automation, Factory) before the list it is in; and a page of Settings
 * while Settings stands. A tab with nothing of its own to link to, a
 * file's, the board, the code, or a terminal, is passed over for the task.
 * Each link is written under its workspace's slug, or its id until the
 * workspaces are read, as a task's own is; an agent's page under the
 * workspace the page read its agent into, which only the page knows, so the
 * page tells the window (`usePageWorkspace`).
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
  CHANGES: "changes",
  INBOX: "Inbox",
  INBOX_ITEM: "Inbox item",
  AUTOMATIONS: "Automations",
  AUTOMATION: "automation",
  FACTORY: "Factory",
  SETTINGS: "settings page",
  PERSON: "profile",
} as const;

type LinkThing = (typeof LINK_THING)[keyof typeof LINK_THING];

/** A link the window can copy: the place, under its workspace, what it is called, and its name where the window holds one. */
export interface LinkAtHand {
  readonly link: ReadLink;
  readonly thing: LinkThing;
  readonly name?: string | undefined;
}

/** The workspace an agent's page read its agent into, by the agent's id. */
interface PageWorkspace {
  readonly agentId: string;
  readonly workspaceId: string;
}

/** Where the window stands beyond the Plans tab: Settings on a page, whether the keyboard is in the side panel, and an agent's page's workspace. */
export interface WindowAt {
  readonly settings:
    | { readonly view: SettingsView; readonly workspace: Workspace | undefined }
    | undefined;
  readonly sidePanelFocused: boolean;
  readonly pageWorkspace?: PageWorkspace | undefined;
}

const PageWorkspaceContext = createContext<(held: PageWorkspace | undefined) => void>(
  () => undefined,
);

/** Hands an agent's page the window's ear for the workspace it read its agent into (`CopyLink`'s `onPageWorkspace`). */
export const PageWorkspaceProvider = PageWorkspaceContext.Provider;

/** A workspace as a link names it: its slug, or its id before its slug is read. */
function slugOf(workspaces: readonly Workspace[], workspaceId: string | undefined): string {
  const home = workspaces.find((each) => each.id === workspaceId);
  return home?.slug ?? workspaceId ?? "";
}

/** The place a tab of the side panel shows, on its task; none for a tab whose thing has no link of its own: a file's, the board, the code, a terminal. */
export function panelTabPlace(
  planId: string,
  tab: SidePanelTab | undefined,
): LinkPlace | undefined {
  if (tab === undefined) return undefined;
  if (tab === SIDE_PANEL_TAB.CALL) return { kind: LINK_PLACE.CALL, planId };
  if (isPageTab(tab)) return { kind: LINK_PLACE.PAGE, planId, pageId: tab.page };
  if (isChangesTab(tab)) return { kind: LINK_PLACE.CHANGES, planId, agentId: tab.changes };
  if (!isSubagentTab(tab)) return undefined;
  const agent = tab.delegation?.agent;
  return agent === undefined
    ? { kind: LINK_PLACE.WORKER, planId, callId: tab.subagent }
    : { kind: LINK_PLACE.WORKER, planId, agentId: agent, callId: tab.subagent };
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
  const { task: plan } = region;
  const workspace = slugOf(tasks.workspaces, plan.workspaceId);
  const task: LinkAtHand = {
    link: { workspace, place: { kind: LINK_PLACE.TASK, planId: plan.id } },
    thing: LINK_THING.TASK,
    name: plan.name,
  };
  if (tasks.history.open) {
    const revision = tasks.history.selected;
    return revision === undefined
      ? [task]
      : [
          {
            link: { workspace, place: { kind: LINK_PLACE.VERSION, planId: plan.id, revision } },
            thing: LINK_THING.VERSION,
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
          link: { workspace, place: { kind: LINK_PLACE.AGENT, planId: plan.id, agentId } },
          thing: LINK_THING.AGENT,
          name: tasks.agents.agents?.find((each) => each.id === agentId)?.title ?? undefined,
        };
  const held = tasks.sidePanel.open ? panelTabPlace(plan.id, tasks.sidePanel.tab) : undefined;
  const thing = held === undefined ? undefined : panelThing(held);
  const panel: LinkAtHand | undefined =
    held === undefined || thing === undefined
      ? undefined
      : { link: { workspace, place: held }, thing };
  // A panel filling the window hides the work column, so its tab is at hand whatever holds the keyboard.
  const panelFirst = at.sidePanelFocused || tasks.sidePanel.fullScreen;
  const order = panelFirst ? [panel, agent, task] : [agent, panel, task];
  return order.filter((each): each is LinkAtHand => each !== undefined);
}

/** Every link the window can copy now, the most specific first; none on the home page. */
function linksAtHand(tasks: TasksControl, at: WindowAt): readonly LinkAtHand[] {
  const listed = slugOf(tasks.workspaces, tasks.workspace?.id);
  const at_ = (place: LinkPlace, thing: LinkThing, workspace = listed): LinkAtHand => ({
    link: { workspace, place },
    thing,
  });
  if (at.settings !== undefined) {
    const { view, workspace } = at.settings;
    const slug = workspace === undefined ? listed : slugOf(tasks.workspaces, workspace.id);
    return [at_({ kind: LINK_PLACE.SETTINGS, page: view }, LINK_THING.SETTINGS, slug)];
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
    return [at_(item, LINK_THING.INBOX_ITEM), inbox];
  }
  if (tasks.automationsView.open) {
    const list = at_({ kind: LINK_PLACE.AUTOMATIONS }, LINK_THING.AUTOMATIONS);
    const { place } = tasks.automationsView;
    return place.kind === AUTOMATIONS_PAGE.EDIT
      ? [
          at_(
            { kind: LINK_PLACE.AUTOMATION, automationId: place.automationId },
            LINK_THING.AUTOMATION,
          ),
          list,
        ]
      : [list];
  }
  if (tasks.factoryView.open) return [at_({ kind: LINK_PLACE.FACTORY }, LINK_THING.FACTORY)];
  return taskLinks(tasks, at);
}

/**
 * The links at hand, the most specific first, as the keyboard stood in or
 * out of the side panel, and the copy of one, as the command palette offers
 * them; and the ear an agent's page tells its workspace to.
 */
export interface CopyLink {
  readonly linksAt: (sidePanelFocused: boolean) => readonly LinkAtHand[];
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
): CopyLink {
  const copyWords = useCopyToast();
  const copy = (held: LinkAtHand) =>
    copyWords(linkOf(held.link.place, held.link.workspace), LINK_COPY.COPIED);
  const [pageWorkspace, onPageWorkspace] = useState<PageWorkspace | undefined>(undefined);
  const linksAt = (sidePanelFocused: boolean) =>
    linksAtHand(tasks, { settings, sidePanelFocused, pageWorkspace });
  useAppCommand(
    APP_COMMAND.COPY_LINK,
    enabled && linksAt(false).length > 0
      ? () => {
          const first = linksAt(inSidePanel(document.activeElement))[0];
          if (first !== undefined) copy(first);
        }
      : undefined,
  );
  return { linksAt, copy, onPageWorkspace };
}
