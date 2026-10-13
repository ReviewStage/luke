/**
 * connections.ts -- every integration one agent of Luke's is handed for a turn, as one dynamic connection.
 *
 * eve hands a declared subagent none of its parent's connections, so each of
 * the four agents registers its own: one `connections/integrations.ts`, which
 * is this resolver over that agent's reads. It answers at `turn.started` with
 * a map of the provider's own connection (`../integration-connection.ts`)
 * for each server the turn is handed (`servers.ts`), each under its
 * provider's name, since eve names a map's entries by their bare keys: that
 * name is what a remote call's row is stored under (`../connection-tools.ts`).
 * A new integration is one entry in `INTEGRATION` and no new file. Each
 * connection is keyed by the account it is credentialed for, as eve asks of
 * an authenticated dynamic connection.
 */

import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import {
  defineDynamic,
  defineMcpClientConnection,
  type McpClientConnectionDefinition,
} from "eve/connections";
import { type IntegrationTokenRead, integrationConnection } from "../integration-connection.js";
import type { ServerStandingRead } from "./servers.js";

/** How one agent's edge reads what a turn is handed and each provider's token, under that agent's own admission. */
export interface ConnectionReads {
  readonly servers: ServerStandingRead;
  readonly token: (provider: IntegrationProvider) => IntegrationTokenRead;
}

/** The connection one agent's `connections/integrations.ts` registers: the servers each turn is handed, or none. */
export function integrationConnections(reads: ConnectionReads) {
  return defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        const standing = await reads.servers(ctx.session.auth, ctx.session.id);
        if (!standing.on || standing.providers.length === 0) return null;
        const { account } = standing;
        const handed: Record<string, McpClientConnectionDefinition> = Object.fromEntries(
          standing.providers.map((provider) => [
            provider,
            defineMcpClientConnection({
              ...integrationConnection(provider, reads.token(provider)),
              instanceKey: account,
            }),
          ]),
        );
        return handed;
      },
    },
  });
}
