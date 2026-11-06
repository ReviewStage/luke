/**
 * routed-location.ts -- where the router's history stands, as the window's doors and its history read it to say which routed place stands.
 *
 * Note that it is read off the router's history itself rather than the
 * router's matches, because the history moves at once while the matches
 * wait on a route's chunk still on its way, and the window's history must
 * know a routed place stands from the moment its entry is written
 * (`navigation-history.ts`).
 */

import { type HistoryLocation, useRouter } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { type RoutedPlace, routedPlaceOf } from "./route-gates.js";

/** The location the router's history stands on, redrawn as it moves. */
function useHistoryLocation(): HistoryLocation {
  const { history } = useRouter();
  return useSyncExternalStore(history.subscribe, () => history.location);
}

/** Where the history stands: the routed place there, where one is, the route its address ends on, and the params its routes read from the address. */
export interface RoutedLocation {
  readonly place: RoutedPlace | undefined;
  readonly href: string;
  /** The id of the route the address ends on, the deepest it matches; none where it matches none. */
  readonly leaf: string | undefined;
  readonly params: Readonly<Record<string, string | undefined>>;
  /** The keys its query carries, each the string it is, as the router reads them (`panel-router.tsx`). */
  readonly search: Readonly<Record<string, string>>;
}

/** The same path under the workspace whose address step is `workspace`, in place of the step it names first. */
export function pathUnder(pathname: string, workspace: string): string {
  const [, , ...rest] = pathname.split("/");
  return ["", encodeURIComponent(workspace), ...rest].join("/");
}

/** The routed place the history stands on, and its params. */
export function useRoutedLocation(): RoutedLocation {
  const router = useRouter();
  const { pathname, href, search } = useHistoryLocation();
  const matches = useMemo(() => router.matchRoutes(pathname), [router, pathname]);
  return useMemo(
    () => ({
      place: routedPlaceOf(matches),
      href,
      leaf: matches.at(-1)?.routeId,
      params: matches.at(-1)?.params ?? {},
      search: Object.fromEntries(new URLSearchParams(search)),
    }),
    [matches, href, search],
  );
}
