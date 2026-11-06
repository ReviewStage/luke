/**
 * live-reads.ts -- the live reads the host holds for the panel, each a TanStack Query query: its `queryOptions` factory, its Try again, and the one subscription that keeps every one current and followed.
 *
 * The host follows each read for as long as the panel holds it
 * (`@repo/host`'s `live-collection.ts`) and lays its rows in the app-state
 * document, in the slice named for the read (`LIVE_READ`), at the read's
 * path of ids. Each read here is a query over that slice:
 *
 * - **Its key** is the read's `LIVE_READ` name and then the ids its slice is
 *   keyed by, each an element of its own and in the slice's order
 *   (`[LIVE_READ.MODELS, accountId]`), as `query-keys.ts` asks; the ids are
 *   the read's path in its slice. An id is a string, or a number where the
 *   read names one by number, as a pull request's (`[LIVE_READ.PULL_REQUEST,
 *   agentId, 42]`); its slice holds it at the id's string, so a read keyed
 *   by a number declares the ids its path stands for (`LIVE_KEY_IDS`), and
 *   a read keyed by strings alone declares nothing. A factory handed no ids, as a surface
 *   that draws nothing names none, answers the read's name alone, disabled
 *   (`enabled: false`), as the docs' Dependent Queries guide has it.
 * - **Its data** is the read's rows. Its `queryFn` answers the rows the
 *   document holds at the read's path, waiting for the first push that lays
 *   some where it holds none yet, and every push writes the rows of every
 *   read the document holds into that read's query with `setQueryData`
 *   (`useLiveReadSubscription`), as the docs' guide to data pushed over a
 *   socket does, so a surface mounted after they landed draws them in its
 *   first frame, and the query is never stale (`staleTime: Infinity`) and
 *   never read again. A read the host could not answer before it ever had
 *   is the query's error (`LiveReadFailed`); one that holds rows keeps them
 *   whatever it says after, and one whose rows the document drops, as a
 *   sign-out drops them, is reset to pending (`resetQueries`).
 * - **Its follow**, the `*_FOLLOW` act a read the panel holds is followed by,
 *   stays open on the act port exactly while the query is active (the
 *   query's own `isActive()`: it has an observer that is not disabled), one
 *   stream however many surfaces observe it. The subscription hears that
 *   from the query cache's `observerAdded`, `observerRemoved`, and
 *   `observerOptionsUpdated` events (`QueryCache.subscribe`), so a surface
 *   reads a live read with `useQuery(factory(ids))` and nothing beside it. A
 *   read the host holds for the session takes no follow (`LIVE_FOLLOWS`). A
 *   read whose follow needs more than its key's ids carries it on the
 *   query's `meta`, the docs' place for what a query carries beside its key,
 *   which its follow decodes (a page's comments name their task there).
 * - **Its Try again** is `useMutation` over the read's `*_RETRY` act, one
 *   `mutationOptions` factory per read beside its query's. The host lays the
 *   read unread as it asks again, and the subscription resets a failed
 *   query whose read stands failed no more (`resetQueries`), so it draws
 *   pending until the next answer lands.
 * - **Several keys of one read** are `useQueries` over the factory; a read
 *   drawn without holding it is `useQuery` with `enabled: false`, which
 *   holds nothing, or `getQueryData` in a callback.
 *
 * A read moved here leaves `use-host-read.ts`'s `HOST_READS`: its factory, its
 * Try again, and its follow are added below, and nothing else. This module,
 * and `use-host-read.ts` until its reads are all moved, are the only ones
 * that open a follow (`anti-slop/no-follow-outside-host-read`).
 */

import {
  BROWSER_TABS_PLACE,
  type BrowserTabsPlace,
  browserTabsPlaceId,
  browserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import {
  type AgentInboxScope,
  type AgentPullRequestReadParams,
  type AgentTranscriptKey,
  agentInboxScopeSchema,
  PULL_REQUEST_PART,
  type PullRequestPart,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import type { IntegrationProviderParams } from "@repo/features/integration-view";
import { integrationConnectionOf } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PAGE_OWNER, type PagePlace } from "@repo/features/page-wire";
import type { PullRequestChaptersReadParams } from "@repo/features/pull-request-chapters-view";
import {
  COMMENT_SUBJECT,
  type TasksCommentsFollow,
  type TasksLinkStandingParams,
  tasksCommentsFollowSchema,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppHostReads,
  type AppStateSnapshot,
  EVERY_WORKSPACE,
  HOST_READ_SLICE,
  KEYS_ON,
  OWN_PULL_REQUEST,
  OWN_TRANSCRIPT,
  READ_KEYS,
} from "@repo/host/app-state";
import { type Query, type QueryClient, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { useEffect } from "react";
import { askAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { streamFrom } from "./act-stream.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise } from "./renderer-runtime.js";
import { appStateQuery } from "./use-app-state.js";

/** A live read, by its name. */
type LiveReadName = keyof AppHostReads;

/** One id of a live read's key: a string, or a number where the read names one by number. */
type LiveReadId = string | number;

/** A live read's query key: its name, then its ids in its slice's order; its name alone where a surface names no ids. */
type LiveReadKey<Read extends LiveReadName> = readonly [Read, ...LiveReadId[]];

/** The read a live read's query stands for: the host could not answer it before it ever had. */
export class LiveReadFailed extends Error {
  constructor(readonly read: LiveReadName) {
    super(`The host could not read ${read}.`);
    this.name = "LiveReadFailed";
  }
}

/** The holder whose own inbox a surface reads: a plan, or an agent, by its id. */
type InboxHolderKey = AgentInboxScope;

/** The link whose standing a chip reads: the workspace it is read through, and the link's own address. */
type LinkStandingKey = TasksLinkStandingParams;

/** The holder a holder inbox's ids name, as its follow takes it; its key is built from one (`holderInboxQuery`), so it always reads. */
const readHolder = Schema.decodeUnknownSync(agentInboxScopeSchema);

/** A follow, a stream on the act port that carries nothing and that the host keeps the read followed for, by the read's ids and what its query carries on `meta`. */
type LiveFollow = (
  ids: readonly LiveReadId[],
  meta: Readonly<Record<string, unknown>> | undefined,
) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>;

/** Whose comments a surface reads: a task's plan's own, or one of its pages', by the task and the page. */
export type CommentSubject = TasksCommentsFollow;

/** The comments a follow holds, as its query carries them on `meta`; its factory puts one there (`planCommentsQuery`), so it always reads. */
const readCommentSubject = Schema.decodeUnknownSync(tasksCommentsFollowSchema);

/** The pull request a key of one of its parts names: the agent, and its number where the key names one rather than the agent's own. */
function pullRequestAskedOf([agentId, number]: readonly LiveReadId[]): AgentPullRequestReadParams {
  return typeof number === "number"
    ? { agentId: String(agentId), number }
    : { agentId: String(agentId) };
}

/** The follow of one part of a pull request, by the part. */
function pullRequestPartFollow(part: PullRequestPart): LiveFollow {
  return (ids) =>
    askAct(ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW, { part, ...pullRequestAskedOf(ids) });
}

/** The integration server whose tools a surface reads: its provider, and its account where the server is not the provider's own. */
export type IntegrationServer = Pick<IntegrationProviderParams, "provider" | "connection">;

/** The server a connection's name stands for, as its tools read is held and tried again; none for a name this build cannot read. */
export function integrationServerOf(name: string): IntegrationServer | undefined {
  const provider = integrationConnectionOf(name)?.provider;
  if (provider === undefined) return undefined;
  return name === provider ? { provider } : { provider, connection: name };
}

/** A repository list's scope as its acts name it: its workspace, or nothing for every one (`EVERY_WORKSPACE`). */
export function repositoryScope(workspace: string): { readonly workspaceId?: string } {
  return workspace === EVERY_WORKSPACE ? {} : { workspaceId: workspace };
}

/** The follow of an integration server's tools, by its connection's name; none for a name this build cannot read, which the host holds no read under. */
function integrationToolsFollow(name: string): ReturnType<LiveFollow> {
  const server = integrationServerOf(name);
  return server === undefined
    ? Promise.reject(new Error(`No integration server is named ${name}.`))
    : askAct(ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW, server);
}

/**
 * The follow of each live read moved here that the panel holds, by the ids
 * its key names, as many as its slice is keyed by (`liveReadOf`). Note that
 * the host holds the account reads of whoever is signed in, so none of their
 * follows names the account its key does; the account preferences, This
 * Mac's host, and the workspaces' photos the host holds for the session, so
 * they take none.
 */
const LIVE_FOLLOWS: { readonly [Read in LiveReadName]?: LiveFollow } = {
  [LIVE_READ.MODELS]: () => askAct(ACT_KIND.AGENTS_MODELS_FOLLOW),
  [LIVE_READ.PROVIDER_KEYS]: () => askAct(ACT_KIND.PROVIDER_KEYS_FOLLOW),
  [LIVE_READ.GITHUB_TOKEN]: () => askAct(ACT_KIND.GITHUB_TOKEN_FOLLOW),
  [LIVE_READ.DEVICE_PRESENCE]: () => askAct(ACT_KIND.HOSTS_PRESENCE_FOLLOW),
  [LIVE_READ.HOSTS]: () => askAct(ACT_KIND.HOSTS_FOLLOW),
  [LIVE_READ.AGENT_ORIGINS]: ([agentId = ""]) =>
    askAct(ACT_KIND.AGENTS_ORIGIN_FOLLOW, { agentId: String(agentId) }),
  [LIVE_READ.HOLDER_INBOX]: ([kind, id]) =>
    askAct(ACT_KIND.AGENTS_INBOX_FOLLOW, readHolder({ kind, id })),
  [LIVE_READ.LINK_STANDINGS]: ([workspaceId = "", address = ""]) =>
    askAct(ACT_KIND.TASKS_LINK_STANDING_FOLLOW, {
      workspaceId: String(workspaceId),
      address: String(address),
    }),
  [LIVE_READ.PAGES]: ([owner, id = ""]) =>
    askAct(
      ACT_KIND.TASKS_PAGES_FOLLOW,
      owner === PAGE_OWNER.TASK ? { taskId: String(id) } : { agentId: String(id) },
    ),
  [LIVE_READ.BROWSER_TABS]: ([kind, id = ""]) =>
    askAct(
      ACT_KIND.TASKS_BROWSER_TABS_FOLLOW,
      kind === BROWSER_TABS_PLACE.TASK ? { taskId: String(id) } : { agentId: String(id) },
    ),
  [LIVE_READ.PLAN_DOCUMENT]: ([taskId = ""]) =>
    askAct(ACT_KIND.TASKS_DOCUMENT_FOLLOW, { taskId: String(taskId) }),
  [LIVE_READ.PLAN_COMMENTS]: (_ids, meta) =>
    askAct(ACT_KIND.TASKS_COMMENTS_FOLLOW, readCommentSubject(meta?.follow)),
  [LIVE_READ.PULL_REQUEST]: pullRequestPartFollow(PULL_REQUEST_PART.PULL_REQUEST),
  [LIVE_READ.PULL_REQUEST_CHECKS]: pullRequestPartFollow(PULL_REQUEST_PART.CHECKS),
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: pullRequestPartFollow(PULL_REQUEST_PART.CONVERSATION),
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: pullRequestPartFollow(PULL_REQUEST_PART.PUBLISHED),
  [LIVE_READ.PULL_REQUEST_VIEWED]: pullRequestPartFollow(PULL_REQUEST_PART.VIEWED),
  [LIVE_READ.REVIEW_OPTIONS]: pullRequestPartFollow(PULL_REQUEST_PART.REVIEW_OPTIONS),
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: ([agentId, number]) =>
    askAct(ACT_KIND.CHAPTERS_FOLLOW, { agentId: String(agentId), number: Number(number) }),
  [LIVE_READ.TRANSCRIPT]: ([agentId = "", callId]) =>
    askAct(
      ACT_KIND.AGENTS_TRANSCRIPT,
      transcriptOf(String(agentId), callId === undefined ? undefined : String(callId)),
    ),
  [LIVE_READ.HISTORY]: ([taskId = ""]) =>
    askAct(ACT_KIND.TASKS_HISTORY_FOLLOW, { taskId: String(taskId) }),
  [LIVE_READ.INSTALLED_SKILLS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.INSTALLED_SKILLS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.INTEGRATIONS]: () => askAct(ACT_KIND.INTEGRATIONS_FOLLOW),
  [LIVE_READ.INTEGRATION_TOOLS]: ([name = ""]) => integrationToolsFollow(String(name)),
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.WORKSPACE_TOOLS]: ([agentId = ""]) =>
    askAct(ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW, { agentId: String(agentId) }),
  [LIVE_READ.MCP_CLIENTS]: () => askAct(ACT_KIND.MCP_CLIENTS_FOLLOW),
  [LIVE_READ.MEMORIES]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.MEMORIES_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.REPOSITORY_LISTS]: ([workspace = ""]) =>
    askAct(ACT_KIND.TASKS_REPOSITORIES_FOLLOW, repositoryScope(String(workspace))),
  [LIVE_READ.SLACK_CHANNELS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.TOKEN_REPOSITORIES]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.WORKSPACE_MEMBERS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, { workspaceId: String(workspaceId) }),
  [LIVE_READ.WORKSPACE_INVITATIONS]: ([workspaceId = ""]) =>
    askAct(ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW, { workspaceId: String(workspaceId) }),
};

/** A pull request part's ids from its path: the agent, then the number, or `OWN_PULL_REQUEST` for the agent's own. */
function pullRequestPartIds([agentId = "", number = ""]: readonly string[]): readonly LiveReadId[] {
  return [agentId, number === OWN_PULL_REQUEST ? OWN_PULL_REQUEST : Number(number)];
}

/**
 * The ids each live read keyed by a number stands for, from its path in its
 * slice, whose every segment is a string; a read keyed by strings alone
 * declares none, its path being its ids.
 */
const LIVE_KEY_IDS: {
  readonly [Read in LiveReadName]?: (path: readonly string[]) => readonly LiveReadId[];
} = {
  [LIVE_READ.PULL_REQUEST]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_CHECKS]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_CONVERSATION]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_PUBLISHED]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_VIEWED]: pullRequestPartIds,
  [LIVE_READ.REVIEW_OPTIONS]: pullRequestPartIds,
  [LIVE_READ.PULL_REQUEST_CHAPTERS]: ([agentId = "", number = ""]) => [agentId, Number(number)],
};

/** The transcript a transcript's ids name: the agent's own, or its worker's by the call that started it. */
function transcriptOf(agentId: string, callId: string | undefined): AgentTranscriptKey {
  const kind = TRANSCRIPT_KIND.AGENT;
  return callId === undefined || callId === OWN_TRANSCRIPT
    ? { kind, agentId }
    : { kind, agentId, callId };
}

/** Every live read moved here, by its name, which `use-host-read.ts` reads no more. */
const LIVE_QUERY_READS = [
  LIVE_READ.ACCOUNT_PREFERENCES,
  LIVE_READ.MODELS,
  LIVE_READ.PROVIDER_KEYS,
  LIVE_READ.GITHUB_TOKEN,
  LIVE_READ.DEVICE_PRESENCE,
  LIVE_READ.HOSTS,
  LIVE_READ.THIS_MAC_HOST,
  LIVE_READ.AGENT_ORIGINS,
  LIVE_READ.INBOX_ITEMS,
  LIVE_READ.HOLDER_INBOX,
  LIVE_READ.LINK_STANDINGS,
  LIVE_READ.PAGES,
  LIVE_READ.BROWSER_TABS,
  LIVE_READ.PLAN_DOCUMENT,
  LIVE_READ.PLAN_COMMENTS,
  LIVE_READ.PULL_REQUEST,
  LIVE_READ.PULL_REQUEST_CHECKS,
  LIVE_READ.PULL_REQUEST_CONVERSATION,
  LIVE_READ.PULL_REQUEST_PUBLISHED,
  LIVE_READ.PULL_REQUEST_VIEWED,
  LIVE_READ.REVIEW_OPTIONS,
  LIVE_READ.PULL_REQUEST_CHAPTERS,
  LIVE_READ.TRANSCRIPT,
  LIVE_READ.HISTORY,
  LIVE_READ.INSTALLED_SKILLS,
  LIVE_READ.INTEGRATIONS,
  LIVE_READ.INTEGRATION_TOOLS,
  LIVE_READ.WORKSPACE_INTEGRATIONS,
  LIVE_READ.WORKSPACE_TOOLS,
  LIVE_READ.MCP_CLIENTS,
  LIVE_READ.MEMORIES,
  LIVE_READ.REPOSITORY_LISTS,
  LIVE_READ.SLACK_CHANNELS,
  LIVE_READ.TOKEN_REPOSITORIES,
  LIVE_READ.WORKSPACE_MEMBERS,
  LIVE_READ.WORKSPACE_INVITATIONS,
  LIVE_READ.WORKSPACE_PHOTOS,
] as const satisfies readonly LiveReadName[];

/** A live read moved here, by its name. */
export type LiveQueryRead = (typeof LIVE_QUERY_READS)[number];

/** What tells a live read's query from any other: its key's first element is one of these. */
const MOVED: ReadonlySet<string> = new Set<LiveReadName>(LIVE_QUERY_READS);

/** How many ids a key of `read` names: none for a read whose slice is one read, as the feed's is, else one per id its slice is keyed by (`HOST_READ_SLICE`). */
function depthOf(read: LiveReadName): number {
  const slice = HOST_READ_SLICE[read];
  if (slice.on === KEYS_ON.ROWS) return 0;
  return slice.keys === READ_KEYS.TWO ? 2 : 1;
}

/** The key ids a read's path in its slice stands for (`LIVE_KEY_IDS`). */
function idsOf(read: LiveReadName, path: readonly string[]): readonly LiveReadId[] {
  return LIVE_KEY_IDS[read]?.(path) ?? path;
}

/** Every read `held` holds `depth` segments deep, each with its path. */
function readsIn(
  held: unknown,
  depth: number,
  ids: readonly string[] = [],
): readonly { readonly ids: readonly string[]; readonly held: unknown }[] {
  if (depth === 0) return held === undefined ? [] : [{ ids, held }];
  if (typeof held !== "object" || held === null) return [];
  return Object.entries(held).flatMap(([id, below]) => readsIn(below, depth - 1, [...ids, id]));
}

/** Whether `id` can be an id of a live read's key. */
function isLiveReadId(id: unknown): id is LiveReadId {
  return typeof id === "string" || typeof id === "number";
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

/** What the document holds of `read` at `ids`; none before the first read, or where it holds nothing there. */
function heldAt<Read extends LiveReadName>(
  document: AppStateSnapshot | undefined,
  read: Read,
  ids: readonly LiveReadId[],
): AppHostRead<AppHostReads[Read]> | undefined {
  // SAFETY: what a read's slice holds at its whole path of ids is that read (`@repo/host`'s `HOST_READ_SLICE`).
  return valueAt(document?.[read], ids.map(String)) as AppHostRead<AppHostReads[Read]> | undefined;
}

/** Whether `query` is the app-state document's. */
function isAppState(query: Query): boolean {
  return query.queryKey[0] === QUERY_ROOT.APP_STATE;
}

/** The live read `query` stands for and its ids, where it is one moved here and names every id its slice is keyed by. */
function liveReadOf(
  query: Query,
): { readonly read: LiveReadName; readonly ids: readonly LiveReadId[] } | undefined {
  const [name, ...ids] = query.queryKey;
  if (typeof name !== "string" || !MOVED.has(name)) return undefined;
  // SAFETY: `MOVED` holds live read names alone.
  const read = name as LiveReadName;
  if (ids.length !== depthOf(read)) return undefined;
  if (!ids.every(isLiveReadId)) return undefined;
  return { read, ids };
}

/**
 * The rows the document holds of `read` at `ids` once it holds some: at once
 * where it does, else on the first write of the document that lays them,
 * heard on the client's query cache. Fails where the read stands failed
 * with no rows. Note that the cache is let go as it answers, since a
 * callback's own cleanup runs only on an interruption.
 */
function firstAnswer<Read extends LiveReadName>(
  client: QueryClient,
  read: Read,
  ids: readonly LiveReadId[],
): Effect.Effect<AppHostReads[Read], LiveReadFailed> {
  return Effect.callback<AppHostReads[Read], LiveReadFailed>((resume) => {
    let stop: (() => void) | undefined;
    let answered = false;
    const settle = (): void => {
      const held = heldAt(client.getQueryData(appStateQuery.queryKey), read, ids);
      if (answered || (held?.rows === undefined && held?.failed !== true)) return;
      answered = true;
      stop?.();
      resume(
        held.rows === undefined ? Effect.fail(new LiveReadFailed(read)) : Effect.succeed(held.rows),
      );
    };
    settle();
    if (answered) return;
    stop = client.getQueryCache().subscribe((event) => {
      if (isAppState(event.query)) settle();
    });
    return Effect.sync(() => stop?.());
  });
}

/**
 * The query of `read` at `ids`: its rows, read from the document and kept
 * current from it, by the read's name and ids; disabled under its name alone
 * where `ids` is none. Note that the `queryFn` takes the signal, so a read
 * every observer let go before it answered is canceled rather than left
 * waiting, and that it answers the rows the document holds as it settles,
 * since a push may have landed between the first answer and the fiber's
 * resuming, and no newer rows may be overwritten by older.
 */
function liveReadQuery<Read extends LiveReadName>(
  read: Read,
  ids: readonly LiveReadId[] | undefined,
  meta?: Readonly<Record<string, unknown>>,
) {
  const queryKey: LiveReadKey<Read> = ids === undefined ? [read] : [read, ...ids];
  return queryOptions({
    queryKey,
    ...(meta === undefined ? {} : { meta }),
    queryFn: ({ client, signal }) =>
      rendererPromise(firstAnswer(client, read, ids ?? []), signal).then(
        (answered) =>
          heldAt(client.getQueryData(appStateQuery.queryKey), read, ids ?? [])?.rows ?? answered,
      ),
    enabled: ids !== undefined,
    staleTime: Infinity,
    retry: false,
  });
}

/** The ids of a read keyed by the account signed in: the account, or none while nobody is. */
function accountIds(accountId: string | undefined): readonly string[] | undefined {
  return accountId === undefined ? undefined : [accountId];
}

/** The account's preferences row, by the account, which the host holds for the session. */
export const accountPreferencesQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.ACCOUNT_PREFERENCES, accountIds(accountId));

/** The models the account is offered and its devices, by the account. */
export const modelsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.MODELS, accountIds(accountId));

/** The account's provider keys, by the account. */
export const providerKeysQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.PROVIDER_KEYS, accountIds(accountId));

/** The account's own GitHub token, by the account. */
export const githubTokenQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.GITHUB_TOKEN, accountIds(accountId));

/** The account's devices' beats, by the account. */
export const devicePresenceQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.DEVICE_PRESENCE, accountIds(accountId));

/** The account's hosts, by the account. */
export const hostsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.HOSTS, accountIds(accountId));

/** This Mac's host, by the account, which the host reads on its own every few seconds and holds for the session. */
export const thisMacHostQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.THIS_MAC_HOST, accountIds(accountId));

/** The run that started one agent, by the agent, which its page holds. */
export const agentOriginQuery = (agentId: string | undefined) =>
  liveReadQuery(LIVE_READ.AGENT_ORIGINS, agentId === undefined ? undefined : [agentId]);

/** The feed of every item the account reaches, which the host holds for the session. */
export const inboxItemsQuery = () => liveReadQuery(LIVE_READ.INBOX_ITEMS, []);

/** One holder's own inbox, by its kind and its id. */
export const holderInboxQuery = (holder: InboxHolderKey | undefined) =>
  liveReadQuery(
    LIVE_READ.HOLDER_INBOX,
    holder === undefined ? undefined : [holder.kind, holder.id],
  );

/** What GitHub holds of one pull request or issue a chip draws, by the workspace it is read through and its address; none offers Try again, since the host reads it again on its own. */
export const linkStandingQuery = (link: LinkStandingKey | undefined) =>
  liveReadQuery(
    LIVE_READ.LINK_STANDINGS,
    link === undefined ? undefined : [link.workspaceId, link.address],
  );
/** One agent's or worker's transcript, by the agent and then the worker's call or the agent's own, which its tab holds while it shows. */
export const transcriptQuery = (transcript: AgentTranscriptKey | undefined) =>
  liveReadQuery(
    LIVE_READ.TRANSCRIPT,
    transcript === undefined
      ? undefined
      : [transcript.agentId, transcript.callId ?? OWN_TRANSCRIPT],
  );

/** One task's plan history, by the task, which its version history holds while it shows. */
export const historyQuery = (taskId: string | undefined) =>
  liveReadQuery(LIVE_READ.HISTORY, taskId === undefined ? undefined : [taskId]);

/** One task's pages, or one agent's on no task, by its place; none offers Try again, since the host reads them again on its own. */
export const pagesQuery = (place: PagePlace | undefined) =>
  liveReadQuery(
    LIVE_READ.PAGES,
    place === undefined
      ? undefined
      : "taskId" in place
        ? [PAGE_OWNER.TASK, place.taskId]
        : [PAGE_OWNER.AGENT, place.agentId],
  );

/** One task's cloud Browser tabs, every one of its agents', or one agent's, by its place; none offers Try again, since the host reads them again on its own. */
export const browserTabsQuery = (place: BrowserTabsPlace | undefined) =>
  liveReadQuery(
    LIVE_READ.BROWSER_TABS,
    place === undefined ? undefined : [browserTabsPlaceKind(place), browserTabsPlaceId(place)],
  );

/** One task's plan, by the task, which the window's open task holds. */
export const planDocumentQuery = (taskId: string | undefined) =>
  liveReadQuery(LIVE_READ.PLAN_DOCUMENT, taskId === undefined ? undefined : [taskId]);

/** The comments a surface holds, as the acts name them, with no page key where it reads the plan's. */
function commentsFollowOf({ taskId, pageId }: CommentSubject): CommentSubject {
  return pageId === undefined ? { taskId } : { taskId, pageId };
}

/** One plan's comments, or one of its task's pages', by the subject; the follow's subject rides on `meta`, since a page's key names no task. */
export const planCommentsQuery = (subject: CommentSubject | undefined) =>
  liveReadQuery(
    LIVE_READ.PLAN_COMMENTS,
    subject === undefined
      ? undefined
      : subject.pageId === undefined
        ? [COMMENT_SUBJECT.PLAN, subject.taskId]
        : [COMMENT_SUBJECT.PAGE, subject.pageId],
    subject === undefined ? undefined : { follow: commentsFollowOf(subject) },
  );

/** The ids of one part of a pull request: the agent, then the number the key names or `OWN_PULL_REQUEST` for the agent's own; none while a surface names none. */
function pullRequestIds(
  key: AgentPullRequestReadParams | undefined,
): readonly LiveReadId[] | undefined {
  return key === undefined ? undefined : [key.agentId, key.number ?? OWN_PULL_REQUEST];
}

/** A Pull request tab's pull request, by the agent and the number it names, or the agent's own. */
export const pullRequestQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST, pullRequestIds(key));

/** A Pull request tab's checks, by the agent and the number it names, or the agent's own. */
export const pullRequestChecksQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_CHECKS, pullRequestIds(key));

/** A Pull request tab's conversation, by the agent and the number it names, or the agent's own. */
export const pullRequestConversationQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_CONVERSATION, pullRequestIds(key));

/** What the agent published, its branch and repository among it, by the agent and the number a tab names, or the agent's own. */
export const pullRequestPublishedQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_PUBLISHED, pullRequestIds(key));

/** Which of a pull request's files the member marked viewed, by the agent and the number Files changed names, or the agent's own. */
export const pullRequestViewedQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.PULL_REQUEST_VIEWED, pullRequestIds(key));

/** What the reviewer and label pickers offer, by the agent and the number, or the agent's own. */
export const reviewOptionsQuery = (key: AgentPullRequestReadParams | undefined) =>
  liveReadQuery(LIVE_READ.REVIEW_OPTIONS, pullRequestIds(key));

/** A pull request's chapters, by the agent and its number. */
export const pullRequestChaptersQuery = (key: PullRequestChaptersReadParams | undefined) =>
  liveReadQuery(
    LIVE_READ.PULL_REQUEST_CHAPTERS,
    key === undefined ? undefined : [key.agentId, key.number],
  );

/** The ids of a read keyed by one id: that id, or none while a surface names none. */
function oneId(id: string | undefined): readonly string[] | undefined {
  return id === undefined ? undefined : [id];
}

/** The skills the account sees in a workspace, by the workspace. */
export const installedSkillsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.INSTALLED_SKILLS, oneId(workspaceId));

/** Where the account's integrations stand, by the account. */
export const integrationsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.INTEGRATIONS, accountIds(accountId));

/** What an integration server answered when asked for its tools, by its connection's name (`integrationServerOf`). */
export const integrationToolsQuery = (name: string | undefined) =>
  liveReadQuery(LIVE_READ.INTEGRATION_TOOLS, oneId(name));

/** A workspace's own integrations, its Sentry installations and its Slack bot, by the workspace. */
export const workspaceIntegrationsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_INTEGRATIONS, oneId(workspaceId));

/** An agent's own tools, by the agent. */
export const workspaceToolsQuery = (agentId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_TOOLS, oneId(agentId));

/** The outside MCP clients the account allowed, by the account. */
export const mcpClientsQuery = (accountId: string | undefined) =>
  liveReadQuery(LIVE_READ.MCP_CLIENTS, accountIds(accountId));

/** A workspace's memories, by the workspace. */
export const memoriesQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.MEMORIES, oneId(workspaceId));

/** The repositories the account reaches, by the workspace or every one (`EVERY_WORKSPACE`). */
export const repositoryListsQuery = (workspace: string | undefined) =>
  liveReadQuery(LIVE_READ.REPOSITORY_LISTS, oneId(workspace));

/** The channels of a workspace's Slack team, by the workspace. */
export const slackChannelsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.SLACK_CHANNELS, oneId(workspaceId));

/** A workspace's token repositories, by the workspace. */
export const tokenRepositoriesQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.TOKEN_REPOSITORIES, oneId(workspaceId));

/** A workspace's people, its members and who its work names but left, by the workspace. */
export const workspaceMembersQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_MEMBERS, oneId(workspaceId));

/** A workspace's pending invitations, by the workspace. */
export const workspaceInvitationsQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_INVITATIONS, oneId(workspaceId));

/** A listed workspace's photo, by the workspace, which the host fetches as its version moves and holds for the session. */
export const workspacePhotoQuery = (workspaceId: string | undefined) =>
  liveReadQuery(LIVE_READ.WORKSPACE_PHOTOS, oneId(workspaceId));

/** Try again on the account's preferences row. */
export const accountPreferencesRetryMutation = () => actMutation(ACT_KIND.AGENTS_PREFERENCES_RETRY);

/** Try again on the models, which answers once its ask has landed, which New task waits on for its devices. */
export const modelsRetryMutation = () => actMutation(ACT_KIND.AGENTS_MODELS_RETRY);

/** Try again on the provider keys. */
export const providerKeysRetryMutation = () => actMutation(ACT_KIND.PROVIDER_KEYS_RETRY);

/** Try again on the GitHub token. */
export const githubTokenRetryMutation = () => actMutation(ACT_KIND.GITHUB_TOKEN_RETRY);

/** Ask the beats again, which the window does as it comes back online (`device-presence.ts`), never on a press. */
export const devicePresenceRefreshMutation = () => actMutation(ACT_KIND.HOSTS_PRESENCE_REFRESH);

/** Try again on the hosts. */
export const hostsRetryMutation = () => actMutation(ACT_KIND.HOSTS_RETRY);

/** Try again on the feed of every item the account reaches. */
export const inboxItemsRetryMutation = () => actMutation(ACT_KIND.AGENTS_INBOX_ITEMS_RETRY);

/** Try again on one holder's own inbox. */
export const holderInboxRetryMutation = () => actMutation(ACT_KIND.AGENTS_INBOX_RETRY);
/** Try again on a plan's or a page's comments, by the subject. */
export const planCommentsRetryMutation = () => actMutation(ACT_KIND.TASKS_COMMENTS_RETRY);

/** Try again on a task's plan. */
export const planDocumentRetryMutation = () => actMutation(ACT_KIND.TASKS_DOCUMENT_RETRY);

/** Try again on one part of a pull request, named by its part, its agent, and its number, which answers once its ask has landed, so a write's read-back can wait on it. */
export const pullRequestPartRetryMutation = () =>
  actMutation(ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY);

/** Try again on a pull request's chapters. */
export const pullRequestChaptersRetryMutation = () => actMutation(ACT_KIND.CHAPTERS_RETRY);

/** Try again on a transcript. */
export const transcriptRetryMutation = () => actMutation(ACT_KIND.AGENTS_TRANSCRIPT_RETRY);

/** Try again on a plan's history. */
export const historyRetryMutation = () => actMutation(ACT_KIND.TASKS_HISTORY_RETRY);

/** Try again on a workspace's skills. */
export const installedSkillsRetryMutation = () => actMutation(ACT_KIND.INSTALLED_SKILLS_RETRY);

/** Try again on the integrations, whose read names no account, since the host holds those of whoever is signed in. */
export const integrationsRetryMutation = () => actMutation(ACT_KIND.INTEGRATIONS_RETRY);

/** Try again on one server's tools, by the server (`integrationServerOf`). */
export const integrationToolsRetryMutation = () => actMutation(ACT_KIND.INTEGRATIONS_TOOLS_RETRY);

/** Try again on a workspace's own integrations. */
export const workspaceIntegrationsRetryMutation = () =>
  actMutation(ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY);

/** Try again on the MCP clients, whose read names no account, since the host holds those of whoever is signed in. */
export const mcpClientsRetryMutation = () => actMutation(ACT_KIND.MCP_CLIENTS_RETRY);

/** Try again on a workspace's memories. */
export const memoriesRetryMutation = () => actMutation(ACT_KIND.MEMORIES_RETRY);

/** Try again on a repository list, by its scope (`repositoryScope`). */
export const repositoryListsRetryMutation = () => actMutation(ACT_KIND.TASKS_REPOSITORIES_RETRY);

/** Try again on a workspace's token repositories. */
export const tokenRepositoriesRetryMutation = () =>
  actMutation(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY);

/** Try again on a workspace's people. */
export const workspaceMembersRetryMutation = () => actMutation(ACT_KIND.WORKSPACE_MEMBERS_RETRY);

/** Try again on a workspace's invitations. */
export const workspaceInvitationsRetryMutation = () =>
  actMutation(ACT_KIND.WORKSPACE_INVITATIONS_RETRY);

/**
 * Writes what each push lays of a live read into its query: the rows of
 * every read the document holds, where they moved, so a surface that mounts
 * after they landed draws them in its first frame, as the docs' guide to
 * data pushed over a socket writes each push into the cache; a read query
 * reset where the document holds its rows no more, as a sign-out clears
 * them, so it draws pending again rather than what stood; and a failed
 * query reset where its read stands failed no more, as Try again leaves it.
 */
function writeLiveReads(client: QueryClient): void {
  const document = client.getQueryData(appStateQuery.queryKey);
  if (document === undefined) return;
  for (const read of LIVE_QUERY_READS) {
    for (const { ids, held } of readsIn(document[read], depthOf(read))) {
      // SAFETY: what a read's slice holds at its whole path of ids is that read (`@repo/host`'s `HOST_READ_SLICE`).
      const rows = (held as AppHostRead<AppHostReads[typeof read]>).rows;
      const queryKey = [read, ...idsOf(read, ids)];
      if (rows !== undefined && rows !== client.getQueryData(queryKey)) {
        client.setQueryData(queryKey, rows);
      }
    }
  }
  for (const query of client.getQueryCache().getAll()) {
    const live = liveReadOf(query);
    if (live === undefined) continue;
    const held = heldAt(document, live.read, live.ids);
    const cleared = query.state.status === "success" && held?.rows === undefined;
    const recovered = query.state.status === "error" && held?.failed !== true;
    if (cleared || recovered) {
      void client.resetQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

/**
 * Keeps every live read current and followed on `client`: each write of the
 * document written into the live reads' queries (`writeLiveReads`), and each
 * read the panel holds followed while its query is active, as the module's
 * header says. Mounted once at each root beside `AppStateSubscription`, and
 * beside a test's own client (`testing/copy-feedback.ts`).
 */
export function useLiveReadSubscription(): void {
  const client = useQueryClient();
  useEffect(() => {
    const cache = client.getQueryCache();
    const follows = new Map<Query, () => void>();
    const letGo = (query: Query): void => {
      follows.get(query)?.();
      follows.delete(query);
    };
    const hold = (query: Query): void => {
      const live = liveReadOf(query);
      const follow = live === undefined ? undefined : LIVE_FOLLOWS[live.read];
      if (live === undefined || follow === undefined) return;
      const followed = follows.has(query);
      if (query.isActive() && !followed) {
        follows.set(
          query,
          streamFrom(
            () => follow(live.ids, query.meta),
            () => undefined,
          ),
        );
      }
      if (!query.isActive() && followed) letGo(query);
    };
    const unsubscribe = cache.subscribe((event) => {
      if (isAppState(event.query)) {
        if (event.type === "updated") writeLiveReads(client);
        return;
      }
      if (event.type === "removed") letGo(event.query);
      if (
        event.type === "observerAdded" ||
        event.type === "observerRemoved" ||
        event.type === "observerOptionsUpdated"
      ) {
        hold(event.query);
      }
    });
    // Note that what the document held, and a query observed, before this mounted are written and held now, since their events came first.
    writeLiveReads(client);
    for (const query of cache.getAll()) hold(query);
    return () => {
      unsubscribe();
      for (const release of follows.values()) release();
    };
  }, [client]);
}

/** `useLiveReadSubscription` as an element, for a root to mount beside the surface it draws. */
export function LiveReadSubscription(): null {
  useLiveReadSubscription();
  return null;
}
