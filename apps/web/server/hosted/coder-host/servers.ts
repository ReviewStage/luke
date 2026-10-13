/**
 * servers.ts -- whether a coding agent's turn is handed one MCP server, read from the agent's row as the turn starts.
 *
 * The developer switches an integration's MCP server off for one agent from
 * its composer, which writes the agent's `disabled_servers`
 * (`coding-agent-store.ts`). eve's static connection has no switch of its
 * own, so each of the coding agent's `connections/<provider>.ts`, the root's
 * and its worker's, is a dynamic connection resolved at `turn.started`: the
 * provider's connection while the agent has it on, and none while it is
 * off. A turn already running keeps what it was handed, and eve tells the
 * model at its next step when a connection came or went. The worker's
 * session is admitted for its parent's conversation, so it follows its
 * parent agent's switch.
 *
 * The read fails closed: a turn whose row could not be read is handed no
 * server, so one the developer switched off never comes back on through a
 * passing store failure, and the turn carries on without it. A resolver that
 * threw would fail the whole turn instead, which is why nothing here throws.
 * The log line keeps the failure's kind alone, since a store failure's
 * message may name a statement.
 */

import { readCodingAgentOfConversation } from "@sidecar/database/models/coding-agent-store";
import type { IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { causeKind } from "@sidecar/runtime/effect";
import { Effect, Option, Result, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  defineDynamic,
  defineMcpClientConnection,
  type McpClientConnectionDefinition,
} from "eve/connections";
import type { SessionAuth } from "eve/context";
import type { ConversationAdmission } from "../brain-host/conversation.js";

/** Whether a turn is handed the server: on, under the account it is credentialed for, or off. */
export type ServerStanding =
  | { readonly on: true; readonly account: string }
  | { readonly on: false };

const SERVER_OFF: ServerStanding = { on: false };

/** How the session a turn runs in is admitted: the root's own standing, or a worker's ownership alone. */
type ServerAdmission = Effect.Effect<
  ConversationAdmission,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
>;

/**
 * Whether the agent the session was admitted for has the provider's server
 * on for the turn starting: on unless its row lists the provider, and off
 * for a session admitted for no agent or a row that could not be read.
 */
export function turnServer(
  admission: ServerAdmission,
  provider: IntegrationProvider,
): Effect.Effect<ServerStanding, never, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const admitted = yield* admission;
    if (Result.isFailure(admitted)) return SERVER_OFF;
    const { userId, conversationId } = admitted.success.target;
    const agent = yield* readCodingAgentOfConversation(userId, conversationId);
    if (Option.isNone(agent) || agent.value.disabledServers.includes(provider)) return SERVER_OFF;
    return { on: true, account: userId } satisfies ServerStanding;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(
          `the ${provider} server was left out of the turn, its agent unread: ${causeKind(cause)}`,
        ),
        SERVER_OFF,
      ),
    ),
  );
}

/** How an agent's edge reads the standing for one session: its own admission, run where the edge runs effects. */
export type ServerStandingRead = (auth: SessionAuth, sessionId: string) => Promise<ServerStanding>;

/**
 * The connection one of the coding agent's files registers: the provider's
 * own definition for a turn the agent has the server on, keyed by the
 * account eve credentials it for, and none for a turn it is off.
 */
export function switchableConnection(
  read: ServerStandingRead,
  connection: McpClientConnectionDefinition,
) {
  return defineDynamic({
    events: {
      "turn.started": async (_event, ctx) => {
        const standing = await read(ctx.session.auth, ctx.session.id);
        if (!standing.on) return null;
        return defineMcpClientConnection({ ...connection, instanceKey: standing.account });
      },
    },
  });
}
