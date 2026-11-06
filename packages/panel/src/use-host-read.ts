import { AUTOMATION_FOLLOW, type AutomationFollow } from "@repo/features/automation-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppHostReads, AppStateSnapshot } from "@repo/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect } from "react";
import { askAct, tellAct } from "./act.js";
import { streamFrom } from "./act-stream.js";
import type { LiveQueryRead } from "./live-reads.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * use-host-read.ts -- the way a surface reads server data not yet moved onto TanStack Query (`live-reads.ts`): a read the host holds for the panel, drawn from app state, with where it stands and Try again.
 *
 * The host follows each read for as long as its lifetime holds it
 * (`@repo/host`'s `live-collection.ts`) and lays its rows in the app-state
 * slice named for it (`LIVE_READ`), which outlives every page, so a surface
 * drawn again draws its rows in its first frame, before anything is pushed.
 * A read is loading until it first answers, failed where it said it could
 * not answer before it ever had, and ready from its first rows on: one that
 * holds rows never says loading again. A keyed read, a plan's or an agent's
 * own inbox, a task's or an agent's pages or cloud Browser tabs, a
 * workspace's people, or a workspace's automations or runs, or an
 * automation's runs, is held by the
 * surface that reads it: the host follows it while any surface holds it and a while
 * after, so a holder chosen again, or a surface drawn again, draws from
 * where its read stands. Each read is one entry of `HOST_READS`, which the
 * one hook path reads, so a read added is an entry rather than a hook.
 * Nothing in `packages/panel` or `packages/ui` but a test reads server
 * data outside this hook and `live-reads.ts`, and nothing but those two and
 * the door's own test imports `act-stream.ts`, the door it holds its follows open by
 * (`anti-slop/no-follow-outside-host-read`).
 */

export const HOST_READ_STATUS = {
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
} as const;

type HostReadStatus = (typeof HOST_READ_STATUS)[keyof typeof HOST_READ_STATUS];

/** A read as a surface draws it: its rows once it answered, and where it stands. */
export interface HeldRead<Rows> {
  readonly rows: Rows | undefined;
  readonly status: HostReadStatus;
}

/** A read a surface offers Try again on, as well. */
export interface HostRead<Rows> extends HeldRead<Rows> {
  /** Try again, settling once the ask lands where the read's Try again waits on it, and at once where it does not. */
  readonly retry: () => Promise<void>;
}

/** A read the host holds for the panel, by its name (`AppHostReads`), but those read as queries (`live-reads.ts`), and the workspace's people while the Router's history still reads them here. */
type HostReadName = Exclude<keyof AppHostReads, LiveQueryRead> | typeof LIVE_READ.WORKSPACE_MEMBERS;

/** Where a read stands, from what the host holds of it. */
function statusOf(held: AppHostRead<unknown> | undefined): HostReadStatus {
  if (held?.rows !== undefined) return HOST_READ_STATUS.READY;
  return held?.failed === true ? HOST_READ_STATUS.FAILED : HOST_READ_STATUS.LOADING;
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
  _read: Read,
  declared: {
    readonly slice: Atom.Atom<AppStateSnapshot[Read] | undefined>;
    readonly path: ((key: Key) => readonly string[]) | undefined;
    readonly hold:
      | ((key: Key) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>)
      | undefined;
    readonly retry: Retry;
  },
): HostReadEntry<Read, Key, Retry> {
  const at = atomsAt(declared.slice, 1);
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
 * Every read a surface reads through `useHostRead`, by its name, but
 * those moved onto TanStack Query (`live-reads.ts`): one workspace's people,
 * which the window's history holds while a person's page stands on it; and
 * one workspace's automations, one workspace's runs, or one automation's
 * runs, by its id.
 */
const HOST_READS = {
  // Note that `navigation-history.ts`, the Router task's, is the last caller of this entry, which leaves with it (`workspaceMembersQuery`).
  [LIVE_READ.WORKSPACE_MEMBERS]: hostRead(LIVE_READ.WORKSPACE_MEMBERS, {
    slice: APP_SLICE.WORKSPACE_MEMBERS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_MEMBERS_RETRY, { workspaceId }),
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
  // Note that a key's path is one segment (`READ_KEYS.ONE`), so the effects below name it alone.
  const [first] = path ?? [];
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
  }, [entry, first]);
  // Note that a Try again the port refuses settles as one that landed, since the read's own failure is what the surface draws.
  const retry = useCallback(
    (): Promise<void> =>
      path === undefined
        ? Promise.resolve()
        : Promise.resolve(entry.retry?.(keyed)).then(
            () => undefined,
            () => undefined,
          ),
    [entry, first],
  );
  const drawn = { rows: held?.rows, status: statusOf(held) };
  // SAFETY: a read's rows are its entry's (`AppHostReads`), and Try again stands where its entry offers one (`HostReadOf`).
  return (entry.retry === undefined ? drawn : { ...drawn, retry }) as HostReadOf<Read>;
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
