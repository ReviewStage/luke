/**
 * route-gates.ts -- who may stand on a routed place: the one predicate per gated route, which its `beforeLoad` and the window's Back and Forward both ask.
 *
 * A route's `beforeLoad` runs only as the router goes there, so it cannot
 * say whether Back or Forward may reach an entry before they move. Each
 * gate is therefore a predicate of its own, handed what it reads, which the
 * route's `beforeLoad` asks of the router's context (`panel-router.tsx`)
 * and the window's history asks of the window's state
 * (`navigation-history.ts`'s `reachable`), so the two never disagree.
 */

import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import { type ExperimentChoices, NO_EXPERIMENTS } from "@repo/settings";
import { SETTINGS_PAGE_LIST, type SettingsView } from "@repo/settings/settings-views";
import type { RegisteredRouter, RouteIds } from "@tanstack/react-router";
import { useMemo, useRef } from "react";
import { useKeptChoice } from "./desktop/chosen-workspace.js";
import { settingsPageExperimentStands } from "./settings/settings-rows.js";
import {
  APP_SLICE,
  appStateNow,
  SETTINGS_HELD,
  useAdminAccess,
  useAdminAccessPending,
  useAppSlice,
  useExperimentChoices,
} from "./use-app-state.js";

/** What a workspace's gate reads of each of the reader's workspaces: what an address's first step may name it by. */
type GateWorkspace = Pick<Workspace, "id" | "slug" | "formerSlugs">;

/** The reader's workspaces before their first read lands. */
const NO_WORKSPACES: readonly GateWorkspace[] = [];

/** What the gates read: whether the account may reach Admin, its access still being read counting as may, its experiments, and whether they are read yet. */
export interface RouteAccess {
  readonly admin: boolean;
  readonly experiments: ExperimentChoices;
  /** Whether the account's settings, its experiments among them, have been read; a page an experiment holds waits on the read rather than giving way. */
  readonly experimentsRead: boolean;
  /** The reader's workspaces, none before their first read lands, which a workspace's place waits on rather than giving way. */
  readonly workspaces: readonly GateWorkspace[];
  /** The step the listed workspace's address names it by, which a person's page naming none of the reader's opens under; none while none is listed. */
  readonly listed: string | undefined;
}

/** The window's access as it stands now, for a route's `beforeLoad`, which cannot wait a render. */
export function routeAccessNow(): RouteAccess {
  const state = appStateNow();
  const access = state?.access;
  return {
    // A reloaded Admin address waits on an access still being read rather than being refused.
    admin: access === undefined || access.pending === true || access.admin === true,
    experiments: state?.settings?.experiments ?? NO_EXPERIMENTS,
    experimentsRead: state?.settings !== undefined,
    workspaces: state?.tasks?.workspaces ?? NO_WORKSPACES,
    // Note that the router is made before the window chooses, so its first reading lists the first workspace, as the window does with none kept.
    listed: stepOf(state?.tasks?.workspaces?.[0]),
  };
}

/** The step a workspace's address names it by: its slug, or its id where an older service answered none. */
function stepOf(workspace: GateWorkspace | undefined): string | undefined {
  return workspace === undefined ? undefined : (workspace.slug ?? workspace.id);
}

/** Whether two lists of slugs are the same slugs in the same order. */
function sameSlugs(one: readonly string[] = [], other: readonly string[] = []): boolean {
  return one.length === other.length && one.every((slug, at) => slug === other[at]);
}

/** Whether two readings of the reader's workspaces name the same workspaces by the same steps. */
function sameWorkspaces(one: readonly GateWorkspace[], other: readonly GateWorkspace[]): boolean {
  return (
    one.length === other.length &&
    one.every(
      (each, at) =>
        each.id === other[at]?.id &&
        each.slug === other[at]?.slug &&
        sameSlugs(each.formerSlugs, other[at]?.formerSlugs),
    )
  );
}

/**
 * The window's access as it draws, for the router's context and the
 * window's Back and Forward alike. Note that the workspaces are held while
 * a read names the same ones, because the task list carrying them is read
 * again as any task moves, and each new access asks the routes standing again.
 */
export function useRouteAccess(): RouteAccess {
  const admin = useAdminAccess();
  const adminPending = useAdminAccessPending();
  const experiments = useExperimentChoices();
  const experimentsRead = useAppSlice(SETTINGS_HELD);
  const read = useAppSlice(APP_SLICE.TASKS)?.workspaces ?? NO_WORKSPACES;
  const held = useRef(read);
  if (!sameWorkspaces(held.current, read)) held.current = read;
  const workspaces = held.current;
  const listed = stepOf(useKeptChoice(workspaces));
  return useMemo(
    (): RouteAccess => ({
      admin: admin || adminPending,
      experiments,
      experimentsRead,
      workspaces,
      listed,
    }),
    [admin, adminPending, experiments, experimentsRead, workspaces, listed],
  );
}

/** Whether a workspace's place stands at an address whose first step is `workspace`: one of the reader's, or any while their workspaces are not yet read. */
export function workspaceRouteStands(workspace: string, access: RouteAccess): boolean {
  return (
    access.workspaces.length === 0 || workspaceOfSlug(access.workspaces, workspace) !== undefined
  );
}

/** Whether Admin stands: an admin's alone, or while the account's access is still read. */
export function adminRouteStands(access: RouteAccess): boolean {
  return access.admin;
}

/** The Settings page a page segment names; none for a segment naming no page. */
export function settingsViewOfPage(page: string): SettingsView | undefined {
  return SETTINGS_PAGE_LIST.find((view) => view === page);
}

/** Whether a Settings page stands: every page but one an experiment the account has off holds, which waits on the account's settings while they are unread, as a reloaded address's does. */
export function settingsPageRouteStands(page: string, access: RouteAccess): boolean {
  const view = settingsViewOfPage(page);
  if (view === undefined || !access.experimentsRead) return true;
  return settingsPageExperimentStands(view, access.experiments);
}

/** The places the router alone says the window stands on, rather than the window's state: Settings, Admin, a workspace's Board, and a person's page. */
export const ROUTED_PLACE = {
  SETTINGS: "settings",
  ADMIN: "admin",
  BOARD: "board",
  PERSON: "person",
} as const;

export type RoutedPlace = (typeof ROUTED_PLACE)[keyof typeof ROUTED_PLACE];

/** Each routed place's routes, by id, under whichever parent it stands (`panel-router.tsx`). */
const ROUTED_ROUTES = {
  "/$workspace/settings": ROUTED_PLACE.SETTINGS,
  "/app/settings": ROUTED_PLACE.SETTINGS,
  "/places/$workspace/admin": ROUTED_PLACE.ADMIN,
  "/places/$workspace/tasks": ROUTED_PLACE.BOARD,
  "/places/$workspace/person/$userId": ROUTED_PLACE.PERSON,
} as const satisfies Partial<Record<RouteIds<RegisteredRouter["routeTree"]>, RoutedPlace>>;

/** What a routed place's gate reads of a match: its route and the params it was matched with. */
interface RouteMatchSeen {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string | undefined>>;
}

/** The routed place `matches` stand on; none where they stand on a place the window's state says. */
export function routedPlaceOf(matches: readonly RouteMatchSeen[]): RoutedPlace | undefined {
  for (const match of matches) {
    const place = Object.entries(ROUTED_ROUTES).find(([id]) => id === match.routeId)?.[1];
    if (place !== undefined) return place;
  }
  return undefined;
}

/** Whether the window may stand on what `matches` name, as their routes' `beforeLoad` would let it: a place its state says always may. */
export function routedStands(matches: readonly RouteMatchSeen[], access: RouteAccess): boolean {
  const place = routedPlaceOf(matches);
  if (place === ROUTED_PLACE.ADMIN) return adminRouteStands(access);
  if (place === ROUTED_PLACE.BOARD || place === ROUTED_PLACE.PERSON) {
    const workspace = matches.find((match) => match.params.workspace !== undefined)?.params
      .workspace;
    return workspace === undefined || workspaceRouteStands(workspace, access);
  }
  if (place !== ROUTED_PLACE.SETTINGS) return true;
  const page = matches.find((match) => match.params.page !== undefined)?.params.page;
  return page === undefined || settingsPageRouteStands(page, access);
}
