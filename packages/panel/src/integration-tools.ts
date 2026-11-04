import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import { integrationConnectionOf } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { useCallback, useMemo } from "react";
import { useSteadyDoors } from "./steady-door.js";
import { HOST_READ_STATUS, type IntegrationServer, useHostReads } from "./use-host-read.js";

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

/** The server a connection's name stands for, as its read is held; none for a name this build cannot read. */
function serverOf(name: string): IntegrationServer | undefined {
  const provider = integrationConnectionOf(name)?.provider;
  if (provider === undefined) return undefined;
  return name === provider ? { provider } : { provider, connection: name };
}

/** The name a server's read stands under, its account's where it names one, else its provider's. */
function nameOf(server: IntegrationServer): string {
  return server.connection ?? server.provider;
}

/** The tools read of every server in `connected` (an account by its connection name, or a provider), held while the caller is drawn. */
export function useIntegrationTools(connected: readonly string[]): IntegrationToolsReads {
  return useIntegrationToolReads(connected).reads;
}

/** `useIntegrationTools`, with the Retry a surface that says a read failed offers beside it. */
export function useIntegrationToolReads(connected: readonly string[]): IntegrationToolReads {
  // Note that the servers are handed on as one array while they name the same accounts, so a draw that changed none holds none anew.
  const servers = useSteadyDoors(
    connected.flatMap((name) => {
      const server = serverOf(name);
      return server === undefined ? [] : [server];
    }),
  );
  const { readOf, retry } = useHostReads(LIVE_READ.INTEGRATION_TOOLS, servers);
  const reads = useMemo(
    () =>
      Object.fromEntries(
        servers.flatMap((server): [string, IntegrationToolsView][] => {
          const { rows, status } = readOf(server);
          if (rows !== undefined) return [[nameOf(server), rows]];
          return status === HOST_READ_STATUS.FAILED ? [[nameOf(server), UNANSWERED]] : [];
        }),
      ),
    [servers, readOf],
  );
  const retryServer = useCallback(
    (name: string) => {
      const server = servers.find((each) => nameOf(each) === name);
      if (server !== undefined) retry(server);
    },
    [servers, retry],
  );
  return { reads, retry: retryServer };
}
