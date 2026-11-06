import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import { useMutation, useQueries } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  integrationServerOf,
  integrationToolsQuery,
  integrationToolsRetryMutation,
} from "./live-reads.js";

export type IntegrationToolsReads = Readonly<Record<string, IntegrationToolsView>>;

const UNANSWERED: IntegrationToolsView = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

export interface IntegrationToolReads {
  readonly reads: IntegrationToolsReads;
  readonly retry: (server: string) => void;
}

export function useIntegrationTools(connected: readonly string[]): IntegrationToolsReads {
  return useIntegrationToolReads(connected).reads;
}

export function useIntegrationToolReads(connected: readonly string[]): IntegrationToolReads {
  const names = connected.filter((name) => integrationServerOf(name) !== undefined);
  const reads = useQueries({
    queries: names.map((name) => integrationToolsQuery(name)),
    combine: (results) =>
      Object.fromEntries(
        results.flatMap((result, at): [string, IntegrationToolsView][] => {
          const name = names[at];
          if (name === undefined) return [];
          if (result.data !== undefined) return [[name, result.data]];
          return result.isError ? [[name, UNANSWERED]] : [];
        }),
      ),
  });
  const { mutate } = useMutation(integrationToolsRetryMutation());
  const retry = useCallback(
    (name: string) => {
      const server = integrationServerOf(name);
      if (server !== undefined) mutate(server);
    },
    [mutate],
  );
  return { reads, retry };
}
