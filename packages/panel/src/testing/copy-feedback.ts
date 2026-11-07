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
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  act,
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
} from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { LiveReadSubscription } from "../live-reads.js";
import { appStateQuery, followAppState } from "../use-app-state.js";

/**
 * A client as the Testing guide makes one, a failed read not tried again,
 * sending as the window's does whatever the online mark says.
 * Note that no reader fetches the document's query here, because a case
 * that seeds it with `setQueryData` draws on what it seeded until the test's
 * subscription (`followAppState`) writes what it reads, and a case
 * that waits on the window's first read asks for it itself (`readAppState`).
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
 * would each write what they read, and the later write would stand over
 * the one the test meant.
 */
function TestAppStateSubscription(): null {
  if (useContext(OnTestClient)) {
    throw new Error("withQueryClient is nested in another: draw the tree through one.");
  }
  const client = useQueryClient();
  useEffect(() => {
    const following = followAppState(client);
    // A tree draws nothing that waits on the first read, so one refused is told as a window's later one is, and the next delivery asks again.
    following.written.catch((cause: unknown) => {
      console.error("The window's state could not be read; the next delivery asks again.", cause);
    });
    return following.stop;
  }, [client]);
  return null;
}

/**
 * `element` on the test's Query client, with the document's one subscription
 * (`followAppState`) writing each reading of the bridge into that
 * client, and the live reads' (`LiveReadSubscription`)
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

/**
 * Waits until no write of the test's client is out, and the answers its
 * callers read have landed, as a plan's saves sent while it was left do:
 * for a teardown that disposes the atoms those answers write into.
 */
export async function settledWrites(): Promise<void> {
  await vi.waitFor(() => {
    if (testQueryClient.isMutating() > 0) throw new Error("A write is still out.");
  });
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
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
 * Reads the document into the test's Query client as the window's root does,
 * with `ensureQueryData`: the bridge's document, staged in a fixture run. For
 * a case that waits on the window's first read before it draws.
 */
export function readAppState(): Promise<AppStateSnapshot> {
  return testQueryClient.ensureQueryData(appStateQuery);
}

/**
 * Writes the document the window's bridge hands into the test's Query client,
 * as the window's root reads it with `ensureQueryData` before anything is
 * drawn: for a case that reads a surface once, so its first frame holds the
 * account and the run the bridge hands rather than none.
 */
export async function writeHandedAppState(): Promise<void> {
  writeAppState(await appBridge().requestAppState());
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

/** The platform's own `setTimeout`, as this module loads before any test fakes it, which the notify queue runs on. */
const PLATFORM_SET_TIMEOUT = globalThis.setTimeout;

/** How many rounds of TanStack Query's notifications a settle waits out, since a notification drawn may lay a read that notifies in turn. */
const NOTIFY_ROUNDS = 3;

/**
 * Waits until every notification TanStack Query has queued has reached the
 * surfaces observing it, round after round, `between` running after each:
 * what a live read laid on the document is drawn one notify tick later, so a
 * test that acts step after step on what each page or push left settles
 * here rather than racing it. Note that the wait joins the notify manager's
 * own queue (`notifyManager.schedule`) rather than a timer of its own, so it
 * holds whatever that queue's scheduler is, and that a test faking
 * `setTimeout` waits on nothing here, since the queue runs on its faked
 * clock; one faking `Date` alone still waits.
 */
export async function settleQueries(between?: () => Promise<void>): Promise<void> {
  if (globalThis.setTimeout !== PLATFORM_SET_TIMEOUT) return;
  for (let round = 0; round < NOTIFY_ROUNDS; round += 1) {
    const notified = Promise.withResolvers<void>();
    notifyManager.schedule(() => notified.resolve());
    await act(() => notified.promise);
    await between?.();
  }
}

/**
 * Starts the test's Query client afresh partway through a test, as each
 * test's own starts: for a case that draws several worlds in turn, each of
 * which must read only the reads its own world laid, never one the last
 * world's surface left cached.
 */
export function startQueriesAfresh(): void {
  testQueryClient.clear();
  testQueryClient = freshQueryClient();
}
