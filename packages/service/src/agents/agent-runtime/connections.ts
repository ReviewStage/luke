/**
 * connections.ts -- every integration one agent of Luke's is handed for a turn, as one dynamic connection.
 *
 * eve hands a declared subagent none of its parent's connections, so each of
 * the four agents registers its own: one `connections/integrations.ts`, which
 * is this resolver over that agent's reads. It answers at `turn.started` with
 * a map of the provider's own connection (`../integration-connection.ts`)
 * for each account the turn is handed (`servers.ts`), each under its
 * connection name (`notion`, `notion-2`), since eve names a map's entries by
 * their bare keys: that name is what a remote call's row is stored under
 * (`../connection-tools.ts`). A new integration is one entry in
 * `INTEGRATION` and no new file. Each connection is keyed by the account it
 * is credentialed for, its own grant's subject, as eve asks of an
 * authenticated dynamic connection.
 */

import {
  defineDynamic,
  defineMcpClientConnection,
  type McpClientConnectionDefinition,
} from "eve/connections";
import {
  type IntegrationAccountRef,
  type IntegrationTokenRead,
  integrationConnection,
} from "../../integrations/integration-connection.js";
import type { ServerStandingRead } from "./servers.js";

/** How one agent's edge reads what a turn is handed and each account's token, under that agent's own admission. */
export interface ConnectionReads {
  readonly servers: ServerStandingRead;
  readonly token: (account: IntegrationAccountRef) => IntegrationTokenRead;
}

/** The connection one agent's `connections/integrations.ts` registers: the servers each turn is handed, or none. */
export function integrationConnections(reads: ConnectionReads) {
  return defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        const standing = await reads.servers(ctx.session.auth, ctx.session.id);
        if (!standing.on || standing.connections.length === 0) return null;
        const handed: Record<string, McpClientConnectionDefinition> = Object.fromEntries(
          standing.connections.map((connection) => [
            connection.connectionName,
            defineMcpClientConnection({
              ...integrationConnection(
                connection,
                reads.token({
                  provider: connection.provider,
                  connectionName: connection.connectionName,
                  connectSubject: connection.instanceKey,
                }),
              ),
              instanceKey: connection.instanceKey,
            }),
          ]),
        );
        return handed;
      },
    },
  });
}
