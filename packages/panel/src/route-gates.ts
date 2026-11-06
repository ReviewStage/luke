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
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  EXPERIMENT,
  type ExperimentChoices,
  experimentOn,
  experimentsIn,
  NO_EXPERIMENTS,
} from "@repo/settings";
import { SETTINGS_PAGE_LIST, type SettingsView } from "@repo/settings/settings-views";
import { useQuery } from "@tanstack/react-query";
import type { RegisteredRouter, RouteIds } from "@tanstack/react-router";
import { useMemo } from "react";
import { useKeptChoice } from "./desktop/chosen-workspace.js";
import { settingsPageExperimentStands } from "./settings/settings-rows.js";
import {
  appStateNow,
  appStateQuery,
  selectSettingsHeld,
  selectStoredExperimentChoices,
} from "./use-app-state.js";
import { workspaceExperimentChoices } from "./workspace-experiments.js";

/** What a workspace's gate reads of each of the reader's workspaces: what an address's first step may name it by, and the experiments it chose. */
type GateWorkspace = Pick<Workspace, "id" | "slug" | "formerSlugs" | "experiments">;

/** The reader's workspaces before their first read lands. */
const NO_WORKSPACES: readonly GateWorkspace[] = [];

/** What the gates read: whether the account may reach Admin, its access still being read counting as may, its experiments, and whether they are read yet. */
export interface RouteAccess {
  readonly admin: boolean;
  /** The account's choices as its settings hold them, of which only its own experiments are read: a workspace experiment is its workspace's. */
  readonly experiments: ExperimentChoices;
  /** Whether the account's settings, its experiments among them, have been read; a page an experiment holds waits on the read rather than giving way. */
  readonly experimentsRead: boolean;
  /** The reader's workspaces, none before their first read lands, which a workspace's place waits on rather than giving way. */
  readonly workspaces: readonly GateWorkspace[];
  /** The step the listed workspace's address names it by, which a person's page naming none of the reader's opens under; none while none is listed. */
  readonly listed: string | undefined;
}

/** The access before the window's state is read: Admin waits on it, as a page an experiment holds waits on the settings. */
export const UNREAD_ROUTE_ACCESS: RouteAccess = {
  admin: true,
  experiments: NO_EXPERIMENTS,
  experimentsRead: false,
  workspaces: NO_WORKSPACES,
  listed: undefined,
};

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
    // Note that a reading off the state alone lists the first workspace, as the window does with none kept.
    listed: stepOf(state?.tasks?.workspaces?.[0]),
  };
}

/** The step a workspace's address names it by: its slug, or its id where an older service answered none. */
function stepOf(workspace: GateWorkspace | undefined): string | undefined {
  return workspace === undefined ? undefined : (workspace.slug ?? workspace.id);
}

/** Whether Admin may stand by main's document: an admin's, or while the account's access is still read. */
function selectAdminStands(state: AppStateSnapshot): boolean {
  return state.access.pending === true || state.access.admin === true;
}

/** The reader's workspaces as main's document holds them. */
function selectWorkspaces(state: AppStateSnapshot): readonly GateWorkspace[] {
  return state.tasks?.workspaces ?? NO_WORKSPACES;
}

/**
 * The window's access as it draws, for the router's context and the
 * window's Back and Forward alike. Note that the workspaces stand as the
 * same object while a read names the same ones, by Query's structural
 * sharing, because the task list carrying them is read again as any task
 * moves, and each new access asks the routes standing again.
 */
export function useRouteAccess(): RouteAccess {
  // Note that Admin stands before the document is read, as a reloaded Admin address waits on the access.
  const admin = useQuery({ ...appStateQuery, select: selectAdminStands }).data ?? true;
  const experiments =
    useQuery({ ...appStateQuery, select: selectStoredExperimentChoices }).data ?? NO_EXPERIMENTS;
  const experimentsRead = useQuery({ ...appStateQuery, select: selectSettingsHeld }).data === true;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? NO_WORKSPACES;
  const listed = stepOf(useKeptChoice(workspaces));
  return useMemo(
    (): RouteAccess => ({
      admin,
      experiments,
      experimentsRead,
      workspaces,
      listed,
    }),
    [admin, experiments, experimentsRead, workspaces, listed],
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

/** The experiments on in the workspace an address's first step names, else the listed one, beside the account's own. */
function experimentsAt(workspace: string | undefined, access: RouteAccess): ExperimentChoices {
  const step = workspace ?? access.listed;
  const named = step === undefined ? undefined : workspaceOfSlug(access.workspaces, step);
  return experimentsIn(
    access.experiments,
    workspaceExperimentChoices(access.workspaces, named?.id),
  );
}

/**
 * Whether a Settings page stands: every page but one an experiment holds
 * that is off, the account's own or, for a workspace experiment, that of the
 * workspace Settings stands under (`workspace`), else the listed one. It
 * waits on the account's settings, and on its workspaces, while they are
 * unread, as a reloaded address's does.
 */
export function settingsPageRouteStands(
  page: string,
  access: RouteAccess,
  workspace?: string,
): boolean {
  const view = settingsViewOfPage(page);
  if (view === undefined || !access.experimentsRead || access.workspaces.length === 0) return true;
  return settingsPageExperimentStands(view, experimentsAt(workspace, access));
}

/** Whether a task's version history stands: it is the description's, so only while the workspace its address names has Descriptions on, which waits on the reader's workspaces while they are unread. */
export function versionHistoryRouteStands(access: RouteAccess, workspace: string): boolean {
  return (
    access.workspaces.length === 0 ||
    experimentOn(experimentsAt(workspace, access), EXPERIMENT.DESCRIPTIONS)
  );
}

/** The places the router alone says the window stands on, rather than the window's state: Settings, Admin, a workspace's Board, a person's page, the Automations pages, a task's version history, and the Inbox. */
export const ROUTED_PLACE = {
  SETTINGS: "settings",
  ADMIN: "admin",
  BOARD: "board",
  PERSON: "person",
  AUTOMATIONS: "automations",
  VERSION_HISTORY: "version-history",
  INBOX: "inbox",
} as const;

export type RoutedPlace = (typeof ROUTED_PLACE)[keyof typeof ROUTED_PLACE];

/** Each routed place's routes, by id, under whichever parent it stands (`panel-router.tsx`). */
const ROUTED_ROUTES = {
  "/$workspace/settings": ROUTED_PLACE.SETTINGS,
  "/app/settings": ROUTED_PLACE.SETTINGS,
  "/places/$workspace/admin": ROUTED_PLACE.ADMIN,
  "/places/$workspace/tasks": ROUTED_PLACE.BOARD,
  "/places/$workspace/person/$userId": ROUTED_PLACE.PERSON,
  "/places/$workspace/automation-pages": ROUTED_PLACE.AUTOMATIONS,
  "/version-history": ROUTED_PLACE.VERSION_HISTORY,
  "/places/$workspace/inbox": ROUTED_PLACE.INBOX,
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
  const workspace = matches.find((match) => match.params.workspace !== undefined)?.params.workspace;
  if (place === ROUTED_PLACE.VERSION_HISTORY) {
    return workspace === undefined || versionHistoryRouteStands(access, workspace);
  }
  if (
    place === ROUTED_PLACE.BOARD ||
    place === ROUTED_PLACE.PERSON ||
    place === ROUTED_PLACE.AUTOMATIONS ||
    place === ROUTED_PLACE.INBOX
  ) {
    return workspace === undefined || workspaceRouteStands(workspace, access);
  }
  if (place !== ROUTED_PLACE.SETTINGS) return true;
  const page = matches.find((match) => match.params.page !== undefined)?.params.page;
  return page === undefined || settingsPageRouteStands(page, access, workspace);
}
