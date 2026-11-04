import {
  type BrowserTabsPlace,
  browserTabsPlaceId,
  browserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import type { AgentInboxScope } from "@repo/features/agent-view";
import { AUTOMATION_FOLLOW, type AutomationFollow } from "@repo/features/automation-view";
import type { IntegrationProviderParams } from "@repo/features/integration-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER, type PageLine, type PagePlace } from "@repo/features/page-wire";
import type { PullRequestChaptersReadParams } from "@repo/features/pull-request-chapters-view";
import { COMMENT_SUBJECT, type TasksCommentsFollow } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppHostReads,
  type AppStateSnapshot,
  HOST_READ_SLICE,
  KEYS_ON,
  READ_KEYS,
} from "@repo/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect } from "react";
import { askAct, tellAct } from "./act.js";
import { streamFrom } from "./act-stream.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * use-host-read.ts -- the one way a surface reads server data: a read the host holds for the panel, drawn from app state, with where it stands and Try again.
 *
 * The host follows each read for as long as its lifetime holds it
 * (`@repo/host`'s `live-collection.ts`) and lays its rows in the app-state
 * slice named for it (`LIVE_READ`), which outlives every page, so a surface
 * drawn again draws its rows in its first frame, before anything is pushed.
 * A read is loading until it first answers, failed where it said it could
 * not answer before it ever had, and ready from its first rows on: one that
 * holds rows never says loading again. A keyed read, a plan's or an agent's
 * own inbox, a task's or an agent's pages or cloud Browser tabs, a
 * workspace's automations or runs, an automation's runs, or a workspace's
 * people, is held by the
 * surface that reads it: the host follows it while any surface holds it and a while
 * after, so a holder chosen again, or a surface drawn again, draws from
 * where its read stands. Each read is one entry of `HOST_READS`, which the
 * one hook path reads, so a read added is an entry rather than a hook.
 * Nothing else in the panel opens a follow
 * (`anti-slop/no-follow-outside-host-read`).
 */

export const HOST_READ_STATUS = {
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
} as const;

export type HostReadStatus = (typeof HOST_READ_STATUS)[keyof typeof HOST_READ_STATUS];

/** A read as a surface draws it: its rows once it answered, and where it stands. */
export interface HeldRead<Rows> {
  readonly rows: Rows | undefined;
  readonly status: HostReadStatus;
}

/** A read a surface offers Try again on, as well. */
export interface HostRead<Rows> extends HeldRead<Rows> {
  readonly retry: () => void;
}

/** The holder whose own inbox a surface reads: a plan, or an agent, by its id. */
export type InboxHolderKey = AgentInboxScope;

/** Whose comments a surface reads: a task's plan's own, or one of its pages', by the task and the page. */
export type CommentSubject = TasksCommentsFollow;

/** The comments a surface holds, as the act names them, with no page key where it reads the plan's. */
function commentsFollowOf({ taskId, pageId }: CommentSubject): TasksCommentsFollow {
  return pageId === undefined ? { taskId } : { taskId, pageId };
}

/** The integration server whose tools a surface reads: its provider, and its account where the server is not the provider's own. */
export type IntegrationServer = Pick<IntegrationProviderParams, "provider" | "connection">;

/** A read the host holds for the panel, by its name (`AppHostReads`). */
type HostReadName = keyof AppHostReads;

/** Where a read stands, from what the host holds of it. */
function statusOf(held: AppHostRead<unknown> | undefined): HostReadStatus {
  if (held?.rows !== undefined) return HOST_READ_STATUS.READY;
  return held?.failed === true ? HOST_READ_STATUS.FAILED : HOST_READ_STATUS.LOADING;
}

/** How deep a key of `read` stands in its slice: not at all for a read whose slice is one read, as the feed's is, else one segment per id its slice is keyed by (`HOST_READ_SLICE`). */
function depthOf(read: HostReadName): number {
  const slice = HOST_READ_SLICE[read];
  if (slice.on === KEYS_ON.ROWS) return 0;
  return slice.keys === READ_KEYS.TWO ? 2 : 1;
}

/** What `value` holds at `path`, record by record; none where it holds none. */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let at = value;
  for (const segment of path) {
    at =
      typeof at === "object" && at !== null && Object.hasOwn(at, segment)
        ? Reflect.get(at, segment)
        : undefined;
  }
  return at;
}

/**
 * The atom of what `slice` holds at each path `depth` segments long, by one
 * `Atom.family` per segment, so a path asked for again is the very atom and
 * its readers are told only as what it holds moves. Note that each family is
 * keyed by a string, since an object key need not compare equal.
 */
function atomsAt(
  slice: Atom.Atom<unknown>,
  depth: number,
  prefix: readonly string[] = [],
): (path: readonly string[]) => Atom.Atom<unknown> {
  if (depth === 0) {
    const leaf = prefix.length === 0 ? slice : Atom.map(slice, (held) => valueAt(held, prefix));
    return () => leaf;
  }
  const below = Atom.family((segment: string) => atomsAt(slice, depth - 1, [...prefix, segment]));
  return ([segment = "", ...rest]) => below(segment)(rest);
}

/** One read as `HOST_READS` holds it, by its name, the key a surface names it by, and its Try again. */
interface HostReadEntry<Read extends HostReadName, Key, Retry> {
  /** The read's slice whole, for a surface reading several of its keys at once. */
  readonly slice: Atom.Atom<AppStateSnapshot[Read] | undefined>;
  /** The read at a key's path in its slice, told to its readers only as that read moves. */
  readonly at: (path: readonly string[]) => Atom.Atom<AppHostRead<AppHostReads[Read]> | undefined>;
  /** The path `key` stands at in the read's slice; none for a read held for the session, which takes no key. */
  readonly path: ((key: Key) => readonly string[]) | undefined;
  /** The hold on `key`'s read, a stream on the act port that carries nothing and that the host keeps the read followed for; none for a read held for the session. */
  readonly hold:
    | ((key: Key) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>)
    | undefined;
  /** Try again on `key`'s read; none for a read the host reads again on its own. */
  readonly retry: Retry;
}

/**
 * One entry of `HOST_READS`: the read's slice atom, the path a key stands
 * at in it, the act that holds a key, and the act that reads it again, each
 * a closure of its own so each act is called with its own kind, and each
 * stated undefined where the read has none, so its type says so.
 */
function hostRead<
  Read extends HostReadName,
  Key = never,
  Retry extends ((key: Key) => void) | undefined = undefined,
>(
  read: Read,
  declared: {
    readonly slice: Atom.Atom<AppStateSnapshot[Read] | undefined>;
    readonly path: ((key: Key) => readonly string[]) | undefined;
    readonly hold:
      | ((key: Key) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>)
      | undefined;
    readonly retry: Retry;
  },
): HostReadEntry<Read, Key, Retry> {
  const at = atomsAt(declared.slice, depthOf(read));
  return {
    // SAFETY: what a read's slice holds at a key's whole path is that key's read (`HOST_READ_SLICE`).
    at: (path) => at(path) as Atom.Atom<AppHostRead<AppHostReads[Read]> | undefined>,
    slice: declared.slice,
    path: declared.path,
    hold: declared.hold,
    retry: declared.retry,
  };
}

/** The automations' hold on one list or history, a stream that carries nothing, and its Try again, by what it holds. */
function automationsRead(kind: AutomationFollow["kind"]) {
  return {
    path: (id: string) => [id],
    hold: (id: string) => askAct(ACT_KIND.AUTOMATIONS_FOLLOW, { kind, id }),
    retry: (id: string) => tellAct(ACT_KIND.AUTOMATIONS_RETRY, { kind, id }),
  };
}

/**
 * Every read a surface reads through `useHostRead`, by its name: the feed of
 * every item the account reaches, held for the session; one holder's own
 * inbox; one task's pages, or one agent's on no task, which the open task's
 * page, the panel beside an Inbox item, an agent's page, and a page's card
 * or frame each hold; one agent's pull request's chapters, by the number its
 * Pull request tab's own read of it found; one task's cloud Browser tabs,
 * every one of its agents', or one agent's, which a side panel listing them
 * holds; the account's devices' beats, by the account, which every surface
 * drawing a device's standing holds; one agent's own tools, which its
 * servers popover holds; one integration server's tools, by the account it
 * stands for, which a list of the servers holds; the account's provider
 * keys, by the account, which the window holds while signed in and
 * Settings › Agents draws; the outside MCP clients the account allowed, by
 * the account, which Settings › Integrations holds; one workspace's
 * automations, one workspace's runs, or one automation's runs, by its id;
 * one plan's comments, or one page's, which the open task's plan and a
 * page's tab each hold; the run that started one agent, which its page
 * holds; one workspace's people, its members and who its work names but
 * left, which every surface naming them holds; and one task's plan, which
 * the window's open task holds. Pages and Browser tabs offer no Try again,
 * because the host reads those that did not answer again on its own, and
 * those it was refused, a plan's or an agent's the reader cannot reach,
 * stand failed until every surface lets them go and one holds them anew
 * (`@repo/host`'s `live-push.ts`). The beats, which the host asks for again
 * every `MAC_PRESENCE.POLL_MS` while they are held (`held-fetch.ts`), offer
 * theirs to the window coming back online (`device-presence.ts`), never to
 * a press.
 */
const HOST_READS = {
  [LIVE_READ.AGENT_ORIGINS]: hostRead(LIVE_READ.AGENT_ORIGINS, {
    slice: APP_SLICE.AGENT_ORIGINS,
    path: (agentId: string) => [agentId],
    hold: (agentId) => askAct(ACT_KIND.AGENTS_ORIGIN_FOLLOW, { agentId }),
    retry: (agentId) => tellAct(ACT_KIND.AGENTS_ORIGIN_RETRY, { agentId }),
  }),
  [LIVE_READ.INBOX_ITEMS]: hostRead(LIVE_READ.INBOX_ITEMS, {
    slice: APP_SLICE.INBOX_ITEMS,
    path: undefined,
    hold: undefined,
    retry: () => tellAct(ACT_KIND.AGENTS_INBOX_ITEMS_RETRY),
  }),
  [LIVE_READ.HOLDER_INBOX]: hostRead(LIVE_READ.HOLDER_INBOX, {
    slice: APP_SLICE.HOLDER_INBOX,
    path: (key: InboxHolderKey) => [key.kind, key.id],
    hold: ({ kind, id }) => askAct(ACT_KIND.AGENTS_INBOX_FOLLOW, { kind, id }),
    retry: ({ kind, id }) => tellAct(ACT_KIND.AGENTS_INBOX_RETRY, { kind, id }),
  }),
  [LIVE_READ.INTEGRATION_TOOLS]: hostRead(LIVE_READ.INTEGRATION_TOOLS, {
    slice: APP_SLICE.INTEGRATION_TOOLS,
    path: (server: IntegrationServer) => [server.connection ?? server.provider],
    hold: (server) => askAct(ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW, server),
    retry: (server) => tellAct(ACT_KIND.INTEGRATIONS_TOOLS_RETRY, server),
  }),
  [LIVE_READ.PAGES]: hostRead(LIVE_READ.PAGES, {
    slice: APP_SLICE.PAGES,
    path: (place: PagePlace) =>
      "taskId" in place ? [PAGE_OWNER.TASK, place.taskId] : [PAGE_OWNER.AGENT, place.agentId],
    hold: (place) =>
      askAct(
        ACT_KIND.TASKS_PAGES_FOLLOW,
        "taskId" in place ? { taskId: place.taskId } : { agentId: place.agentId },
      ),
    retry: undefined,
  }),
  [LIVE_READ.PROVIDER_KEYS]: hostRead(LIVE_READ.PROVIDER_KEYS, {
    slice: APP_SLICE.PROVIDER_KEYS,
    path: (accountId: string) => [accountId],
    // Note that the host holds the keys of whoever is signed in, so neither act names an account.
    hold: () => askAct(ACT_KIND.PROVIDER_KEYS_FOLLOW),
    retry: () => tellAct(ACT_KIND.PROVIDER_KEYS_RETRY),
  }),
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: hostRead(LIVE_READ.PULL_REQUEST_CHAPTERS, {
    slice: APP_SLICE.PULL_REQUEST_CHAPTERS,
    path: (key: PullRequestChaptersReadParams) => [key.agentId, String(key.number)],
    hold: ({ agentId, number }) => askAct(ACT_KIND.CHAPTERS_FOLLOW, { agentId, number }),
    retry: ({ agentId, number }) => tellAct(ACT_KIND.CHAPTERS_RETRY, { agentId, number }),
  }),
  [LIVE_READ.BROWSER_TABS]: hostRead(LIVE_READ.BROWSER_TABS, {
    slice: APP_SLICE.BROWSER_TABS,
    path: (place: BrowserTabsPlace) => [browserTabsPlaceKind(place), browserTabsPlaceId(place)],
    hold: (place) =>
      askAct(
        ACT_KIND.TASKS_BROWSER_TABS_FOLLOW,
        "taskId" in place ? { taskId: place.taskId } : { agentId: place.agentId },
      ),
    retry: undefined,
  }),
  [LIVE_READ.DEVICE_PRESENCE]: hostRead(LIVE_READ.DEVICE_PRESENCE, {
    slice: APP_SLICE.DEVICE_PRESENCE,
    path: (accountId: string) => [accountId],
    // Note that the host holds the beats of whoever is signed in, so the hold and its asking again name no account.
    hold: () => askAct(ACT_KIND.HOSTS_PRESENCE_FOLLOW),
    retry: () => tellAct(ACT_KIND.HOSTS_PRESENCE_REFRESH),
  }),
  [LIVE_READ.WORKSPACE_MEMBERS]: hostRead(LIVE_READ.WORKSPACE_MEMBERS, {
    slice: APP_SLICE.WORKSPACE_MEMBERS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_MEMBERS_RETRY, { workspaceId }),
  }),
  [LIVE_READ.WORKSPACE_TOOLS]: hostRead(LIVE_READ.WORKSPACE_TOOLS, {
    slice: APP_SLICE.WORKSPACE_TOOLS,
    path: (agentId: string) => [agentId],
    hold: (agentId) => askAct(ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW, { agentId }),
    retry: (agentId) => tellAct(ACT_KIND.AGENTS_WORKSPACE_TOOLS_RETRY, { agentId }),
  }),
  [LIVE_READ.MCP_CLIENTS]: hostRead(LIVE_READ.MCP_CLIENTS, {
    slice: APP_SLICE.MCP_CLIENTS,
    path: (accountId: string) => [accountId],
    // Note that the host holds the clients of whoever is signed in, so the hold names no account.
    hold: () => askAct(ACT_KIND.MCP_CLIENTS_FOLLOW),
    retry: () => tellAct(ACT_KIND.MCP_CLIENTS_RETRY),
  }),
  [LIVE_READ.AUTOMATIONS]: hostRead(LIVE_READ.AUTOMATIONS, {
    slice: APP_SLICE.AUTOMATIONS,
    ...automationsRead(AUTOMATION_FOLLOW.WORKSPACE),
  }),
  [LIVE_READ.AUTOMATION_WORKSPACE_RUNS]: hostRead(LIVE_READ.AUTOMATION_WORKSPACE_RUNS, {
    slice: APP_SLICE.AUTOMATION_WORKSPACE_RUNS,
    ...automationsRead(AUTOMATION_FOLLOW.WORKSPACE_RUNS),
  }),
  [LIVE_READ.AUTOMATION_RUNS]: hostRead(LIVE_READ.AUTOMATION_RUNS, {
    slice: APP_SLICE.AUTOMATION_RUNS,
    ...automationsRead(AUTOMATION_FOLLOW.RUNS),
  }),
  [LIVE_READ.PLAN_COMMENTS]: hostRead(LIVE_READ.PLAN_COMMENTS, {
    slice: APP_SLICE.PLAN_COMMENTS,
    path: (subject: CommentSubject) =>
      subject.pageId === undefined
        ? [COMMENT_SUBJECT.PLAN, subject.taskId]
        : [COMMENT_SUBJECT.PAGE, subject.pageId],
    hold: (subject) => askAct(ACT_KIND.TASKS_COMMENTS_FOLLOW, commentsFollowOf(subject)),
    retry: (subject) => tellAct(ACT_KIND.TASKS_COMMENTS_RETRY, commentsFollowOf(subject)),
  }),
  [LIVE_READ.PLAN_DOCUMENT]: hostRead(LIVE_READ.PLAN_DOCUMENT, {
    slice: APP_SLICE.PLAN_DOCUMENT,
    path: (taskId: string) => [taskId],
    hold: (taskId) => askAct(ACT_KIND.TASKS_DOCUMENT_FOLLOW, { taskId }),
    retry: (taskId) => tellAct(ACT_KIND.TASKS_DOCUMENT_RETRY, { taskId }),
  }),
} as const satisfies { readonly [Read in HostReadName]: HostReadEntry<Read, never, unknown> };

type HostReads = typeof HOST_READS;

/** What a surface names one of `Read`'s keys by, none while it reads none; nothing for a read held for the session. */
type HostReadKey<Read extends HostReadName> =
  HostReads[Read] extends HostReadEntry<Read, infer Key, infer _Retry>
    ? [Key] extends [never]
      ? []
      : [key: Key | undefined]
    : never;

/** What a surface names one of `Read`'s keys by. */
type HostReadKeyOf<Read extends HostReadName> =
  HostReads[Read] extends HostReadEntry<Read, infer Key, infer _Retry> ? Key : never;

/** `Read` as a surface draws it: with Try again where its entry offers one. */
type HostReadOf<Read extends HostReadName> = HostReads[Read]["retry"] extends undefined
  ? HeldRead<AppHostReads[Read]>
  : HostRead<AppHostReads[Read]>;

/** No read, for a surface reading none. */
const NO_READ: Atom.Atom<AppHostRead<never> | undefined> = Atom.make(undefined);

/** The path of a read held for the session, which is its slice whole. */
const WHOLE_SLICE: readonly string[] = [];

/**
 * `read` as a surface draws it, held by this surface while `key` names one:
 * its slice atom at the key's path, one hold, and one Try again, the same
 * three hooks for every read, called in the same order on every render.
 * Note that the hold and Try again move with the key's path alone, never
 * with the object a surface named it by, which a render may build anew.
 */
export function useHostRead<Read extends HostReadName>(
  read: Read,
  ...[key]: HostReadKey<Read>
): HostReadOf<Read> {
  const entry = HOST_READS[read];
  // SAFETY: the key a surface hands is the one its read's entry takes (`HostReadKey`).
  const keyed = key as never;
  const path =
    entry.path === undefined ? WHOLE_SLICE : key === undefined ? undefined : entry.path(keyed);
  // Note that a key's path is at most two segments (`READ_KEYS`), so the effects below name a fixed number of them.
  const [first, second] = path ?? [];
  const held = useAppSlice<AppHostRead<unknown> | undefined>(
    path === undefined ? NO_READ : entry.at(path),
  );
  useEffect(() => {
    if (path === undefined || entry.hold === undefined) return;
    const hold = entry.hold;
    return streamFrom(
      () => hold(keyed),
      () => undefined,
    );
  }, [entry, first, second]);
  const retry = useCallback(() => {
    if (path !== undefined) entry.retry?.(keyed);
  }, [entry, first, second]);
  const drawn = { rows: held?.rows, status: statusOf(held) };
  // SAFETY: a read's rows are its entry's (`AppHostReads`), and Try again stands where its entry offers one (`HostReadOf`).
  return (entry.retry === undefined ? drawn : { ...drawn, retry }) as HostReadOf<Read>;
}

/**
 * What `read` holds at `key` as the host holds it now, without holding it:
 * what a surface beside the one that holds a read draws from it, as a
 * section's chip names a heading in a plan the window holds; none until it
 * is read, or where no surface holds it.
 */
export function useHeldRows<Read extends HostReadName>(
  read: Read,
  ...[key]: HostReadKey<Read>
): AppHostReads[Read] | undefined {
  const entry = HOST_READS[read];
  // SAFETY: the key a surface hands is the one its read's entry takes (`HostReadKey`).
  const path =
    entry.path === undefined
      ? WHOLE_SLICE
      : key === undefined
        ? undefined
        : entry.path(key as never);
  const held = useAppSlice<AppHostRead<unknown> | undefined>(
    path === undefined ? NO_READ : entry.at(path),
  );
  // SAFETY: a read's rows are its entry's (`AppHostReads`).
  return held?.rows as AppHostReads[Read] | undefined;
}

/** No slice, for a surface reading no key of a read. */
const NO_SLICE: Atom.Atom<undefined> = Atom.make(undefined);

/** Several keys of one read as a surface draws them: each key's read, and Try again on one. */
export interface HeldKeys<Key, Rows> {
  readonly readOf: (key: Key) => HeldRead<Rows>;
  readonly retry: (key: Key) => void;
}

/**
 * Each of `keys`' reads of `read`, held by this surface while it names them,
 * each on the read's entry of `HOST_READS` as `useHostRead` holds one: what a
 * surface drawing a list of them reads, a side panel's places' pages or each
 * connected server's tools. Note that the holds move with the keys' list,
 * which the caller hands as one array while it names the same keys.
 */
export function useHostReads<Read extends HostReadName>(
  read: Read,
  keys: readonly HostReadKeyOf<Read>[],
): HeldKeys<HostReadKeyOf<Read>, AppHostReads[Read]> {
  const entry = HOST_READS[read];
  const held = useAppSlice<unknown>(keys.length === 0 ? NO_SLICE : entry.slice);
  useEffect(() => {
    const hold = entry.hold;
    if (hold === undefined) return;
    const holds = keys.map((key) =>
      streamFrom(
        // SAFETY: each key a surface hands is the one its read's entry takes (`HostReadKeyOf`).
        () => hold(key as never),
        () => undefined,
      ),
    );
    return () => {
      for (const release of holds) release();
    };
  }, [entry, keys]);
  const readOf = useCallback(
    (key: HostReadKeyOf<Read>) => {
      // SAFETY: the key a surface hands is the one its read's entry takes (`HostReadKeyOf`).
      const path = entry.path?.(key as never);
      // SAFETY: what a read's slice holds at a key's whole path is that key's read (`HOST_READ_SLICE`).
      const at = (path === undefined ? undefined : valueAt(held, path)) as
        | AppHostRead<AppHostReads[Read]>
        | undefined;
      return { rows: at?.rows, status: statusOf(at) };
    },
    [entry, held],
  );
  const retry = useCallback(
    // SAFETY: the key a surface hands is the one its read's entry takes (`HostReadKeyOf`).
    (key: HostReadKeyOf<Read>) => entry.retry?.(key as never),
    [entry],
  );
  return { readOf, retry };
}

/**
 * The pages of each place given, a task's or an agent's on no task, held by
 * this surface while it names them: what a side panel reads of the places
 * its page tabs stand on beside the one it stands for. Answers each place's
 * pages, none until they are read.
 */
export function usePlacesPages(
  places: readonly PagePlace[],
): (place: PagePlace) => readonly PageLine[] | undefined {
  const { readOf } = useHostReads(LIVE_READ.PAGES, places);
  return useCallback((place) => readOf(place).rows, [readOf]);
}
