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

export function useMutationAct(action: () => Promise<ActionResult>): ConfirmAct {
  const { mutateAsync, isPending, data, reset } = useMutation({ mutationFn: action });
  return {
    run: () => mutateAsync(),
    busy: isPending,
    refused: isPending ? undefined : data,
    reset,
  };
}

export function onQueryClient(element: ReactNode): ReactElement {
  return createElement(QueryClientProvider, { client: new QueryClient() }, element);
}

const NOTIFY_ROUNDS = 3;

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
