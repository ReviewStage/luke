import { type HistoryLocation, useRouter } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import { type RoutedPlace, routedPlaceOf } from "./route-gates.js";

function useHistoryLocation(): HistoryLocation {
  const { history } = useRouter();
  return useSyncExternalStore(history.subscribe, () => history.location);
}

export interface RoutedLocation {
  readonly place: RoutedPlace | undefined;
  readonly href: string;
  readonly leaf: string | undefined;
  readonly params: Readonly<Record<string, string | undefined>>;
}

export function pathUnder(pathname: string, workspace: string): string {
  const [, , ...rest] = pathname.split("/");
  return ["", encodeURIComponent(workspace), ...rest].join("/");
}

export function useRoutedLocation(): RoutedLocation {
  const router = useRouter();
  const { pathname, href } = useHistoryLocation();
  const matches = useMemo(() => router.matchRoutes(pathname), [router, pathname]);
  return useMemo(
    () => ({
      place: routedPlaceOf(matches),
      href,
      leaf: matches.at(-1)?.routeId,
      params: matches.at(-1)?.params ?? {},
    }),
    [matches, href],
  );
}
