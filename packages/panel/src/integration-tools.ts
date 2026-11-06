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

/**
 * integration-tools.ts -- what each connected integration's server answered when asked for its tools, held for as long as a surface that draws it is drawn.
 *
 * The host holds each server's tools while a surface lists it
 * (`LIVE_READ.INTEGRATION_TOOLS`), asking as it is first held and again
 * whenever a window comes forward, which is how the developer comes back
 * from mending a connection in the browser; never polled otherwise. The
 * service holds a list it read for a few minutes, so a read again costs a
 * working server nothing, and holds no refusal, so a mended one reads as
 * mended. Each read stands until the next one answers, so a surface does
 * not blink back to checking, and one held lately draws at once; a read
 * that never answered is asked again on a press of Retry, which stands it
 * back at checking until the next answer. What a read means for the row is
 * `integration-health.ts`'s to say.
 */

/** What each server's tools read answered so far, by its name; a server absent here has not answered yet. */
export type IntegrationToolsReads = Readonly<Record<string, IntegrationToolsView>>;

const UNANSWERED: IntegrationToolsView = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };

/** The reads of every connected server, and the way to ask one server again. */
export interface IntegrationToolReads {
  readonly reads: IntegrationToolsReads;
  /** Asks one server for its tools again, standing its read at checking until it answers. */
  readonly retry: (server: string) => void;
}

/** The tools read of every server in `connected` (an account by its connection name, or a provider), held while the caller is drawn. */
export function useIntegrationTools(connected: readonly string[]): IntegrationToolsReads {
  return useIntegrationToolReads(connected).reads;
}

/** `useIntegrationTools`, with the Retry a surface that says a read failed offers beside it. */
export function useIntegrationToolReads(connected: readonly string[]): IntegrationToolReads {
  // Note that a server's read stands under its connection's name, its provider's for the provider's first account.
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
