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
 *   the read's path in its slice. A factory handed no ids, as a surface
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
 *   read the host holds for the session takes no follow (`LIVE_FOLLOWS`).
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

import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppHostReads,
  type AppStateSnapshot,
  HOST_READ_SLICE,
  KEYS_ON,
  READ_KEYS,
} from "@repo/host/app-state";
import { type Query, type QueryClient, queryOptions, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useEffect } from "react";
import { askAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { streamFrom } from "./act-stream.js";
import { QUERY_ROOT } from "./query-keys.js";
import { rendererPromise } from "./renderer-runtime.js";
import { appStateQuery } from "./use-app-state.js";

/** A live read, by its name. */
type LiveReadName = keyof AppHostReads;

/** A live read's query key: its name, then its path of ids in its slice; its name alone where a surface names no ids. */
type LiveReadKey<Read extends LiveReadName> = readonly [Read, ...string[]];

/** The read a live read's query stands for: the host could not answer it before it ever had. */
export class LiveReadFailed extends Error {
  constructor(readonly read: LiveReadName) {
    super(`The host could not read ${read}.`);
    this.name = "LiveReadFailed";
  }
}

/** A follow, a stream on the act port that carries nothing and that the host keeps the read followed for, by the read's ids. */
type LiveFollow = (
  ids: readonly string[],
) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>;

/**
 * The follow of each live read moved here that the panel holds. Note that
 * the host holds the account reads of whoever is signed in, so none of their
 * follows names the account its key does; the account preferences and This
 * Mac's host the host holds for the session, so they take none.
 */
const LIVE_FOLLOWS: { readonly [Read in LiveReadName]?: LiveFollow } = {
  [LIVE_READ.MODELS]: () => askAct(ACT_KIND.AGENTS_MODELS_FOLLOW),
  [LIVE_READ.PROVIDER_KEYS]: () => askAct(ACT_KIND.PROVIDER_KEYS_FOLLOW),
  [LIVE_READ.GITHUB_TOKEN]: () => askAct(ACT_KIND.GITHUB_TOKEN_FOLLOW),
  [LIVE_READ.DEVICE_PRESENCE]: () => askAct(ACT_KIND.HOSTS_PRESENCE_FOLLOW),
  [LIVE_READ.HOSTS]: () => askAct(ACT_KIND.HOSTS_FOLLOW),
};

/** Every live read moved here, by its name, which `use-host-read.ts` reads no more. */
const LIVE_QUERY_READS = [
  LIVE_READ.ACCOUNT_PREFERENCES,
  LIVE_READ.MODELS,
  LIVE_READ.PROVIDER_KEYS,
  LIVE_READ.GITHUB_TOKEN,
  LIVE_READ.DEVICE_PRESENCE,
  LIVE_READ.HOSTS,
  LIVE_READ.THIS_MAC_HOST,
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

/** Every read `held` holds `depth` ids deep, each with its path of ids. */
function readsIn(
  held: unknown,
  depth: number,
  ids: readonly string[] = [],
): readonly { readonly ids: readonly string[]; readonly held: unknown }[] {
  if (depth === 0) return held === undefined ? [] : [{ ids, held }];
  if (typeof held !== "object" || held === null) return [];
  return Object.entries(held).flatMap(([id, below]) => readsIn(below, depth - 1, [...ids, id]));
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
  ids: readonly string[],
): AppHostRead<AppHostReads[Read]> | undefined {
  // SAFETY: what a read's slice holds at its whole path of ids is that read (`@repo/host`'s `HOST_READ_SLICE`).
  return valueAt(document?.[read], ids) as AppHostRead<AppHostReads[Read]> | undefined;
}

/** Whether `query` is the app-state document's. */
function isAppState(query: Query): boolean {
  return query.queryKey[0] === QUERY_ROOT.APP_STATE;
}

/** The live read `query` stands for and its ids, where it is one moved here and names every id its slice is keyed by. */
function liveReadOf(
  query: Query,
): { readonly read: LiveReadName; readonly ids: readonly string[] } | undefined {
  const [name, ...ids] = query.queryKey;
  if (typeof name !== "string" || !MOVED.has(name)) return undefined;
  // SAFETY: `MOVED` holds live read names alone.
  const read = name as LiveReadName;
  if (ids.length !== depthOf(read)) return undefined;
  if (!ids.every((id): id is string => typeof id === "string")) return undefined;
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
  ids: readonly string[],
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
function liveReadQuery<Read extends LiveReadName>(read: Read, ids: readonly string[] | undefined) {
  const queryKey: LiveReadKey<Read> = ids === undefined ? [read] : [read, ...ids];
  return queryOptions({
    queryKey,
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
      const queryKey = [read, ...ids];
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
            () => follow(live.ids),
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
