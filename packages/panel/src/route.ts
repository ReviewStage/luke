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

export const ADDRESS = {
  PLACE: "place",
  PULL_REQUEST: "pull-request",
  FILE: "file",
  WEB: "web",
} as const;

export type Address =
  | {
      readonly kind: typeof ADDRESS.PLACE;
      readonly link: ReadLink;
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
      readonly repository: string | undefined;
      readonly path: string;
      readonly lines: MentionLines | undefined;
    }
  | { readonly kind: typeof ADDRESS.WEB; readonly href: string };

export const HERE = {
  INBOX_ITEM: "inbox-item",
  TASK: "task",
  AGENT: "agent",
  WINDOW: "window",
  TASKS_TAB: "tasks-tab",
} as const;

interface Holding {
  readonly repository: string | null | undefined;
  readonly pullRequests: ReadonlyMap<string, { readonly url: string }>;
  readonly agentIds: readonly string[] | undefined;
  readonly heldIds: readonly string[] | undefined;
}

export interface Listed {
  readonly tasks: Parameters<typeof listedPullRequestOf>[1];
  readonly agents: Parameters<typeof listedPullRequestOf>[2];
}

export type Here =
  | ({
      readonly kind: typeof HERE.INBOX_ITEM;
      readonly taskId: string | undefined;
      readonly agentId: string | undefined;
    } & Holding)
  | ({
      readonly kind: typeof HERE.TASK;
      readonly taskId: string;
    } & Holding)
  | ({
      readonly kind: typeof HERE.AGENT;
      readonly agentId: string;
    } & Holding)
  | {
      readonly kind: typeof HERE.WINDOW;
      readonly opensPlaces: boolean;
      readonly listed: Listed | undefined;
    }
  | {
      readonly kind: typeof HERE.TASKS_TAB;
      readonly taskId: string | undefined;
    };

export const THING = {
  FILE: "file",
  PAGE: "page",
  CHANGES: "changes",
  TRANSCRIPT: "transcript",
  PULL_REQUEST: "pull-request",
  THREAD: "thread",
  WORKER: "worker",
  INBOX_ITEM: "inbox-item",
} as const;

export type Thing =
  | {
      readonly kind: typeof THING.FILE;
      readonly path: string;
      readonly lines: MentionLines | undefined;
      readonly repository?: string;
    }
  | {
      readonly kind: typeof THING.PAGE;
      readonly pageId: string;
      readonly place?: PagePlace;
    }
  | { readonly kind: typeof THING.CHANGES; readonly agentId: string }
  | {
      readonly kind: typeof THING.TRANSCRIPT;
      readonly agentId: string;
      readonly messageId?: string;
    }
  | {
      readonly kind: typeof THING.PULL_REQUEST;
      readonly agentId: string;
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
      readonly taskId: string | undefined;
      readonly agentId: string | undefined;
    };

export const ROUTE = {
  PREVIEW: "preview",
  GO: "go",
  OVERVIEW: "overview",
  EXTERNAL: "external",
  NOTHING: "nothing",
} as const;

export type Route =
  | { readonly kind: typeof ROUTE.PREVIEW; readonly thing: Thing }
  | { readonly kind: typeof ROUTE.GO; readonly link: ReadLink }
  | { readonly kind: typeof ROUTE.OVERVIEW; readonly place: OverviewPlace }
  | { readonly kind: typeof ROUTE.EXTERNAL; readonly href: string }
  | { readonly kind: typeof ROUTE.NOTHING };

export type OverviewPlace = Extract<
  LinkPlace,
  { readonly kind: typeof LINK_PLACE.TASK | typeof LINK_PLACE.SECTION | typeof LINK_PLACE.COMMENT }
>;

type InboxItemHere = Extract<Here, { readonly kind: typeof HERE.INBOX_ITEM }>;
type WindowHere = Extract<Here, { readonly kind: typeof HERE.WINDOW }>;
type TasksTabHere = Extract<Here, { readonly kind: typeof HERE.TASKS_TAB }>;
type AgentsHere = Extract<Here, { readonly kind: typeof HERE.TASK | typeof HERE.AGENT }>;

const NOTHING: Route = { kind: ROUTE.NOTHING };

function preview(thing: Thing): Route {
  return { kind: ROUTE.PREVIEW, thing };
}

function go(link: ReadLink): Route {
  return { kind: ROUTE.GO, link };
}

function openedBy(holding: Holding, owners?: readonly string[]): OpenedPullRequest[] {
  return [...holding.pullRequests].flatMap(([agentId, { url }]) =>
    owners === undefined || owners.includes(agentId) ? [{ agentId, url }] : [],
  );
}

function ofRepository(named: string, repository: string | null | undefined): boolean {
  return (
    repository !== null &&
    repository !== undefined &&
    named.toLowerCase() === repository.toLowerCase()
  );
}

function holdsAgent(
  at: { readonly planId?: string | undefined; readonly agentId: string },
  taskId: string | undefined,
  agentIds: readonly string[] | undefined,
): boolean {
  return at.planId === undefined ? agentIds?.includes(at.agentId) === true : at.planId === taskId;
}

function itemOfInbox(
  at: Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.INBOX_ITEM }>,
  here: InboxItemHere,
): Route {
  const { itemId } = at;
  if ("planId" in at) {
    return preview({ kind: THING.INBOX_ITEM, itemId, taskId: at.planId, agentId: undefined });
  }
  if (!("agentId" in at)) return NOTHING;
  const { agentId } = at;
  if (here.taskId !== undefined) {
    return (here.heldIds ?? here.agentIds)?.includes(agentId) === true
      ? preview({ kind: THING.INBOX_ITEM, itemId, taskId: here.taskId, agentId })
      : NOTHING;
  }
  return agentId === here.agentId
    ? preview({ kind: THING.INBOX_ITEM, itemId, taskId: undefined, agentId })
    : NOTHING;
}

function itemPlace(link: ReadLink, here: InboxItemHere): Route {
  const at = link.place;
  switch (at.kind) {
    case LINK_PLACE.PAGE: {
      if (taskNumberOf(at) !== undefined) return NOTHING;
      const own =
        "planId" in at
          ? at.planId === here.taskId
          : here.agentId !== undefined && at.agentId === here.agentId;
      const place: PagePlace = "planId" in at ? { taskId: at.planId } : { agentId: at.agentId };
      return preview(
        own
          ? { kind: THING.PAGE, pageId: at.pageId }
          : { kind: THING.PAGE, pageId: at.pageId, place },
      );
    }
    case LINK_PLACE.CHANGES:
      return holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
        ? preview({ kind: THING.CHANGES, agentId: at.agentId })
        : NOTHING;
    case LINK_PLACE.PULL_REQUEST_THREAD:
      return holdsAgent(at, here.taskId, here.heldIds ?? here.agentIds)
        ? preview({
            kind: THING.THREAD,
            agentId: at.agentId,
            threadId: at.threadId,
            view: at.view,
          })
        : NOTHING;
    case LINK_PLACE.MESSAGE:
      return here.taskId !== undefined &&
        holdsAgent(at, here.taskId, here.agentIds) &&
        here.agentIds?.includes(at.agentId) === true
        ? preview({ kind: THING.TRANSCRIPT, agentId: at.agentId, messageId: at.messageId })
        : NOTHING;
    case LINK_PLACE.INBOX_ITEM:
      return itemOfInbox(at, here);
    case LINK_PLACE.AGENT: {
      if (here.taskId === undefined || !holdsAgent(at, here.taskId, here.agentIds)) return NOTHING;
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

function pullRequestBeside(
  address: Extract<Address, { readonly kind: typeof ADDRESS.PULL_REQUEST }>,
  here: Holding,
): Route {
  const opened = openedBy(here, here.heldIds ?? here.agentIds);
  const agentId = pullRequestAgentOf(address.href, opened);
  if (agentId !== undefined) return preview({ kind: THING.PULL_REQUEST, agentId });
  if (!ofRepository(address.repository, here.repository)) return NOTHING;
  const owner = opened.find(
    (each) => repositoryPullRequestOf(each.url, here.repository) === address.number,
  );
  if (owner !== undefined) return preview({ kind: THING.PULL_REQUEST, agentId: owner.agentId });
  const first = here.agentIds?.[0];
  return first === undefined
    ? NOTHING
    : preview({ kind: THING.PULL_REQUEST, agentId: first, number: address.number });
}

function besideItem(address: Address, here: InboxItemHere): Route {
  if (here.taskId === undefined && here.agentId === undefined) return NOTHING;
  switch (address.kind) {
    case ADDRESS.PLACE:
      return itemPlace(address.link, here);
    case ADDRESS.PULL_REQUEST:
      return pullRequestBeside(address, here);
    case ADDRESS.FILE: {
      const { path, lines, repository } = address;
      if (repository === undefined) {
        return here.repository !== null && here.repository !== undefined
          ? preview({ kind: THING.FILE, path, lines })
          : NOTHING;
      }
      return ofRepository(repository, here.repository)
        ? preview({ kind: THING.FILE, path, lines })
        : preview({ kind: THING.FILE, path, lines, repository });
    }
    case ADDRESS.WEB:
      return NOTHING;
  }
}

function pageBeside(at: LinkPlace, here: AgentsHere): Route {
  if (at.kind !== LINK_PLACE.PAGE || taskNumberOf(at) !== undefined) return NOTHING;
  const place: PagePlace = "planId" in at ? { taskId: at.planId } : { agentId: at.agentId };
  const own =
    here.kind === HERE.TASK
      ? "planId" in at && at.planId === here.taskId
      : "agentId" in at && at.agentId === here.agentId;
  return own ? NOTHING : preview({ kind: THING.PAGE, pageId: at.pageId, place });
}

function besideAgents(address: Address, here: AgentsHere): Route {
  if (address.kind === ADDRESS.PLACE) return pageBeside(address.link.place, here);
  return address.kind === ADDRESS.PULL_REQUEST ? pullRequestBeside(address, here) : NOTHING;
}

function external(address: Address): Route {
  return address.href === undefined ? NOTHING : { kind: ROUTE.EXTERNAL, href: address.href };
}

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

function overviewPlaceOf(place: LinkPlace): place is OverviewPlace {
  return (
    place.kind === LINK_PLACE.TASK ||
    place.kind === LINK_PLACE.SECTION ||
    place.kind === LINK_PLACE.COMMENT
  );
}

function onTasksTab(address: Address, here: TasksTabHere): Route {
  if (address.kind !== ADDRESS.PLACE) return NOTHING;
  const { place } = address.link;
  const standing = here.taskId !== undefined && "planId" in place && place.planId === here.taskId;
  if (!standing) return go(address.link);
  if (overviewPlaceOf(place)) return { kind: ROUTE.OVERVIEW, place };
  const thing = taskThingOf(place);
  return thing === undefined ? go(address.link) : preview(thing);
}

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
