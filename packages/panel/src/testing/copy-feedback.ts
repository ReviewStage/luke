/**
 * copy-feedback.ts -- what a test of a surface stands on: the renderer's atoms under a registry the test supplies, and a TanStack Query client of the test's own.
 *
 * The client is made afresh before each test and cleared after it, as the
 * docs' Testing guide makes one per test with `retry: false`, so no test
 * reads what another cached and a failed read shows at once. One client
 * stands for the whole test, so a surface drawn again keeps its cache.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement, type ReactNode } from "react";
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
  if (heldForFile !== undefined) client.setQueryData(appStateQuery.queryKey, heldForFile);
  return client;
}

/** The document every test of this file starts its client on (`holdAppStateForFile`), none until one is held. */
let heldForFile: AppStateSnapshot | undefined;

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
export function withQueryClient(element: ReactNode): ReactElement {
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

/**
 * Writes `document` into the test's Query client, as the docs' Testing guide
 * seeds a query with `setQueryData`: for a case that draws synchronously and
 * must find the document in its first frame, before the subscription has
 * heard it from the bridge.
 */
export function writeAppState(document: AppStateSnapshot): void {
  testQueryClient.setQueryData(appStateQuery.queryKey, document);
}

/**
 * Writes `document` into the test's Query client and into every one made
 * after it in this file, for a suite that reads its document once
 * (`beforeAll`) and draws each case on it synchronously.
 */
export function holdAppStateForFile(document: AppStateSnapshot): void {
  heldForFile = document;
  writeAppState(document);
}
