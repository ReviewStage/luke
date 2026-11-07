import {
  LINK_PLACE,
  type LinkPlace,
  type PullRequestThreadView,
  pullRequestAddressOf,
  type ReadLink,
  readLink,
  taskNumberOf,
} from "@repo/features/link-grammar";
import {
  decodeMention,
  MENTION_KIND,
  type MentionLines,
  pageRepositoryOf,
} from "@repo/features/mention-link";
import type { PagePlace } from "@repo/features/page-wire";
import {
  listedPullRequestOf,
  type OpenedPullRequest,
  pullRequestAgentOf,
  repositoryPullRequestOf,
} from "@repo/ui/pull-request-link";

/**
 * route.ts -- the one table of where an address pressed opens: beside the surface it was pressed on, at a place the window goes to, or in the browser.
 *
 * An address (`addressOf`) is a place in the app as its link names it, or a
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
 * - An Inbox item opens beside it what the panel standing for what holds
 *   it draws: a file of any repository, read through the item's workspace
 *   where it is not the item's own, a page of any task or agent on no
 *   task, read on its own place where it is not the item's, an archived
 *   agent's Changes, one of its task's agents' transcripts, at a message of
 *   it where the link names one, a review thread of one of its agents' pull
 *   requests, and a pull request as `pullRequestBeside` opens it. An agent
 *   of its task the panel does not draw, an archived one, is the window's,
 *   which opens its tab on the task; any other agent is the window's too,
 *   which opens it in the middle. Another Inbox item is chosen in the Inbox the item stands in,
 *   rather than in its task's Inbox tab.
 * - A task's page and an agent's page open beside them a pull request one of their
 *   agents opened, an archived one's among them, in its Pull request tab, and
 *   any other of their repository by its number in their first agent's; and
 *   a page of any other task or agent on no task, read on its own place,
 *   their own pages being the window's to open as the panel's.
 * - The window goes to every place in the app, and to the Pull request tab of a
 *   pull request a listed task's or a listed agent on no task's agent opened;
 *   anything else leaves for the browser, as everything does outside the
 *   window.
 * - The Tasks tab opens beside it a page, an agent's Changes, a worker, or a review
 *   thread of the task it shows with nothing standing over its plan, chooses
 *   that task's Overview for the task itself, one of its description's sections, or
 *   one of its comments, at the section or the comment, and goes to any
 *   other.
 */

/** The kinds of address a press names. */
export const ADDRESS = {
  /** A place in the app, as its link names it, or an older `luke://plan/` names a task or a section. */
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
  | ({
      readonly kind: typeof HERE.TASK;
      /** The task the page shows. */
      readonly taskId: string;
    } & Holding)
  | ({
      readonly kind: typeof HERE.AGENT;
      /** The agent the page shows. */
      readonly agentId: string;
    } & Holding)
  | {
      readonly kind: typeof HERE.WINDOW;
      /** Whether the window opens a place at all; outside it, as in a test of one surface, an app link opens in the browser. */
      readonly opensPlaces: boolean;
      /** What the window lists, whose pull requests open in their Pull request tabs; none inside a pull request's own tab, where a link to one leaves for GitHub. */
      readonly listed: Listed | undefined;
    }
  | {
      readonly kind: typeof HERE.TASKS_TAB;
      /** The task the tab shows with nothing standing over its plan; none where the Inbox, an agent's page, a version history, or another page stands. */
      readonly taskId: string | undefined;
    };

/** The things a press opens beside a surface, in the panel there, or, an Inbox item, in the Inbox the surface stands in. */
export const THING = {
  FILE: "file",
  PAGE: "page",
  /** An agent's Changes, its Pull request tab, as an app link names it. */
  CHANGES: "changes",
  /** An agent's transcript, at one of its messages where the link names one. */
  TRANSCRIPT: "transcript",
  /** An agent's Pull request tab on its Conversation, as the pull request's page on GitHub names it. */
  PULL_REQUEST: "pull-request",
  /** One review thread of an agent's pull request, in its Pull request tab, on the view the link names. */
  THREAD: "thread",
  /** One of an agent's workers. */
  WORKER: "worker",
  /** An Inbox item, chosen in the Inbox. */
  INBOX_ITEM: "inbox-item",
} as const;

/** A thing a press opens beside a surface. */
export type Thing =
  | {
      readonly kind: typeof THING.FILE;
      readonly path: string;
      readonly lines: MentionLines | undefined;
      /** The repository, `owner/name`, the file is read from, where it is not the surface's own; none for the surface's own. */
      readonly repository?: string;
    }
  | {
      readonly kind: typeof THING.PAGE;
      readonly pageId: string;
      /** The task or the agent on no task the page stands on, where it is not the surface's own; none for the surface's own page. */
      readonly place?: PagePlace;
    }
  | { readonly kind: typeof THING.CHANGES; readonly agentId: string }
  | {
      readonly kind: typeof THING.TRANSCRIPT;
      readonly agentId: string;
      /** The message brought into view; none for the transcript as it stands. */
      readonly messageId?: string;
    }
  | {
      readonly kind: typeof THING.PULL_REQUEST;
      readonly agentId: string;
      /** The pull request's number, where it is another of the repository's than the one the agent opened. */
      readonly number?: number;
    }
  | {
      readonly kind: typeof THING.THREAD;
      readonly agentId: string;
      readonly threadId: string;
      readonly view: PullRequestThreadView;
    }
  | { readonly kind: typeof THING.WORKER; readonly agentId: string; readonly callId: string }
  | {
      readonly kind: typeof THING.INBOX_ITEM;
      readonly itemId: string;
      /** The task that holds it; none for an item of an agent on no task. */
      readonly taskId: string | undefined;
      /** The agent that posted it, where the link names it under its agent. */
      readonly agentId: string | undefined;
    };

/** What a press does. */
export const ROUTE = {
  /** Opens a thing in the panel beside the surface, as a tab of its own. */
  BESIDE: "beside",
  /** The window goes to a place. */
  GO: "go",
  /** The task shown chooses its column's Overview, at the section or the comment the place names. */
  OVERVIEW: "overview",
  /** Leaves for the browser. */
  EXTERNAL: "external",
  /** The surface opens nothing of it, and whatever stands around it is asked. */
  NOTHING: "nothing",
} as const;

/** What a press does, and with what. */
export type Route =
  | { readonly kind: typeof ROUTE.BESIDE; readonly thing: Thing }
  | { readonly kind: typeof ROUTE.GO; readonly link: ReadLink }
  | { readonly kind: typeof ROUTE.OVERVIEW; readonly place: OverviewPlace }
  | { readonly kind: typeof ROUTE.EXTERNAL; readonly href: string }
  | { readonly kind: typeof ROUTE.NOTHING };

/** A place the task's Overview shows: the task itself, one of its description's sections, or one of its comments. */
export type OverviewPlace = Extract<
  LinkPlace,
  { readonly kind: typeof LINK_PLACE.TASK | typeof LINK_PLACE.SECTION | typeof LINK_PLACE.COMMENT }
>;

type InboxItemHere = Extract<Here, { readonly kind: typeof HERE.INBOX_ITEM }>;
type WindowHere = Extract<Here, { readonly kind: typeof HERE.WINDOW }>;
type TasksTabHere = Extract<Here, { readonly kind: typeof HERE.TASKS_TAB }>;
type AgentsHere = Extract<Here, { readonly kind: typeof HERE.TASK | typeof HERE.AGENT }>;

const NOTHING: Route = { kind: ROUTE.NOTHING };

function beside(thing: Thing): Route {
  return { kind: ROUTE.BESIDE, thing };
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

/** An Inbox item a link names, chosen in the Inbox an item stands in: one under its task, or one under an agent the item's task holds or the agent on no task that holds the item; any other the window finds by its agent, or by the item alone. */
function itemOfInbox(
  at: Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>,
  here: InboxItemHere,
): Route {
  const { itemId } = at;
  if ("planId" in at) {
    return beside({ kind: THING.INBOX_ITEM, itemId, taskId: at.planId, agentId: undefined });
  }
  // An item named by its id alone is the window's to find, by asking the service whose it is.
  if (!("agentId" in at)) return NOTHING;
  const { agentId } = at;
  if (here.taskId !== undefined) {
    return (here.heldIds ?? here.agentIds)?.includes(agentId) === true
      ? beside({ kind: THING.INBOX_ITEM, itemId, taskId: here.taskId, agentId })
      : NOTHING;
  }
  return agentId === here.agentId
    ? beside({ kind: THING.INBOX_ITEM, itemId, taskId: undefined, agentId })
    : NOTHING;
}

/** A place in the app pressed on an Inbox item: a page, an agent's Changes or a review thread of its pull request, an agent of what holds it or one of its messages, opens beside it, another Inbox item is chosen in its Inbox, and any other place is the window's. */
function itemPlace(link: ReadLink, here: InboxItemHere): Route {
  const at = link.place;
  switch (at.kind) {
    case LINK_PLACE.PAGE: {
      // A page under a task named by a number no one found the task for is the window's, which finds it on the service.
      if (taskNumberOf(at) !== undefined) return NOTHING;
      // A page of the item's own task, or of the agent on no task that holds it, opens beside the item;
      // another's opens there too, read on its own place, so the reader stays on the item.
      const own =
        "planId" in at
          ? at.planId === here.taskId
          : here.agentId !== undefined && at.agentId === here.agentId;
      const place: PagePlace = "planId" in at ? { taskId: at.planId } : { agentId: at.agentId };
      return beside(
        own
          ? { kind: THING.PAGE, pageId: at.pageId }
          : { kind: THING.PAGE, pageId: at.pageId, place },
      );
    }
    // An archived agent's Changes still opens beside the item, as its older link under the task did.
    case LINK_PLACE.CHANGES:
      return holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
        ? beside({ kind: THING.CHANGES, agentId: at.agentId })
        : NOTHING;
    // A review thread of an agent's pull request opens beside the item as its Changes does.
    case LINK_PLACE.PULL_REQUEST_THREAD:
      return holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
        ? beside({
            kind: THING.THREAD,
            agentId: at.agentId,
            threadId: at.threadId,
            view: at.view,
          })
        : NOTHING;
    // A message of an agent of the item's own task the panel draws reads beside it, at the message; an archived one's is the window's to open, in its tab on the task.
    case LINK_PLACE.MESSAGE:
      return here.taskId !== undefined &&
        holdsAgent(at, here.taskId, here.agentIds) &&
        here.agentIds?.includes(at.agentId) === true
        ? beside({ kind: THING.TRANSCRIPT, agentId: at.agentId, messageId: at.messageId })
        : NOTHING;
    case LINK_PLACE.INBOX_ITEM:
      return itemOfInbox(at, here);
    // An agent of the item's own task reads beside it; one on no task, or another task's, is the window's to open.
    case LINK_PLACE.AGENT: {
      if (here.taskId === undefined || !holdsAgent(at, here.taskId, here.agentIds)) return NOTHING;
      // An archived one, which the panel does not draw, is the window's, which opens its tab on the task.
      return here.agentIds?.includes(at.agentId) === true
        ? beside({ kind: THING.TRANSCRIPT, agentId: at.agentId })
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
 * A pull request pressed on a surface: one an agent it holds opened, however
 * its page is spelled, a page under it among them, opens in that agent's
 * Pull request tab, and any other of its repository, such as one an agent
 * opened before moving to another branch, in its first agent's by its
 * number; one of another repository is the window's. An Inbox item, a task's
 * page and an agent's answer it alike, an archived agent's pull request,
 * merged or not, opening its tab too.
 */
function pullRequestBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.PULL_REQUEST }>,
  here: Holding,
): Route {
  const opened = openedBy(here, here.heldIds ?? here.agentIds);
  const agentId = pullRequestAgentOf(address.href, opened);
  if (agentId !== undefined) return beside({ kind: THING.PULL_REQUEST, agentId });
  if (!ofRepository(address.repository, here.repository)) return NOTHING;
  // A page under an agent's own pull request's, its files say, is still that agent's.
  const owner = opened.find(
    (each) => repositoryPullRequestOf(each.url, here.repository) === address.number,
  );
  if (owner !== undefined) return beside({ kind: THING.PULL_REQUEST, agentId: owner.agentId });
  const first = here.agentIds?.[0];
  return first === undefined
    ? NOTHING
    : beside({ kind: THING.PULL_REQUEST, agentId: first, number: address.number });
}

/** An address pressed on an Inbox item, whose panel stands for what holds the item, so nothing opens there before an item is chosen. */
function besideItem(address: Address, here: InboxItemHere): Route {
  if (here.taskId === undefined && here.agentId === undefined) return NOTHING;
  switch (address.kind) {
    case ADDRESS.PLACE:
      return itemPlace(address.link, here);
    case ADDRESS.PULL_REQUEST:
      return pullRequestBeside(address, here);
    // A file of the item's repository, which the panel reads through the task it stands for, or through the workspace and repository of an agent with none;
    // a file of another repository opens there too, read through the item's workspace.
    case ADDRESS.FILE: {
      const { path, lines, repository } = address;
      if (repository === undefined) {
        return here.repository !== null && here.repository !== undefined
          ? beside({ kind: THING.FILE, path, lines })
          : NOTHING;
      }
      return ofRepository(repository, here.repository)
        ? beside({ kind: THING.FILE, path, lines })
        : beside({ kind: THING.FILE, path, lines, repository });
    }
    case ADDRESS.WEB:
      return NOTHING;
  }
}

/** A page of another task, or of another agent on no task, than the one a task's or an agent's page shows, beside it, read on its own place; its own is the window's, which opens it as the panel's. */
function pageBeside(at: LinkPlace, here: AgentsHere): Route {
  // Note that a task named by a number no one found the task for is no place a page reads on, so the window finds it on the service.
  if (at.kind !== LINK_PLACE.PAGE || taskNumberOf(at) !== undefined) return NOTHING;
  const place: PagePlace = "planId" in at ? { taskId: at.planId } : { agentId: at.agentId };
  const own =
    here.kind === HERE.TASK
      ? "planId" in at && at.planId === here.taskId
      : "agentId" in at && at.agentId === here.agentId;
  return own ? NOTHING : beside({ kind: THING.PAGE, pageId: at.pageId, place });
}

/**
 * An address pressed on a task's page or an agent's: a pull request as
 * `pullRequestBeside` opens it, and a page of another place beside it
 * (`pageBeside`); any other address is the window's.
 */
function besideAgents(address: Address, here: AgentsHere): Route {
  if (address.kind === ADDRESS.PLACE) return pageBeside(address.link.place, here);
  return address.kind === ADDRESS.PULL_REQUEST ? pullRequestBeside(address, here) : NOTHING;
}

/** The address as written, for the browser; nothing for a place handed rather than written. */
function external(address: Address): Route {
  return address.href === undefined ? NOTHING : { kind: ROUTE.EXTERNAL, href: address.href };
}

/** An address no surface took: a place in the app goes there, a listed task's or agent's pull request to its Pull request tab, and anything else, or everything outside the window, leaves for the browser. */
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

/** Whether a place is one the task's Overview shows (`OverviewPlace`). */
function overviewPlaceOf(place: LinkPlace): place is OverviewPlace {
  return (
    place.kind === LINK_PLACE.TASK ||
    place.kind === LINK_PLACE.SECTION ||
    place.kind === LINK_PLACE.COMMENT
  );
}

/**
 * A place the Tasks tab goes to: of the task it shows with nothing over its
 * plan, a thing opens in the panel as a tab, as any link pressed there
 * does, and the task itself, a section, or a comment chooses its Overview;
 * one of another task's, or any other place, goes there.
 */
function onTasksTab(address: Address, here: TasksTabHere): Route {
  if (address.kind !== ADDRESS.PLACE) return NOTHING;
  const { place } = address.link;
  const standing = here.taskId !== undefined && "planId" in place && place.planId === here.taskId;
  if (!standing) return go(address.link);
  if (overviewPlaceOf(place)) return { kind: ROUTE.OVERVIEW, place };
  const thing = taskThingOf(place);
  return thing === undefined ? go(address.link) : beside(thing);
}

/**
 * The address a link is: a place an app link names, or a task or a section
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
