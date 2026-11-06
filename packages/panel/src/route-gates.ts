import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { type ExperimentChoices, NO_EXPERIMENTS } from "@repo/settings";
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
  useAdminAccess,
  useAdminAccessPending,
  useExperimentChoices,
} from "./use-app-state.js";

type GateWorkspace = Pick<Workspace, "id" | "slug" | "formerSlugs">;

const NO_WORKSPACES: readonly GateWorkspace[] = [];

export interface RouteAccess {
  readonly admin: boolean;
  readonly experiments: ExperimentChoices;
  readonly experimentsRead: boolean;
  readonly workspaces: readonly GateWorkspace[];
  readonly listed: string | undefined;
}

export const UNREAD_ROUTE_ACCESS: RouteAccess = {
  admin: true,
  experiments: NO_EXPERIMENTS,
  experimentsRead: false,
  workspaces: NO_WORKSPACES,
  listed: undefined,
};

export function routeAccessNow(): RouteAccess {
  const state = appStateNow();
  const access = state?.access;
  return {
    admin: access === undefined || access.pending === true || access.admin === true,
    experiments: state?.settings?.experiments ?? NO_EXPERIMENTS,
    experimentsRead: state?.settings !== undefined,
    workspaces: state?.tasks?.workspaces ?? NO_WORKSPACES,
    listed: stepOf(state?.tasks?.workspaces?.[0]),
  };
}

function stepOf(workspace: GateWorkspace | undefined): string | undefined {
  return workspace === undefined ? undefined : (workspace.slug ?? workspace.id);
}

function selectWorkspaces(state: AppStateSnapshot): readonly GateWorkspace[] {
  return state.tasks?.workspaces ?? NO_WORKSPACES;
}

export function useRouteAccess(): RouteAccess {
  const admin = useAdminAccess();
  const adminPending = useAdminAccessPending();
  const experiments = useExperimentChoices();
  const experimentsRead = useQuery({ ...appStateQuery, select: selectSettingsHeld }).data === true;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? NO_WORKSPACES;
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

export function workspaceRouteStands(workspace: string, access: RouteAccess): boolean {
  return (
    access.workspaces.length === 0 || workspaceOfSlug(access.workspaces, workspace) !== undefined
  );
}

export function adminRouteStands(access: RouteAccess): boolean {
  return access.admin;
}

export function settingsViewOfPage(page: string): SettingsView | undefined {
  return SETTINGS_PAGE_LIST.find((view) => view === page);
}

export function settingsPageRouteStands(page: string, access: RouteAccess): boolean {
  const view = settingsViewOfPage(page);
  if (view === undefined || !access.experimentsRead) return true;
  return settingsPageExperimentStands(view, access.experiments);
}

export const ROUTED_PLACE = {
  SETTINGS: "settings",
  ADMIN: "admin",
  BOARD: "board",
  PERSON: "person",
  AUTOMATIONS: "automations",
} as const;

export type RoutedPlace = (typeof ROUTED_PLACE)[keyof typeof ROUTED_PLACE];

const ROUTED_ROUTES = {
  "/$workspace/settings": ROUTED_PLACE.SETTINGS,
  "/app/settings": ROUTED_PLACE.SETTINGS,
  "/places/$workspace/admin": ROUTED_PLACE.ADMIN,
  "/places/$workspace/tasks": ROUTED_PLACE.BOARD,
  "/places/$workspace/person/$userId": ROUTED_PLACE.PERSON,
  "/places/$workspace/automation-pages": ROUTED_PLACE.AUTOMATIONS,
} as const satisfies Partial<Record<RouteIds<RegisteredRouter["routeTree"]>, RoutedPlace>>;

interface RouteMatchSeen {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string | undefined>>;
}

export function routedPlaceOf(matches: readonly RouteMatchSeen[]): RoutedPlace | undefined {
  for (const match of matches) {
    const place = Object.entries(ROUTED_ROUTES).find(([id]) => id === match.routeId)?.[1];
    if (place !== undefined) return place;
  }
  return undefined;
}

export function routedStands(matches: readonly RouteMatchSeen[], access: RouteAccess): boolean {
  const place = routedPlaceOf(matches);
  if (place === ROUTED_PLACE.ADMIN) return adminRouteStands(access);
  if (
    place === ROUTED_PLACE.BOARD ||
    place === ROUTED_PLACE.PERSON ||
    place === ROUTED_PLACE.AUTOMATIONS
  ) {
    const workspace = matches.find((match) => match.params.workspace !== undefined)?.params
      .workspace;
    return workspace === undefined || workspaceRouteStands(workspace, access);
  }
  if (place !== ROUTED_PLACE.SETTINGS) return true;
  const page = matches.find((match) => match.params.page !== undefined)?.params.page;
  return page === undefined || settingsPageRouteStands(page, access);
}
