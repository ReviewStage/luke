/**
 * clients-procedures.ts -- the outside MCP clients a member allowed, as Settings › Integrations reads them and revokes one.
 *
 * A client a member allowed holds their consent and the tokens minted on
 * it, in the OAuth provider's own tables. The read lists the member's
 * consents for every client but the desktop's, on the account's bearer,
 * through Drizzle (`oauth-grants.ts`), since every endpoint of the
 * provider's that lists them takes a session. The revoke runs under the
 * Mac's session, since it deletes the consent through the provider's own
 * `delete-consent` (`client-consents.ts`): it deletes the client's tokens
 * for the member first, which the provider exports nothing to do and a
 * refresh never checks the consent behind, so a refresh after it is
 * refused; then the consent, so the client's next sign-in asks again.
 * Note that the order is what keeps a revoke that failed between the two
 * honest: it answers a failure, the client still stands in the list with
 * its consent, and the revoke asked again deletes what is left. A revoke
 * of a client the member never allowed, or of the desktop's, deletes
 * nothing, and every revoke answers the clients as they then stand.
 */

import { listOAuthGrants, revokeOAuthClientTokens } from "@repo/database/models/oauth-grants";
import type { McpClient, McpClientsAnswer } from "@repo/features/mcp-client-wire";
import { Effect } from "effect";
import { DESKTOP_OAUTH_CLIENT } from "../auth/oauth-clients.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, sessionMiddleware } from "../orpc/base.js";
import type { ClientConsentDelete } from "./client-consents.js";

/** The clients no member revokes here: the desktop's own, which signs the Mac in. */
const FIRST_PARTY_CLIENTS: readonly string[] = [DESKTOP_OAUTH_CLIENT.id];

export interface McpClientsProcedureSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  /** Deletes the Allow the session's member gave one client. */
  deleteClientConsent: ClientConsentDelete;
  /** The member MCP server's address on this deployment, which a client is pointed at. */
  memberMcpServerUrl: string;
}

/** The member's clients as the wire carries them, with the server's address. */
function clientsOf(userId: string, serverUrl: string) {
  return Effect.map(
    hostedStoreOrUnavailable(listOAuthGrants(userId, FIRST_PARTY_CLIENTS)),
    (grants): McpClientsAnswer => ({
      serverUrl,
      clients: grants.map(
        (grant): McpClient => ({
          clientId: grant.clientId,
          name: grant.name,
          redirectUris: grant.redirectUris,
          allowedAt: grant.allowedAt?.getTime() ?? null,
          lastRefreshedAt: grant.lastRefreshedAt?.getTime() ?? null,
        }),
      ),
    }),
  );
}

/**
 * The consent's delete, its failure as the procedure answers it: a session
 * the provider refused as unauthenticated, which the Mac answers by asking
 * for a new one and revoking again, and anything else unavailable.
 */
function consentDeletedOrRefusal(
  deleted: ReturnType<ClientConsentDelete>,
): Effect.Effect<void, HostedRefusal> {
  return deleted.pipe(
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
      // A failure that is not a refusal is logged by its kind alone, since what it threw may quote a request.
      if (failure._tag === "UnknownError") {
        return Effect.andThen(
          Effect.logWarning("MCP client consent delete failed: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        );
      }
      return Effect.fail(
        failure.status === HOSTED_HTTP_STATUS.UNAUTHORIZED
          ? HOSTED_REFUSAL.INVALID_TOKEN
          : HOSTED_REFUSAL.UNAVAILABLE,
      );
    }),
  );
}

/** The resource: the read to the account's bearer, the revoke to the Mac's session. */
export function mcpClientsProcedures(seams: McpClientsProcedureSeams) {
  const signedIn = hosted.mcpClients.use(accountMiddleware(seams.resolveUserId));
  const inSession = hosted.mcpClients.use(sessionMiddleware(seams.resolveSessionUserId));
  return {
    list: signedIn.list.effect(function* ({ context }) {
      return yield* clientsOf(context.userId, seams.memberMcpServerUrl);
    }),
    revoke: inSession.revoke.effect(function* ({ context, input }) {
      const clientId = input.query.clientId;
      if (!FIRST_PARTY_CLIENTS.includes(clientId)) {
        yield* hostedStoreOrUnavailable(revokeOAuthClientTokens(context.userId, clientId));
        yield* consentDeletedOrRefusal(seams.deleteClientConsent(context.sessionHeaders, clientId));
      }
      return yield* clientsOf(context.userId, seams.memberMcpServerUrl);
    }),
  };
}
