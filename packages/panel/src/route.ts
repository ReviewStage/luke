import {
  LINK_PLACE,
  type LinkPlace,
  pullRequestAddressOf,
  type ReadLink,
  readLink,
} from "@luke/features/link-grammar";
import {
  decodeMention,
  MENTION_KIND,
  type MentionLines,
  pageRepositoryOf,
} from "@luke/features/mention-link";
import {
  listedPullRequestOf,
  type OpenedPullRequest,
  pullRequestAgentOf,
  repositoryPullRequestOf,
} from "@luke/ui/pull-request-link";

/**
 * route.ts -- the one table of where an address pressed opens: beside the surface it was pressed on, at a place the window goes to, or in the browser.
 *
 * An address (`addressOf`) is a place in Luke as its link names it, or a
 * page on the web: a pull request's on GitHub, a file's of a repository, or
 * any other. A surface (`Here`) is what the press came from and what that
 * holds: an Inbox item and what holds it, a task's page, an agent's page,
 * the window past every surface, and the window's Tasks tab as it goes to a
 * place. `route` answers what one does with the other, and nothing else
 * decides it: a surface asks it of every link pressed on it first
 * (`use-open-link.ts`'s `OpenHere`), the window asks it of what no surface
 * took (`useOpenLink`), and the Tasks tab asks it of a thing of a task as it
 * goes there (`use-tasks-tab.ts`'s `linkPanelTab`). What each surface then
 * does with the answer is its own door's: which tab stands for the thing, and
 * how the window goes to a place, kind by kind.
 *
 * The table, by surface:
 *
 * - An Inbox item previews beside it what the panel standing for what holds
 *   it draws: a file of its repository, a page of its task or of the agent on
 *   no task that holds it, an archived agent's Changes, one of its task's
 *   agents' transcripts, and a pull request one of its agents opened, or
 *   another of its task's repository by its number. An agent of its task the
 *   panel does not draw, an archived one, goes to the task on its tab.
 * - A task's page and an agent's page preview a pull request one of their
 *   agents opened, an archived one's among them, in its Pull request tab, and
 *   any other of their repository by its number in their first agent's.
 * - The window goes to every place in Luke, and to the Pull request tab of a
 *   pull request a listed task's or a listed agent on no task's agent opened;
 *   anything else leaves for the browser, as everything does outside the
 *   window.
 * - The Tasks tab previews a page, an agent's Changes, a worker, or a review
 *   thread of the task it shows with nothing standing over its plan, and goes
 *   to any other.
 */

/** The kinds of address a press names. */
export const ADDRESS = {
  /** A place in Luke, as its link names it, or an older `luke://plan/` names a task or a section. */
  PLACE: "place",
  /** A pull request's page on GitHub, or any page under it. */
  PULL_REQUEST: "pull-request",
  /** A file of a repository, as its page on GitHub names it, or an older `luke://file/` names one of whichever repository the surface holds. */
  FILE: "file",
  /** Any other page. */
  WEB: "web",
} as const;

/** What a press names, and the address as it was written, which leaves for the browser where nothing in the window opens it. */
export type Address =
  | {
      readonly kind: typeof ADDRESS.PLACE;
      readonly link: ReadLink;
      /** None for a place handed rather than written. */
      readonly href?: string;
    }
  | {
      readonly kind: typeof ADDRESS.PULL_REQUEST;
      readonly href: string;
      readonly repository: string;
      readonly number: number;
    }
  | {
      readonly kind: typeof ADDRESS.FILE;
      readonly href: string;
      /** None for an older link, which names a file of whichever repository the surface holds. */
      readonly repository: string | undefined;
      readonly path: string;
      readonly lines: MentionLines | undefined;
    }
  | { readonly kind: typeof ADDRESS.WEB; readonly href: string };

/** The surfaces a press comes from. */
export const HERE = {
  /** An Inbox item, the panel beside it standing for what holds the item. */
  INBOX_ITEM: "inbox-item",
  /** A task's page. */
  TASK: "task",
  /** An agent's own page. */
  AGENT: "agent",
  /** The window, past whatever surface the press came from. */
  WINDOW: "window",
  /** The window's Tasks tab, going to a place of a task. */
  TASKS_TAB: "tasks-tab",
} as const;

/**
 * What a surface holds that a link may name: its repository, `owner/name`,
 * or none before one is chosen; the pull requests its agents opened, by
 * agent; the agents whose tabs it draws, none before they are read; and
 * every agent it holds, an archived one among them, whose Pull request tab
 * stands as a live agent's does.
 */
interface Holding {
  readonly repository: string | null | undefined;
  readonly pullRequests: ReadonlyMap<string, { readonly url: string }>;
  readonly agentIds: readonly string[] | undefined;
  readonly heldIds: readonly string[] | undefined;
}

/** The tasks and the agents on no task the window lists, as their rows name their pull requests. */
export interface Listed {
  readonly tasks: Parameters<typeof listedPullRequestOf>[1];
  readonly agents: Parameters<typeof listedPullRequestOf>[2];
}

/** The surface a press comes from, and what it holds. */
export type Here =
  | ({
      readonly kind: typeof HERE.INBOX_ITEM;
      /** The task that holds the item; none for an item of an agent on no task. */
      readonly taskId: string | undefined;
      /** The agent on no task that holds the item, whose own pages open beside it; none for an item of a task. */
      readonly agentId: string | undefined;
    } & Holding)
  | ({ readonly kind: typeof HERE.TASK | typeof HERE.AGENT } & Holding)
  | {
      readonly kind: typeof HERE.WINDOW;
      /** Whether the window opens a place at all; outside it, as in a test of one surface, a Luke link opens in the browser. */
      readonly opensPlaces: boolean;
      /** What the window lists, whose pull requests open in their Pull request tabs; none inside a pull request's own tab, where a link to one leaves for GitHub. */
      readonly listed: Listed | undefined;
    }
  | {
      readonly kind: typeof HERE.TASKS_TAB;
      /** The task the tab shows with nothing standing over its plan; none where the Inbox, an agent's page, a version history, or another page stands. */
      readonly taskId: string | undefined;
    };

/** The things a press opens beside a surface, in the panel there. */
export const THING = {
  FILE: "file",
  PAGE: "page",
  /** An agent's Changes, its Pull request tab, as a Luke link names it. */
  CHANGES: "changes",
  /** An agent's transcript. */
  TRANSCRIPT: "transcript",
  /** An agent's Pull request tab on its Conversation, as the pull request's page on GitHub names it. */
  PULL_REQUEST: "pull-request",
  /** One of an agent's workers. */
  WORKER: "worker",
} as const;

/** A thing a press opens beside a surface. */
export type Thing =
  | {
      readonly kind: typeof THING.FILE;
      readonly path: string;
      readonly lines: MentionLines | undefined;
    }
  | { readonly kind: typeof THING.PAGE; readonly pageId: string }
  | { readonly kind: typeof THING.CHANGES; readonly agentId: string }
  | { readonly kind: typeof THING.TRANSCRIPT; readonly agentId: string }
  | {
      readonly kind: typeof THING.PULL_REQUEST;
      readonly agentId: string;
      /** The pull request's number, where it is another of the repository's than the one the agent opened. */
      readonly number?: number;
    }
  | { readonly kind: typeof THING.WORKER; readonly agentId: string; readonly callId: string };

/** What a press does. */
export const ROUTE = {
  /** Opens a thing in the panel beside the surface, as its preview. */
  PREVIEW: "preview",
  /** The window goes to a place. */
  GO: "go",
  /** Leaves for the browser. */
  EXTERNAL: "external",
  /** The surface opens nothing of it, and whatever stands around it is asked. */
  NOTHING: "nothing",
} as const;

/** What a press does, and with what. */
export type Route =
  | { readonly kind: typeof ROUTE.PREVIEW; readonly thing: Thing }
  | { readonly kind: typeof ROUTE.GO; readonly link: ReadLink }
  | { readonly kind: typeof ROUTE.EXTERNAL; readonly href: string }
  | { readonly kind: typeof ROUTE.NOTHING };

type InboxItemHere = Extract<Here, { readonly kind: typeof HERE.INBOX_ITEM }>;
type WindowHere = Extract<Here, { readonly kind: typeof HERE.WINDOW }>;
type TasksTabHere = Extract<Here, { readonly kind: typeof HERE.TASKS_TAB }>;

const NOTHING: Route = { kind: ROUTE.NOTHING };

function preview(thing: Thing): Route {
  return { kind: ROUTE.PREVIEW, thing };
}

function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
}

/** The pull requests a surface's agents opened, by their pages on GitHub, each by the agent that opened it; only those of `owners` where it names them. */
function openedBy(holding: Holding, owners?: readonly string[]): OpenedPullRequest[] {
  return [...holding.pullRequests].flatMap(([agentId, { url }]) =>
    owners === undefined || owners.includes(agentId) ? [{ agentId, url }] : [],
  );
}

/** Whether a repository an address names is the one a surface holds, whatever the case its owner and name are spelled in, as GitHub reads them. */
function ofRepository(named: string, repository: string | null | undefined): boolean {
  return (
    repository !== null &&
    repository !== undefined &&
    named.toLowerCase() === repository.toLowerCase()
  );
}

/** Whether an agent a link names is one of what holds the item: by the task an older link names it under, else by the agent itself, among the agents given. */
function holdsAgent(
  at: { readonly planId?: string | undefined; readonly agentId: string },
  taskId: string | undefined,
  agentIds: readonly string[] | undefined,
): boolean {
  return at.planId === undefined ? agentIds?.includes(at.agentId) === true : at.planId === taskId;
}

/** A place in Luke pressed on an Inbox item: a page, an agent's Changes, or an agent of what holds it opens beside it, and any other place is the window's. */
function itemPlace(link: ReadLink, here: InboxItemHere): Route {
  const at = link.place;
  switch (at.kind) {
    case LINK_PLACE.PAGE: {
      // A page of the item's own task, or of the agent on no task that holds it, opens beside the item; another's is the window's to open.
      const own =
        "planId" in at
          ? at.planId === here.taskId
          : here.agentId !== undefined && at.agentId === here.agentId;
      return own ? preview({ kind: THING.PAGE, pageId: at.pageId }) : NOTHING;
    }
    // An archived agent's Changes still opens beside the item, as its older link under the task did.
    case LINK_PLACE.CHANGES:
      return holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
        ? preview({ kind: THING.CHANGES, agentId: at.agentId })
        : NOTHING;
    // An agent of the item's own task reads beside it; one on no task, or another task's, is the window's to open.
    case LINK_PLACE.AGENT: {
      if (here.taskId === undefined || !holdsAgent(at, here.taskId, here.agentIds)) return NOTHING;
      // An archived one, which its task alone draws, goes to the task on its tab.
      return here.agentIds?.includes(at.agentId) === true
        ? preview({ kind: THING.TRANSCRIPT, agentId: at.agentId })
        : go({
            workspace: link.workspace,
            place: { kind: LINK_PLACE.AGENT, planId: here.taskId, agentId: at.agentId },
          });
    }
    default:
      return NOTHING;
  }
}

/**
 * An address pressed on an Inbox item, whose panel stands for what holds the
 * item, so nothing opens there before an item is chosen. Note that a pull
 * request of the repository opens by its number only on an item of a task,
 * and in its first agent's tab even where it is under the page of one an
 * agent opened; a task's page and an agent's answer both otherwise.
 */
function besideItem(address: Address, here: InboxItemHere): Route {
  if (here.taskId === undefined && here.agentId === undefined) return NOTHING;
  switch (address.kind) {
    case ADDRESS.PLACE:
      return itemPlace(address.link, here);
    case ADDRESS.PULL_REQUEST: {
      const agentId = pullRequestAgentOf(address.href, openedBy(here));
      if (agentId !== undefined) return preview({ kind: THING.PULL_REQUEST, agentId });
      const first = here.agentIds?.[0];
      return ofRepository(address.repository, here.repository) &&
        first !== undefined &&
        here.taskId !== undefined
        ? preview({ kind: THING.PULL_REQUEST, agentId: first, number: address.number })
        : NOTHING;
    }
    // A file of the item's repository, which the panel reads through the task it stands for, or through the workspace and repository of an agent with none.
    case ADDRESS.FILE: {
      const own =
        address.repository === undefined
          ? here.repository !== null && here.repository !== undefined
          : ofRepository(address.repository, here.repository);
      return own
        ? preview({ kind: THING.FILE, path: address.path, lines: address.lines })
        : NOTHING;
    }
    case ADDRESS.WEB:
      return NOTHING;
  }
}

/**
 * An address pressed on a task's page or an agent's: a pull request one of
 * its agents opened, however its page is spelled, opens in that agent's Pull
 * request tab, and any other of its repository, such as one an agent opened
 * before moving to another branch, in its first agent's by its number; any
 * other address is the window's. An archived agent's pull request, merged or
 * not, opens its tab too.
 */
function besideAgents(address: Address, here: Holding): Route {
  if (address.kind !== ADDRESS.PULL_REQUEST) return NOTHING;
  const opened = openedBy(here, here.heldIds ?? here.agentIds);
  const agentId = pullRequestAgentOf(address.href, opened);
  if (agentId !== undefined) return preview({ kind: THING.PULL_REQUEST, agentId });
  if (!ofRepository(address.repository, here.repository)) return NOTHING;
  // A page under an agent's own pull request's, its files say, is still that agent's.
  const owner = opened.find(
    (each) => repositoryPullRequestOf(each.url, here.repository) === address.number,
  );
  if (owner !== undefined) return preview({ kind: THING.PULL_REQUEST, agentId: owner.agentId });
  const first = here.agentIds?.[0];
  return first === undefined
    ? NOTHING
    : preview({ kind: THING.PULL_REQUEST, agentId: first, number: address.number });
}

/** The address as written, for the browser; nothing for a place handed rather than written. */
function external(address: Address): Route {
  return address.href === undefined ? NOTHING : { kind: ROUTE.EXTERNAL, href: address.href };
}

/** An address no surface took: a place in Luke goes there, a listed task's or agent's pull request to its Pull request tab, and anything else, or everything outside the window, leaves for the browser. */
function throughWindow(address: Address, here: WindowHere): Route {
  if (!here.opensPlaces) return external(address);
  if (address.kind === ADDRESS.PLACE) return go(address.link);
  const listed =
    address.kind === ADDRESS.PULL_REQUEST && here.listed !== undefined
      ? listedPullRequestOf(address.href, here.listed.tasks, here.listed.agents)
      : undefined;
  if (listed === undefined) return external(address);
  const task = listed.taskId === undefined ? undefined : { planId: listed.taskId };
  return go({
    workspace: "",
    place: { kind: LINK_PLACE.CHANGES, ...task, agentId: listed.agentId },
  });
}

/** The thing of a task a place names that the task's panel draws as a tab of its own: a page, an agent's Changes or one of its review threads, or a worker; nothing for any other place. */
function taskThingOf(place: LinkPlace): Thing | undefined {
  switch (place.kind) {
    case LINK_PLACE.PAGE:
      return "planId" in place ? { kind: THING.PAGE, pageId: place.pageId } : undefined;
    case LINK_PLACE.CHANGES:
    case LINK_PLACE.PULL_REQUEST_THREAD:
      return { kind: THING.CHANGES, agentId: place.agentId };
    case LINK_PLACE.WORKER:
      return { kind: THING.WORKER, agentId: place.agentId, callId: place.callId };
    default:
      return undefined;
  }
}

/** A place the Tasks tab goes to: a thing of the task it shows with nothing over its plan opens as the panel's preview, as any link pressed there does; one of another task's, or any other place, goes there. */
function onTasksTab(address: Address, here: TasksTabHere): Route {
  if (address.kind !== ADDRESS.PLACE) return NOTHING;
  const { place } = address.link;
  const thing = taskThingOf(place);
  const standing = here.taskId !== undefined && "planId" in place && place.planId === here.taskId;
  return thing !== undefined && standing ? preview(thing) : go(address.link);
}

/**
 * The address a link is: a place a Luke link names, or a task or a section
 * an older `luke://plan/` does; a pull request's page on GitHub, or any page
 * under it; a file's page, read against its own repository, which a surface
 * then holds it to, or an older `luke://file/`, which names none; and any
 * other page.
 */
export function addressOf(href: string): Address {
  const link = readLink(href);
  if (link !== undefined) return { kind: ADDRESS.PLACE, link, href };
  const pullRequest = pullRequestAddressOf(href);
  if (pullRequest !== undefined) return { kind: ADDRESS.PULL_REQUEST, href, ...pullRequest };
  const repository = pageRepositoryOf(href);
  const mention = decodeMention(href, repository ?? null);
  switch (mention?.kind) {
    case MENTION_KIND.FILE:
      return { kind: ADDRESS.FILE, href, repository, path: mention.path, lines: mention.lines };
    case MENTION_KIND.TASK:
      return {
        kind: ADDRESS.PLACE,
        link: { workspace: "", place: { kind: LINK_PLACE.TASK, planId: mention.taskId } },
        href,
      };
    case MENTION_KIND.SECTION:
      return {
        kind: ADDRESS.PLACE,
        link: {
          workspace: "",
          place: { kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor: mention.anchor },
        },
        href,
      };
    default:
      return { kind: ADDRESS.WEB, href };
  }
}

/** What a press on an address does, from the surface given. */
export function route(address: Address, here: Here): Route {
  switch (here.kind) {
    case HERE.INBOX_ITEM:
      return besideItem(address, here);
    case HERE.TASK:
    case HERE.AGENT:
      return besideAgents(address, here);
    case HERE.WINDOW:
      return throughWindow(address, here);
    case HERE.TASKS_TAB:
      return onTasksTab(address, here);
  }
}
