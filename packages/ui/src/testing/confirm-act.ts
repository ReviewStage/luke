/**
 * confirm-act.ts -- a confirming act held as a caller holds one, over a mutation of its own, for the confirm's own tests.
 */

import type { ActionResult } from "@repo/wire";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { vi } from "vitest";
import type { ConfirmAct } from "../confirm-state.js";

/** The act `action` sends, held as a `useMutation` whose answer is the act's own answer. */
export function useMutationAct(action: () => Promise<ActionResult>): ConfirmAct {
  const { mutateAsync, isPending, data, reset } = useMutation({ mutationFn: action });
  return {
    run: () => mutateAsync(),
    busy: isPending,
    refused: isPending ? undefined : data,
    reset,
  };
}

/** `element` on a Query client of its own, as a window's root provides one. */
export function onQueryClient(element: ReactNode): ReactElement {
  return createElement(QueryClientProvider, { client: new QueryClient() }, element);
}

/** How many rounds of TanStack Query's notifications a settle waits out, since a notification drawn may lay one in turn. */
const NOTIFY_ROUNDS = 3;

/**
 * Answers the oldest act still out with `result` once its mutation has sent
 * it, then waits until every notification TanStack Query queued has reached
 * what it draws, joining the notify manager's own queue rather than a timer.
 */
export async function answerOldest<Result>(
  answers: ((result: Result) => void)[],
  result: Result,
): Promise<void> {
  await vi.waitFor(() => {
    if (answers.length === 0) throw new Error("no answer pending");
  });
  const answer = answers.shift();
  await act(async () => answer?.(result));
  for (let round = 0; round < NOTIFY_ROUNDS; round += 1) {
    const notified = Promise.withResolvers<void>();
    notifyManager.schedule(() => notified.resolve());
    await act(() => notified.promise);
  }
}
