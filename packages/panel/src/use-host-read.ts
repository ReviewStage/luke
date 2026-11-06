import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppHostReads, AppStateSnapshot } from "@repo/host/app-state";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect } from "react";
import { askAct, tellAct } from "./act.js";
import { streamFrom } from "./act-stream.js";
import type { LiveQueryRead } from "./live-reads.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

export const HOST_READ_STATUS = {
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
} as const;

type HostReadStatus = (typeof HOST_READ_STATUS)[keyof typeof HOST_READ_STATUS];

export interface HeldRead<Rows> {
  readonly rows: Rows | undefined;
  readonly status: HostReadStatus;
}

export interface HostRead<Rows> extends HeldRead<Rows> {
  readonly retry: () => Promise<void>;
}

type HostReadName = Exclude<keyof AppHostReads, LiveQueryRead> | typeof LIVE_READ.WORKSPACE_MEMBERS;

function statusOf(held: AppHostRead<unknown> | undefined): HostReadStatus {
  if (held?.rows !== undefined) return HOST_READ_STATUS.READY;
  return held?.failed === true ? HOST_READ_STATUS.FAILED : HOST_READ_STATUS.LOADING;
}

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

interface HostReadEntry<Read extends HostReadName, Key, Retry> {
  readonly slice: Atom.Atom<AppStateSnapshot[Read] | undefined>;
  readonly at: (path: readonly string[]) => Atom.Atom<AppHostRead<AppHostReads[Read]> | undefined>;
  readonly path: ((key: Key) => readonly string[]) | undefined;
  readonly hold:
    | ((key: Key) => Promise<AsyncIteratorObject<unknown, unknown, unknown>>)
    | undefined;
  readonly retry: Retry;
}

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
    at: (path) => at(path) as Atom.Atom<AppHostRead<AppHostReads[Read]> | undefined>,
    slice: declared.slice,
    path: declared.path,
    hold: declared.hold,
    retry: declared.retry,
  };
}

const HOST_READS = {
  [LIVE_READ.WORKSPACE_MEMBERS]: hostRead(LIVE_READ.WORKSPACE_MEMBERS, {
    slice: APP_SLICE.WORKSPACE_MEMBERS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_MEMBERS_RETRY, { workspaceId }),
  }),
} as const satisfies { readonly [Read in HostReadName]: HostReadEntry<Read, never, unknown> };

type HostReads = typeof HOST_READS;

type HostReadKey<Read extends HostReadName> =
  HostReads[Read] extends HostReadEntry<Read, infer Key, infer _Retry>
    ? [Key] extends [never]
      ? []
      : [key: Key | undefined]
    : never;

type HostReadKeyOf<Read extends HostReadName> =
  HostReads[Read] extends HostReadEntry<Read, infer Key, infer _Retry> ? Key : never;

type HostReadOf<Read extends HostReadName> = HostReads[Read]["retry"] extends undefined
  ? HeldRead<AppHostReads[Read]>
  : HostRead<AppHostReads[Read]>;

const NO_READ: Atom.Atom<AppHostRead<never> | undefined> = Atom.make(undefined);

const WHOLE_SLICE: readonly string[] = [];

export function useHostRead<Read extends HostReadName>(
  read: Read,
  ...[key]: HostReadKey<Read>
): HostReadOf<Read> {
  const entry = HOST_READS[read];
  const keyed = key as never;
  const path =
    entry.path === undefined ? WHOLE_SLICE : key === undefined ? undefined : entry.path(keyed);
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
  return (entry.retry === undefined ? drawn : { ...drawn, retry }) as HostReadOf<Read>;
}

const NO_SLICE: Atom.Atom<undefined> = Atom.make(undefined);

export interface HeldKeys<Key, Rows> {
  readonly readOf: (key: Key) => HeldRead<Rows>;
  readonly retry: (key: Key) => void;
}

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
      const path = entry.path?.(key as never);
      const at = (path === undefined ? undefined : valueAt(held, path)) as
        | AppHostRead<AppHostReads[Read]>
        | undefined;
      return { rows: at?.rows, status: statusOf(at) };
    },
    [entry, held],
  );
  const retry = useCallback((key: HostReadKeyOf<Read>) => entry.retry?.(key as never), [entry]);
  return { readOf, retry };
}
