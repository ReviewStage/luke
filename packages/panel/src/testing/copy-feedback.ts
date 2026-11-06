/**
 * copy-feedback.ts -- what a test of a surface stands on: the renderer's atoms under a registry the test supplies, and a TanStack Query client of the test's own.
 *
 * The client is made afresh before each test and cleared after it, as the
 * docs' Testing guide makes one per test with `retry: false`, so no test
 * reads what another cached and a failed read shows at once. One client
 * stands for the whole test, so a surface drawn again keeps its cache.
 * Query tells its observers on a timer of its own (`notifyManager`'s
 * scheduler, a `setTimeout` of zero by default), which a test's `act` does
 * not wait on, so here it tells them on a microtask instead, and an answer
 * a test lets land is drawn by the `act` that let it.
 */

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach } from "vitest";

/** A client as the Testing guide makes one: a failed read is not tried again. */
function freshQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

notifyManager.setScheduler(queueMicrotask);

let testQueryClient = freshQueryClient();

beforeEach(() => {
  testQueryClient = freshQueryClient();
});

afterEach(() => {
  testQueryClient.clear();
});

/** `element` under `registry` and the test's Query client, as the window's root provides its own. */
export function onRegistry(
  registry: AtomRegistry.AtomRegistry,
  element: ReactElement,
): ReactElement {
  return createElement(
    RegistryContext.Provider,
    { value: registry },
    createElement(QueryClientProvider, { client: testQueryClient }, element),
  );
}
