import { LINK_PLACE, type LinkPlace, linkOf, type ReadLink } from "@luke/features/luke-link";
import type { Workspace } from "@luke/features/workspace-wire";
import type { SettingsView } from "@luke/settings/settings-views";
import { DOCUMENT_REGION } from "@luke/ui/planning-model";
import { isAgentTab, isChangesTab, isPageTab, isSubagentTab } from "@luke/ui/tab-strip-model";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "./app-commands";
import { LINK_COPY, useCopyToast } from "./copy-feedback";
import { AUTOMATIONS_PAGE, type PlansControl } from "./planning/use-plans-tab";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./planning/use-side-panel";

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
 * workspaces are read, as a task's own is.
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
} as const;

type LinkThing = (typeof LINK_THING)[keyof typeof LINK_THING];

/** A link the window can copy: the place, under its workspace, what it is called, and its name where the window holds one. */
export interface LinkAtHand {
  readonly link: ReadLink;
  readonly thing: LinkThing;
  readonly name?: string | undefined;
}

/** Where the window stands beyond the Plans tab: Settings on a page, and whether the keyboard is in the side panel. */
export interface WindowAt {
  readonly settings:
    | { readonly view: SettingsView; readonly workspace: Workspace | undefined }
    | undefined;
  readonly sidePanelFocused: boolean;
}

/** A workspace as a link names it: its slug, or its id before its slug is read. */
function slugOf(workspaces: readonly Workspace[], workspaceId: string | undefined): string {
  const home = workspaces.find((each) => each.id === workspaceId);
  return home?.slug ?? workspaceId ?? "";
}

/** The link a tab of the side panel has of its own, on its task; none for a tab whose thing has no link. */
function panelLink(
  planId: string,
  tab: SidePanelTab | undefined,
):
  | (Omit<LinkAtHand, "link"> & {
      readonly place: LinkPlace;
    })
  | undefined {
  if (tab === undefined) return undefined;
  if (tab === SIDE_PANEL_TAB.CALL)
    return { place: { kind: LINK_PLACE.CALL, planId }, thing: LINK_THING.CALL };
  if (isPageTab(tab)) {
    return { place: { kind: LINK_PLACE.PAGE, planId, pageId: tab.page }, thing: LINK_THING.PAGE };
  }
  if (isChangesTab(tab)) {
    return {
      place: { kind: LINK_PLACE.CHANGES, planId, agentId: tab.changes },
      thing: LINK_THING.CHANGES,
    };
  }
  if (isSubagentTab(tab)) {
    const agent = tab.delegation?.agent;
    return {
      place:
        agent === undefined
          ? { kind: LINK_PLACE.WORKER, planId, callId: tab.subagent }
          : { kind: LINK_PLACE.WORKER, planId, agentId: agent, callId: tab.subagent },
      thing: LINK_THING.WORKER,
    };
  }
  return undefined;
}

/** The links of the task drawn: its version chosen, its tabs', and its own, the most specific first. */
function taskLinks(plans: PlansControl, at: WindowAt): readonly LinkAtHand[] {
  const { region } = plans;
  if (region.kind !== DOCUMENT_REGION.READY) return [];
  const { plan } = region;
  const workspace = slugOf(plans.workspaces, plan.workspaceId);
  const task: LinkAtHand = {
    link: { workspace, place: { kind: LINK_PLACE.TASK, planId: plan.id } },
    thing: LINK_THING.TASK,
    name: plan.name,
  };
  if (plans.history.open) {
    const revision = plans.history.selected;
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
  const shown = plans.mainTabs.tab;
  const agentId = isAgentTab(shown) ? shown.agent : undefined;
  const agent: LinkAtHand | undefined =
    agentId === undefined
      ? undefined
      : {
          link: { workspace, place: { kind: LINK_PLACE.AGENT, planId: plan.id, agentId } },
          thing: LINK_THING.AGENT,
          name: plans.agents.agents?.find((each) => each.id === agentId)?.title ?? undefined,
        };
  const held = plans.sidePanel.open ? panelLink(plan.id, plans.sidePanel.tab) : undefined;
  const panel: LinkAtHand | undefined =
    held === undefined ? undefined : { link: { workspace, place: held.place }, thing: held.thing };
  // A panel filling the window hides the work column, so its tab is at hand whatever holds the keyboard.
  const panelFirst = at.sidePanelFocused || plans.sidePanel.fullScreen;
  const order = panelFirst ? [panel, agent, task] : [agent, panel, task];
  return order.filter((each): each is LinkAtHand => each !== undefined);
}

/** Every link the window can copy now, the most specific first; none on the home page. */
function linksAtHand(plans: PlansControl, at: WindowAt): readonly LinkAtHand[] {
  const listed = slugOf(plans.workspaces, plans.workspace?.id);
  const at_ = (place: LinkPlace, thing: LinkThing, workspace = listed): LinkAtHand => ({
    link: { workspace, place },
    thing,
  });
  if (at.settings !== undefined) {
    const { view, workspace } = at.settings;
    const slug = workspace === undefined ? listed : slugOf(plans.workspaces, workspace.id);
    return [at_({ kind: LINK_PLACE.SETTINGS, page: view }, LINK_THING.SETTINGS, slug)];
  }
  const { agentId } = plans.agentView;
  if (agentId !== undefined) return [at_({ kind: LINK_PLACE.AGENT, agentId }, LINK_THING.AGENT)];
  if (plans.inboxView.open) {
    const inbox = at_({ kind: LINK_PLACE.INBOX }, LINK_THING.INBOX);
    const { chosen } = plans.inboxView;
    if (chosen === undefined) return [inbox];
    const item: LinkPlace =
      "planId" in chosen
        ? { kind: LINK_PLACE.INBOX_ITEM, planId: chosen.planId, itemId: chosen.itemId }
        : { kind: LINK_PLACE.INBOX_ITEM, agentId: chosen.agentId, itemId: chosen.itemId };
    return [at_(item, LINK_THING.INBOX_ITEM), inbox];
  }
  if (plans.automationsView.open) {
    const list = at_({ kind: LINK_PLACE.AUTOMATIONS }, LINK_THING.AUTOMATIONS);
    const { place } = plans.automationsView;
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
  if (plans.factoryView.open) return [at_({ kind: LINK_PLACE.FACTORY }, LINK_THING.FACTORY)];
  return taskLinks(plans, at);
}

/** The links at hand, the most specific first, and the copy of one, as the command palette offers them. */
export interface CopyLink {
  readonly links: readonly LinkAtHand[];
  readonly copy: (held: LinkAtHand) => void;
}

/** Whether the keyboard is in the side panel now, which makes its tab the thing at hand. */
function sidePanelFocused(): boolean {
  return document.activeElement?.closest(SIDE_PANEL_SELECTOR) != null;
}

/**
 * The window's Copy link: ⌥⌘C, offered while anything has a link and the
 * window is `enabled`, copying the first link at hand as the keyboard
 * stands at the press, and saying "Link copied"; and the links at hand,
 * with their copy, for the command palette to offer each.
 */
export function useCopyLink(
  plans: PlansControl,
  settings: WindowAt["settings"],
  enabled: boolean,
): CopyLink {
  const copyWords = useCopyToast();
  const copy = (held: LinkAtHand) =>
    copyWords(linkOf(held.link.place, held.link.workspace), LINK_COPY.COPIED);
  const links = linksAtHand(plans, { settings, sidePanelFocused: false });
  useAppCommand(
    APP_COMMAND.COPY_LINK,
    enabled && links.length > 0
      ? () => {
          const first = linksAtHand(plans, { settings, sidePanelFocused: sidePanelFocused() })[0];
          if (first !== undefined) copy(first);
        }
      : undefined,
  );
  return { links, copy };
}
