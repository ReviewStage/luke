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

import { type ExperimentChoices, NO_EXPERIMENTS } from "@repo/settings";
import { SETTINGS_PAGE_LIST, type SettingsView } from "@repo/settings/settings-views";
import type { RegisteredRouter, RouteIds } from "@tanstack/react-router";
import { settingsPageExperimentStands } from "./settings/settings-rows.js";
import { appStateNow } from "./use-app-state.js";

/** What the gates read: whether the account may reach Admin, its access still being read counting as may, and its experiments. */
export interface RouteAccess {
  readonly admin: boolean;
  readonly experiments: ExperimentChoices;
}

/** The window's access as it stands now, for a route's `beforeLoad`, which cannot wait a render. */
export function routeAccessNow(): RouteAccess {
  const state = appStateNow();
  const access = state?.access;
  return {
    // A reloaded Admin address waits on an access still being read rather than being refused.
    admin: access === undefined || access.pending === true || access.admin === true,
    experiments: state?.settings?.experiments ?? NO_EXPERIMENTS,
  };
}

/** Whether Admin stands: an admin's alone, or while the account's access is still read. */
export function adminRouteStands(access: RouteAccess): boolean {
  return access.admin;
}

/** The Settings page a page segment names; none for a segment naming no page. */
export function settingsViewOfPage(page: string): SettingsView | undefined {
  return SETTINGS_PAGE_LIST.find((view) => view === page);
}

/** Whether a Settings page stands: every page but one an experiment the account has off holds. */
export function settingsPageRouteStands(page: string, access: RouteAccess): boolean {
  const view = settingsViewOfPage(page);
  return view === undefined || settingsPageExperimentStands(view, access.experiments);
}

/** The places the router alone says the window stands on, rather than the window's state: Settings and Admin. */
export const ROUTED_PLACE = {
  SETTINGS: "settings",
  ADMIN: "admin",
} as const;

export type RoutedPlace = (typeof ROUTED_PLACE)[keyof typeof ROUTED_PLACE];

/** Each routed place's routes, by id, under whichever parent it stands (`panel-router.tsx`). */
const ROUTED_ROUTES = {
  "/$workspace/settings": ROUTED_PLACE.SETTINGS,
  "/app/settings": ROUTED_PLACE.SETTINGS,
  "/places/$workspace/admin": ROUTED_PLACE.ADMIN,
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
  if (place !== ROUTED_PLACE.SETTINGS) return true;
  const page = matches.find((match) => match.params.page !== undefined)?.params.page;
  return page === undefined || settingsPageRouteStands(page, access);
}
