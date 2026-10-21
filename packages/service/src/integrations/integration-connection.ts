/**
 * integration-connection.ts -- the one connection per integration every agent of Luke's is handed.
 *
 * The brain, the coding agent, and each one's declared worker
 * are four eve agents, and each is handed this definition for every
 * integration a turn has on (`agent-runtime/connections.ts`), over its
 * provider and that agent's own ownership check, the root's or the
 * delegated one, and nothing else.
 *
 * A connection is the provider's own hosted MCP server, every tool it lists,
 * and no approval: a write runs the moment the model calls it, as the plan
 * decided. Its credential is the account's, read from Vercel Connect under
 * the user id the ownership check admitted, never the session's principal:
 * a spoken brain turn runs as the deployment acting for the account, and
 * eve's own user-scoped auth would refuse it before reading any token. So
 * the auth here is eve's plain `getToken` form, credentialed as the app, and
 * the account is chosen inside it. That form has no interactive half, so
 * eve never parks a turn on a sign-in: sign-in happens in Luke's account
 * settings, before any run.
 *
 * A connection that cannot be used fails only the call that tried it: the
 * token read (`integration-token.ts`) answers one of its fixed sentences,
 * which is thrown here and eve reports as that call's error, and every
 * other tool, and the run, carries on.
 *
 * eve opens a connection's client once a model step and reuses it for the
 * rest of that step, so the account's row is read at each opening: a
 * Disconnect takes effect from the next step, whatever the SDK cached.
 *
 * Linear is handed once under the provider's own name where the
 * conversation's workspace connected it for every member
 * (`../agents/agent-runtime/servers.ts`), and its calls then run on the
 * workspace's grant (`integration-token.ts`).
 */

import type { IntegrationProvider } from "@luke/features/integration-wire";
import { Result } from "effect";
import { defineMcpClientConnection, type McpClientConnectionDefinition } from "eve/connections";
import type { SessionAuth } from "eve/context";
import type { IntegrationTokenAnswer } from "./integration-token.js";
import { INTEGRATION, type IntegrationDefinition } from "./integrations.js";

/** How an agent's edge reads one account's token for one session: its own admission, run where the edge runs effects. */
export type IntegrationTokenRead = (
  auth: SessionAuth,
  sessionId: string,
) => Promise<IntegrationTokenAnswer>;

/**
 * The connection one agent registers for one account at a provider, over
 * the token read its edge composed with that agent's ownership check. Its
 * description is the provider's own, and, where the provider hands more
 * than one account, which account this is: a developer with one account per
 * provider is told exactly what they were before. The read runs inside
 * eve's turn, given the session the connection is opened under; a refusal is
 * thrown as its sentence, which is the call's error and nothing more.
 */
export function integrationConnection(
  account: { readonly provider: IntegrationProvider; readonly accountNote?: string },
  read: IntegrationTokenRead,
): McpClientConnectionDefinition {
  const definition: IntegrationDefinition = INTEGRATION[account.provider];
  return defineMcpClientConnection({
    url: definition.MCP_URL,
    description:
      account.accountNote === undefined
        ? definition.DESCRIPTION
        : `${definition.DESCRIPTION} ${account.accountNote}`,
    auth: (ctx) => ({
      credentialOwner: "app",
      getToken: async () => {
        const answer = await read(ctx.session.auth, ctx.session.id);
        if (Result.isFailure(answer)) throw new Error(answer.failure);
        return answer.success;
      },
    }),
  });
}
