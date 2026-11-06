/**
 * copy-feedback.ts -- what a test of a surface stands on: the renderer's atoms under a registry the test supplies, and a TanStack Query client of the test's own.
 *
 * The client is made afresh before each test and cleared after it, as the
 * docs' Testing guide makes one per test with `retry: false`, so no test
 * reads what another cached and a failed read shows at once. One client
 * stands for the whole test, so a surface drawn again keeps its cache.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach } from "vitest";
import { AppStateSubscription, appStateQuery } from "../use-app-state.js";

/**
 * A client as the Testing guide makes one, a failed read not tried again,
 * sending as the window's does whatever the online mark says.
 * Note that the document's query is never fetched here, because its
 * `queryFn` reads the window's own registry rather than the test's: the
 * test's subscription (`AppStateSubscription`) writes it into this client
 * alone, as a test seeds a query with `setQueryData`.
 */
function freshQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { networkMode: "always", retry: false },
      mutations: { networkMode: "always" },
    },
  });
  client.setQueryDefaults(appStateQuery.queryKey, { enabled: false });
  return client;
}

/**
 * Note that a test's readers are told of what moved as the write lands rather
 * than on the next macrotask, Query's default (`notifyManager`), because a
 * test waits out a delivery by its promises alone, as the atoms it was
 * written against told their readers.
 */
notifyManager.setScheduler((callback) => callback());

let testQueryClient = freshQueryClient();

beforeEach(() => {
  testQueryClient = freshQueryClient();
});

afterEach(() => {
  testQueryClient.clear();
});

/**
 * `element` on the test's Query client, with the document's one subscription
 * (`AppStateSubscription`) writing each reading of the registry it stands
 * under into that client, as the window's root does: for a test drawing
 * under the registry React provides when none is given.
 */
export function withQueryClient(element: ReactElement): ReactElement {
  return createElement(
    QueryClientProvider,
    { client: testQueryClient },
    createElement(AppStateSubscription),
    element,
  );
}

/** `element` under `registry` and the test's Query client (`withQueryClient`), as the window's root provides its own. */
export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, withQueryClient(element));
}
