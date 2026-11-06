import { RegistryContext } from "@effect/atom-react/RegistryContext";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  act,
  createContext,
  createElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { LiveReadSubscription } from "../live-reads.js";
import { AppStateSubscription, appStateQuery } from "../use-app-state.js";

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

let heldForFile: AppStateSnapshot | undefined;

let testQueryClient = freshQueryClient();

beforeEach(() => {
  testQueryClient = freshQueryClient();
});

afterEach(() => {
  testQueryClient.clear();
});

const OnTestClient = createContext(false);

function TestAppStateSubscription(): ReactElement {
  if (useContext(OnTestClient)) {
    throw new Error("withQueryClient is nested in another: draw the tree through one.");
  }
  return createElement(AppStateSubscription);
}

export function withQueryClient(element: ReactNode): ReactElement {
  return createElement(
    QueryClientProvider,
    { client: testQueryClient },
    createElement(TestAppStateSubscription),
    createElement(LiveReadSubscription),
    createElement(OnTestClient.Provider, { value: true }, element),
  );
}

export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, withQueryClient(element));
}

export async function settledWrites(): Promise<void> {
  await vi.waitFor(() => {
    if (testQueryClient.isMutating() > 0) throw new Error("A write is still out.");
  });
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
}

export function testQueryClientNow(): QueryClient {
  return testQueryClient;
}

export function writeAppState(document: AppStateSnapshot): void {
  testQueryClient.setQueryData(appStateQuery.queryKey, document);
}

export async function writeHandedAppState(): Promise<void> {
  writeAppState(await appBridge().requestAppState());
}

export function holdAppStateForFile(document: AppStateSnapshot): void {
  heldForFile = document;
  writeAppState(document);
}

const PLATFORM_SET_TIMEOUT = globalThis.setTimeout;

const NOTIFY_ROUNDS = 3;

export async function settleQueries(between?: () => Promise<void>): Promise<void> {
  if (globalThis.setTimeout !== PLATFORM_SET_TIMEOUT) return;
  for (let round = 0; round < NOTIFY_ROUNDS; round += 1) {
    const notified = Promise.withResolvers<void>();
    notifyManager.schedule(() => notified.resolve());
    await act(() => notified.promise);
    await between?.();
  }
}

export function startQueriesAfresh(): void {
  testQueryClient.clear();
  testQueryClient = freshQueryClient();
}
