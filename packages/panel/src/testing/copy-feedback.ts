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
import { createContext, createElement, type ReactElement, type ReactNode, useContext } from "react";
import { afterEach, beforeEach } from "vitest";
import { LiveReadSubscription } from "../live-reads.js";
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

/** Whether a tree already stands on the test's client, so a second `withQueryClient` inside it is caught. */
const OnTestClient = createContext(false);

/**
 * The document's one subscription for the tree, refused under another: two
 * would each write their own registry's document, and the later write would
 * stand over the one the test meant.
 */
function TestAppStateSubscription(): ReactElement {
  if (useContext(OnTestClient)) {
    throw new Error("withQueryClient is nested in another: draw the tree through one.");
  }
  return createElement(AppStateSubscription);
}

/**
 * `element` on the test's Query client, with the document's one subscription
 * (`AppStateSubscription`) writing each reading of the registry it stands
 * under into that client, and the live reads' (`LiveReadSubscription`)
 * keeping them current and followed, as the window's root does: for a test drawing
 * under the registry React provides when none is given.
 */
export function withQueryClient(element: ReactNode): ReactElement {
  return createElement(
    QueryClientProvider,
    { client: testQueryClient },
    createElement(TestAppStateSubscription),
    createElement(LiveReadSubscription),
    createElement(OnTestClient.Provider, { value: true }, element),
  );
}

/** `element` under `registry` and the test's Query client (`withQueryClient`), as the window's root provides its own. */
export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, withQueryClient(element));
}

/** The test's own Query client, for a case that looks at or changes what it keeps from outside a component, as code outside one takes the client it is handed. */
export function testQueryClientNow(): QueryClient {
  return testQueryClient;
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
