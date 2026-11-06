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
export function useHistoryLocation(): HistoryLocation {
  const { history } = useRouter();
  return useSyncExternalStore(history.subscribe, () => history.location);
}

/** Where the history stands: the routed place there, where one is, and the params its routes read from the address. */
export interface RoutedLocation {
  readonly place: RoutedPlace | undefined;
  readonly href: string;
  readonly params: Readonly<Record<string, string | undefined>>;
}

/** The routed place the history stands on, and its params. */
export function useRoutedLocation(): RoutedLocation {
  const router = useRouter();
  const { pathname, href } = useHistoryLocation();
  const matches = useMemo(() => router.matchRoutes(pathname), [router, pathname]);
  return useMemo(
    () => ({
      place: routedPlaceOf(matches),
      href,
      params: matches.at(-1)?.params ?? {},
    }),
    [matches, href],
  );
}
