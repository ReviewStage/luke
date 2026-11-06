/**
 * query-client.ts -- a TanStack Query client of the test's own, which a page's own surface stands on as `mountPrerenderedPage` stands it on the window's.
 *
 * Each call makes a fresh client, as the docs' Testing guide makes one per
 * test with `retry: false`, so no mount reads what another cached and a
 * failed read shows at once.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";

/** `element` on a fresh Query client. */
export function onQueryClient(element: ReactElement): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, element);
}
