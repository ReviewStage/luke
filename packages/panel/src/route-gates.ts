/**
 * route-gates.ts -- who may stand on a routed place: the one predicate per gated route, which its `beforeLoad` and the window's Back and Forward both ask.
 *
 * A route's `beforeLoad` runs only as the router goes there, so it cannot
 * say whether Back or Forward may reach an entry before they move. Each
 * gate is therefore a predicate of its own, handed what it reads, which the
 * route's `beforeLoad` asks of the router's context (`panel-router.tsx`)
 * and the window's history asks of the window's state
 * (`navigation-history.ts`'s `reachable`), so the two never disagree. Each
 * routed place's declaration names its gate (`places/routed-places.ts`).
 */

import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
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
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useMemo } from "react";
import { useKeptChoice } from "./desktop/chosen-workspace.js";
import { rendererPromise } from "./renderer-runtime.js";
import { settingsPageExperimentStands } from "./settings/settings-rows.js";
import { loadedTasksFixture } from "./tasks/tasks-fixture-loader.js";
import {
  appStateIn,
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

/** The window's access by the document `client` holds now, for a route's `beforeLoad`, which cannot wait a render. */
export function routeAccessNow(client: QueryClient): RouteAccess {
  const state = appStateIn(client);
  const access = state?.access;
  const workspaces = state === undefined ? NO_WORKSPACES : selectWorkspaces(state);
  return {
    // A reloaded Admin address waits on an access still being read rather than being refused.
    admin: access === undefined || access.pending === true || access.admin === true,
    experiments: state?.settings?.experiments ?? NO_EXPERIMENTS,
    experimentsRead: state?.settings !== undefined,
    workspaces,
    // Note that a reading off the state alone lists the first workspace, as the window does with none kept.
    listed: stepOf(workspaces[0]),
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

/** The task list the window lists from: main's document's, or a fixture run's synthetic one, which main's document holds none of. */
function listedTasksView(state: AppStateSnapshot): TasksView | undefined {
  return loadedTasksFixture()?.fixtureTasksView(state.run) ?? state.tasks;
}

/**
 * The reader's workspaces as the window lists them: main's document's, or a
 * fixture run's synthetic ones, so a fixture run's gates read what its
 * window draws.
 */
function selectWorkspaces(state: AppStateSnapshot): readonly GateWorkspace[] {
  return listedTasksView(state)?.workspaces ?? NO_WORKSPACES;
}

/**
 * Whether the account's workspaces are read by `state`: some are listed, or
 * the list's read failed. Every account holds a workspace of its own, so
 * none listed means none read yet.
 */
function selectWorkspacesRead(state: AppStateSnapshot | undefined): boolean {
  const view = state === undefined ? undefined : listedTasksView(state);
  return (view?.workspaces.length ?? 0) > 0 || view?.listStatus === TASKS_READ.FAILED;
}

/**
 * What a route waiting on the account's workspaces answers its `loader`,
 * as a link's slug is read against them (`panel-router.tsx`): nothing where
 * the document `client` holds has read them, so the route draws at once,
 * else a promise settling on the first write of the document that reads
 * them, heard on the client's query cache, the route's own frame standing
 * meanwhile. Note that the cache is let go as it answers, since a
 * callback's own cleanup runs only on an interruption.
 */
export function workspacesReadFor(
  client: QueryClient,
  signal: AbortSignal,
): Promise<void> | undefined {
  if (selectWorkspacesRead(appStateIn(client))) return undefined;
  const read = Effect.callback<void>((resume) => {
    let stop: (() => void) | undefined;
    let answered = false;
    const settle = (): void => {
      if (answered || !selectWorkspacesRead(appStateIn(client))) return;
      answered = true;
      stop?.();
      resume(Effect.void);
    };
    stop = client.getQueryCache().subscribe(settle);
    settle();
    return Effect.sync(() => stop?.());
  });
  return rendererPromise(read, signal);
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

/** The same path under the workspace whose address step is `workspace`, in place of the step it names first. */
export function pathUnder(pathname: string, workspace: string): string {
  const [, , ...rest] = pathname.split("/");
  return ["", encodeURIComponent(workspace), ...rest].join("/");
}
