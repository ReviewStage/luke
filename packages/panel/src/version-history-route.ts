/**
 * version-history-route.ts -- a task's version history as the router stands it: whether it stands, on which task, where in it, and the navigation that opens, moves, and leaves it.
 *
 * The history is a routed place (`panel-router.tsx`) over the whole window,
 * read from its address alone: `/<workspace>/task/<task>/versions` follows
 * the newest version, which a narrow room stands as the list alone;
 * `/version/<revision>` stands a version chosen; `/version/<revision>/sections`
 * lists the sections it changed; and `/version/<revision>/section/<heading>`
 * stands one of them. The task is named as its links name it, by its number
 * where it has one (`taskLinkStep`). The history is one step of the window's
 * however its versions are chosen, each move replacing the step standing,
 * but for a narrow room's version or section opened from its list, a step
 * after it, which the window's history steps back from (`lists.versions`).
 */

import { type RegisteredRouter, useNavigate, useRouter } from "@tanstack/react-router";
import { ROUTED_PLACE, routedPlaceOf, useWindowPlace } from "./places/routed-places.js";
import { useRouteAccess } from "./route-gates.js";
import type { HistorySpot } from "./tasks/use-description-history.js";

/** Which page of the history an address stands. */
const VERSION_PAGE = {
  LIST: "list",
  VERSION: "version",
  SECTIONS: "sections",
  SECTION: "section",
} as const;

type VersionPage = (typeof VERSION_PAGE)[keyof typeof VERSION_PAGE];

/** Each version history route by id, and the page it stands. */
const VERSION_LEAF = {
  "/version-history/$workspace/task/$taskId/versions": VERSION_PAGE.LIST,
  "/version-history/$workspace/task/$taskId/version/$revision/": VERSION_PAGE.VERSION,
  "/version-history/$workspace/task/$taskId/version/$revision/sections": VERSION_PAGE.SECTIONS,
  "/version-history/$workspace/task/$taskId/version/$revision/section/$heading":
    VERSION_PAGE.SECTION,
} as const;

/** Where the history opens with nothing asked for: following the newest, on its list. */
const VERSION_LIST: HistorySpot = { revision: undefined, opened: undefined, listed: true };

/** The revision an address names, none where its step is no revision. */
function revisionOf(step: string | undefined): number | undefined {
  const revision = Number(step);
  return Number.isSafeInteger(revision) ? revision : undefined;
}

/** Where in the history the address stands, where it stands one. */
function spotOf(
  leaf: string | undefined,
  params: Readonly<Record<string, string | undefined>>,
): HistorySpot | undefined {
  const page: VersionPage | undefined = Object.entries(VERSION_LEAF).find(
    ([id]) => id === leaf,
  )?.[1];
  if (page === undefined) return undefined;
  if (page === VERSION_PAGE.LIST) return VERSION_LIST;
  const revision = revisionOf(params.revision);
  if (revision === undefined) return VERSION_LIST;
  switch (page) {
    case VERSION_PAGE.VERSION:
      return { revision, opened: undefined, listed: false };
    case VERSION_PAGE.SECTIONS:
      return { revision, opened: { seq: revision, heading: undefined }, listed: true };
    case VERSION_PAGE.SECTION:
      return { revision, opened: { seq: revision, heading: params.heading }, listed: false };
  }
}

/** The address of the history of the task `taskId` names, under `workspace`, at `spot`. */
function addressOf(
  router: RegisteredRouter,
  spot: HistorySpot,
  workspace: string,
  taskId: string,
): string {
  const { revision, opened } = spot;
  if (revision !== undefined && opened !== undefined) {
    const seq = String(opened.seq);
    if (opened.heading === undefined || spot.listed === true) {
      return router.buildLocation({
        to: "/$workspace/task/$taskId/version/$revision/sections",
        params: { workspace, taskId, revision: seq },
      }).href;
    }
    return router.buildLocation({
      to: "/$workspace/task/$taskId/version/$revision/section/$heading",
      params: { workspace, taskId, revision: seq, heading: opened.heading },
    }).href;
  }
  // Note that the list stands under no version, as the history opened on its newest does.
  if (revision === undefined || spot.listed === true) {
    return router.buildLocation({
      to: "/$workspace/task/$taskId/versions",
      params: { workspace, taskId },
    }).href;
  }
  return router.buildLocation({
    to: "/$workspace/task/$taskId/version/$revision",
    params: { workspace, taskId, revision: String(revision) },
  }).href;
}

/** A task's version history as the router stands it. */
export interface VersionHistoryRoute {
  readonly open: boolean;
  /** The address step of the workspace the history's task is in, while it stands. */
  readonly workspace: string | undefined;
  /** The step the history's address names its task by, its number or its id, while it stands. */
  readonly task: string | undefined;
  /** Where in the history the address stands, while it stands. */
  readonly spot: HistorySpot | undefined;
  /** The address of the list standing under a narrow room's version or section, which its way back steps back to; none on a list. */
  readonly listAddress: string | undefined;
  /** Opens the history of the task named `task` under `workspace`, at `spot`, its list where none is named. */
  readonly onOpen: (workspace: string, task: string, spot?: HistorySpot) => void;
  /** Stands the history at `spot`: a narrow room's version opened from its list as a step after it, any other move in the step's place. */
  readonly onMove: (spot: HistorySpot) => void;
  /** Leaves the history for the task under it, as its way out does where no step stands behind it. */
  readonly onClose: () => void;
  /** Gives the history's step to its task, as a task with no history to show does. */
  readonly onGiveWay: () => void;
  /** Reads the history's chunk ahead for the task named `task` under `workspace`, as the pointer comes to a way into it. */
  readonly onPreload: (workspace: string, task: string) => void;
}

/** Where the history stands by the route an address ends on and its params: its workspace, its task, and its spot; none off it. */
function standingOf(
  leaf: string | undefined,
  params: Readonly<Record<string, string | undefined>>,
): { readonly workspace: string; readonly task: string; readonly spot: HistorySpot } | undefined {
  const spot = spotOf(leaf, params);
  const { workspace, taskId } = params;
  if (spot === undefined || workspace === undefined || taskId === undefined) return undefined;
  return { workspace, task: taskId, spot };
}

/** A task's version history as the router stands it, in a room `narrow` or not, left by `onClose`, and kept standing by `onStay` where a leave was asked of it before a door asked for where it stands. */
export function useVersionHistoryRoute(input: {
  narrow: boolean;
  onClose: () => void;
  onStay: () => void;
}): VersionHistoryRoute {
  const router = useRouter();
  const navigate = useNavigate();
  const here = useWindowPlace();
  const access = useRouteAccess();
  const standing =
    here.place === ROUTED_PLACE.VERSION_HISTORY ? standingOf(here.leaf, here.params) : undefined;
  // Note that the doors read where the history stands as they are pressed, since a door held from an earlier draw may be pressed after it moved.
  const standingNow = () => {
    const matches = router.matchRoutes(router.history.location.pathname);
    if (routedPlaceOf(matches, access) !== ROUTED_PLACE.VERSION_HISTORY) return undefined;
    const last = matches.at(-1);
    return standingOf(last?.routeId, last?.params ?? {});
  };
  const go = (href: string, replace: boolean) => {
    // Standing the history where it stands moves nothing, as pressing the place standing always has, and keeps it standing.
    if (href === router.history.location.href) {
      input.onStay();
      return;
    }
    void navigate({ href, replace });
  };
  const onOpen = (into: string, named: string, at: HistorySpot = VERSION_LIST) => {
    const now = standingNow();
    const same = now?.workspace === into && now.task === named;
    go(addressOf(router, at, into, named), same);
  };
  const onMove = (to: HistorySpot) => {
    const now = standingNow();
    if (now === undefined) return;
    const opensItem = input.narrow && now.spot.listed === true && to.listed !== true;
    go(addressOf(router, to, now.workspace, now.task), !opensItem);
  };
  const listAddress =
    standing === undefined || standing.spot.listed === true
      ? undefined
      : addressOf(router, { ...standing.spot, listed: true }, standing.workspace, standing.task);
  const onGiveWay = () => {
    const now = standingNow();
    if (now === undefined) return;
    void navigate({
      to: "/$workspace/task/$taskId",
      params: { workspace: now.workspace, taskId: now.task },
      replace: true,
    });
  };
  return {
    open: standing !== undefined,
    workspace: standing?.workspace,
    task: standing?.task,
    spot: standing?.spot,
    listAddress,
    onOpen,
    onMove,
    onClose: input.onClose,
    onGiveWay,
    onPreload: (into, named) =>
      void router.preloadRoute({
        to: "/$workspace/task/$taskId/versions",
        params: { workspace: into, taskId: named },
      }),
  };
}
