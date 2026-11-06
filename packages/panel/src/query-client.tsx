/**
 * query-client.tsx -- the window's one TanStack Query client, and the provider every client mounts above the panel so its surfaces share it.
 *
 * There is one per window, as there is one registry (`renderer-runtime.ts`):
 * every window is its own document loading the one bundle, so each evaluates
 * this module once and holds the client it makes, created outside any
 * component as the docs' Quick Start creates it. The desktop's window root,
 * the web tab's root, and the web app's own pages mount `QueryProvider`.
 *
 * What the panel reads the host pushes to it, so the client's defaults
 * (`defaultOptions`) turn off the refetches the docs' Important Defaults
 * list: a query is not read again when the window regains focus (the
 * Window Focus Refetching guide's `refetchOnWindowFocus: false`) or when
 * the network reconnects (`refetchOnReconnect: false`). Nothing polls,
 * since `refetchInterval` is off by default and left so.
 *
 * Every query and mutation goes to the host over the window's port rather
 * than reaching the network itself, and the host holds what it cannot send
 * while offline, so both run in the Network Mode guide's
 * `networkMode: "always"`: none pauses for the browser's online mark, which
 * reads true while the service is unreachable often enough to mean nothing
 * here.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** The window's one client, which a push writes into with `setQueryData` and every surface reads through. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      networkMode: "always",
    },
  },
});

/** `children` on the window's one client: mounted once at each root, above the panel and the web app's own pages. */
export function QueryProvider({ children }: { readonly children: ReactNode }): ReactNode {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
