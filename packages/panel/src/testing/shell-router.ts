/**
 * shell-router.ts -- the window's shell in a test, drawn under a router with the props the test hands it; `panel-router.test.ts` holds the production route tree, which this is not.
 *
 * The shell draws what stands past its gates through the router's `Outlet`
 * (`desktop-shell.tsx`), so a test of it stands it under a router too: a
 * root drawing the shell under test, the places beside the sidebar
 * (`ShellPlaces`) with what the window's state says in their slot
 * (`StatePlace`), and the routed places, Settings and Admin, as their own
 * lazy modules and frames draw them. It is built from TanStack Router's own
 * routes over the same components `panel-router.tsx` mounts, rather than
 * the window's router, whose root is `App`, so the test's props are what
 * the shell draws from. It holds the shell, the places layout, and the
 * moved routes alone, so it is no second tree to drift from the window's.
 * The history is a memory one at `at`.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createContext, createElement, type ReactElement, useContext } from "react";
import {
  AdminRouteLoading,
  SettingsRouteLoading,
  ShellPlaces,
  StatePlace,
} from "../desktop/desktop-shell.js";
import { LAZY_ROUTE } from "../panel-router.js";
import { routeAccessNow } from "../route-gates.js";

/** Where a shell under test stands: a place its state says, Settings's list or a page of it, or Admin. */
export const SHELL_AT = {
  PLACES: "/app",
  SETTINGS: "/app/settings",
  ADMIN: "/acme/admin",
} as const;

/** The shell a test draws, handed to the router's root as it is drawn, so a shell drawn again with new props holds. */
const ShellElement = createContext<ReactElement | null>(null);

function ShellRoot(): ReactElement | null {
  return useContext(ShellElement);
}

/** A router to draw a shell under, and the way to draw it there, standing at `at`, a Settings page's address among them. */
export interface ShellRouter {
  readonly draw: (shell: ReactElement, at?: string) => ReactElement;
  readonly router: AnyRouter;
}

/** A router over the shell, the places, and the routed places, standing at `at`. */
export function shellRouter(at: string = SHELL_AT.PLACES): ShellRouter {
  const root = createRootRoute({ component: ShellRoot });
  const places = createRoute({ getParentRoute: () => root, id: "places", component: ShellPlaces });
  const stateRoute = createRoute({
    getParentRoute: () => places,
    path: SHELL_AT.PLACES,
    component: StatePlace,
  });
  const admin = createRoute({
    getParentRoute: () => places,
    path: "/$workspace/admin",
    pendingComponent: AdminRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() => import("../desktop/admin-route.lazy.js").then((loaded) => loaded.adminLazyRoute));
  const settings = createRoute({
    getParentRoute: () => root,
    path: SHELL_AT.SETTINGS,
    pendingComponent: SettingsRouteLoading,
    ...LAZY_ROUTE,
  }).lazy(() =>
    import("../desktop/settings-route.lazy.js").then((loaded) => loaded.appSettingsLazyRoute),
  );
  const settingsPage = createRoute({ getParentRoute: () => settings, path: "$page" });
  const router = createRouter({
    routeTree: root.addChildren([
      places.addChildren([stateRoute, admin]),
      settings.addChildren([settingsPage]),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { queryClient: new QueryClient(), access: routeAccessNow() },
  });
  return {
    router,
    draw: (shell, to) => {
      if (to !== undefined && router.history.location.href !== to)
        void router.navigate({ href: to });
      return createElement(
        ShellElement,
        { value: shell },
        createElement(RouterProvider, { router }),
      );
    },
  };
}
