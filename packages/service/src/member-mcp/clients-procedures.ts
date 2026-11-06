import { listOAuthGrants, revokeOAuthClientTokens } from "@repo/database/models/oauth-grants";
import type { McpClient, McpClientsAnswer } from "@repo/features/mcp-client-wire";
import { Effect } from "effect";
import { CLI_OAUTH_CLIENT, DESKTOP_OAUTH_CLIENT } from "../auth/oauth-clients.js";
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

const FIRST_PARTY_CLIENTS: readonly string[] = [DESKTOP_OAUTH_CLIENT.id];

const TOKEN_LISTED_CLIENTS: readonly string[] = [CLI_OAUTH_CLIENT.id];

export interface McpClientsProcedureSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  deleteClientConsent: ClientConsentDelete;
  memberMcpServerUrl: string;
}

function clientsOf(userId: string, serverUrl: string) {
  return Effect.map(
    hostedStoreOrUnavailable(
      listOAuthGrants(userId, { except: FIRST_PARTY_CLIENTS, tokenOnly: TOKEN_LISTED_CLIENTS }),
    ),
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

function consentDeletedOrRefusal(
  deleted: ReturnType<ClientConsentDelete>,
): Effect.Effect<void, HostedRefusal> {
  return deleted.pipe(
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
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
