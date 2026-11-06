import { AUTOMATION_FOLLOW, type AutomationFollow } from "@repo/features/automation-view";
import type { IntegrationProviderParams } from "@repo/features/integration-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppHostReads,
  type AppStateSnapshot,
  EVERY_WORKSPACE,
} from "@repo/host/app-state";
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
 * workspace's automations or runs, an automation's runs, an agent's or a
 * worker's transcript, or a workspace's people or invitations, is held by the
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

export type HostReadStatus = (typeof HOST_READ_STATUS)[keyof typeof HOST_READ_STATUS];

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

/** A repository list's scope as its acts name it: its workspace, or nothing for every one (`EVERY_WORKSPACE`). */
function repositoryScope(workspace: string): { readonly workspaceId?: string } {
  return workspace === EVERY_WORKSPACE ? {} : { workspaceId: workspace };
}

/** The integration server whose tools a surface reads: its provider, and its account where the server is not the provider's own. */
export type IntegrationServer = Pick<IntegrationProviderParams, "provider" | "connection">;

/** A read the host holds for the panel, by its name (`AppHostReads`), but those read as queries (`live-reads.ts`). */
type HostReadName = Exclude<keyof AppHostReads, LiveQueryRead>;

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
 * those moved onto TanStack Query (`live-reads.ts`): where the account's integrations stand, by the account, which every
 * surface drawing an integration holds; one agent's own tools, which its
 * servers popover holds; one integration server's tools, by the account it
 * stands for, which a list of the servers holds; the outside MCP clients the account allowed, by
 * the account, which Settings › MCP holds; one workspace's
 * memories, which Settings › Memory holds; the skills the account sees in
 * one workspace, which Settings › Skills holds; one workspace's
 * automations, one workspace's runs, or one automation's runs, by its id;
 * one workspace's people, its members and who its work names but
 * left, which every surface naming them holds; one workspace's token
 * repositories, which Settings › Workspace and onboarding's GitHub step
 * hold; one workspace's pending invitations, which an owner's or an
 * admin's Settings › Workspace holds; one workspace's own integrations, its
 * Sentry installations and its Slack bot, which Settings › Workspace and an
 * automation's editor hold; the channels of one workspace's Slack team,
 * which an owner's or an admin's Settings › Workspace holds; each listed
 * workspace's photo, which the host fetches as its version moves and holds
 * for the session. A workspace's photo offers
 * none, since the host fetches it again as the workspaces next move.
 */
const HOST_READS = {
  [LIVE_READ.INSTALLED_SKILLS]: hostRead(LIVE_READ.INSTALLED_SKILLS, {
    slice: APP_SLICE.INSTALLED_SKILLS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.INSTALLED_SKILLS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.INSTALLED_SKILLS_RETRY, { workspaceId }),
  }),
  [LIVE_READ.INTEGRATIONS]: hostRead(LIVE_READ.INTEGRATIONS, {
    slice: APP_SLICE.INTEGRATIONS,
    path: (accountId: string) => [accountId],
    // Note that the host holds the integrations of whoever is signed in, so the hold and its Try again name no account.
    hold: () => askAct(ACT_KIND.INTEGRATIONS_FOLLOW),
    retry: () => tellAct(ACT_KIND.INTEGRATIONS_RETRY),
  }),
  [LIVE_READ.INTEGRATION_TOOLS]: hostRead(LIVE_READ.INTEGRATION_TOOLS, {
    slice: APP_SLICE.INTEGRATION_TOOLS,
    path: (server: IntegrationServer) => [server.connection ?? server.provider],
    hold: (server) => askAct(ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW, server),
    retry: (server) => tellAct(ACT_KIND.INTEGRATIONS_TOOLS_RETRY, server),
  }),
  [LIVE_READ.MEMORIES]: hostRead(LIVE_READ.MEMORIES, {
    slice: APP_SLICE.MEMORIES,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.MEMORIES_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.MEMORIES_RETRY, { workspaceId }),
  }),
  [LIVE_READ.REPOSITORY_LISTS]: hostRead(LIVE_READ.REPOSITORY_LISTS, {
    slice: APP_SLICE.REPOSITORY_LISTS,
    path: (workspace: string) => [workspace],
    hold: (workspace) => askAct(ACT_KIND.TASKS_REPOSITORIES_FOLLOW, repositoryScope(workspace)),
    retry: (workspace) => tellAct(ACT_KIND.TASKS_REPOSITORIES_RETRY, repositoryScope(workspace)),
  }),
  [LIVE_READ.WORKSPACE_INVITATIONS]: hostRead(LIVE_READ.WORKSPACE_INVITATIONS, {
    slice: APP_SLICE.WORKSPACE_INVITATIONS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_INVITATIONS_RETRY, { workspaceId }),
  }),
  [LIVE_READ.WORKSPACE_MEMBERS]: hostRead(LIVE_READ.WORKSPACE_MEMBERS, {
    slice: APP_SLICE.WORKSPACE_MEMBERS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_MEMBERS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_MEMBERS_RETRY, { workspaceId }),
  }),
  [LIVE_READ.WORKSPACE_INTEGRATIONS]: hostRead(LIVE_READ.WORKSPACE_INTEGRATIONS, {
    slice: APP_SLICE.WORKSPACE_INTEGRATIONS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_INTEGRATIONS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_INTEGRATIONS_RETRY, { workspaceId }),
  }),
  [LIVE_READ.SLACK_CHANNELS]: hostRead(LIVE_READ.SLACK_CHANNELS, {
    slice: APP_SLICE.SLACK_CHANNELS,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_SLACK_CHANNELS_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_SLACK_CHANNELS_RETRY, { workspaceId }),
  }),
  [LIVE_READ.TOKEN_REPOSITORIES]: hostRead(LIVE_READ.TOKEN_REPOSITORIES, {
    slice: APP_SLICE.TOKEN_REPOSITORIES,
    path: (workspaceId: string) => [workspaceId],
    hold: (workspaceId) => askAct(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW, { workspaceId }),
    retry: (workspaceId) => tellAct(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_RETRY, { workspaceId }),
  }),
  [LIVE_READ.WORKSPACE_PHOTOS]: hostRead(LIVE_READ.WORKSPACE_PHOTOS, {
    slice: APP_SLICE.WORKSPACE_PHOTOS,
    path: (workspaceId: string) => [workspaceId],
    hold: undefined,
    retry: undefined,
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
