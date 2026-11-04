import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, type HostedClient, hostedClient } from "./hosted-link.js";
import { MCP_CLIENTS_CALL_FAILURE, type McpClientsView } from "./mcp-client-view.js";
import { MCP_CLIENT_QUERY } from "./mcp-client-wire.js";

/**
 * mcp-clients-client.ts -- the outside MCP clients the account allowed, as the host asks the service for them and revokes one.
 *
 * Both calls are procedures of the hosted contract (`contract/mcp-clients.ts`)
 * over the account call (`hosted-link.ts`). The read carries the account's
 * credential. A revoke deletes the client's Allow through Better Auth's own
 * consent endpoint on the service, so it carries the Mac's Better Auth
 * session instead, asking for one through the browser's hand-off where
 * there is none or the service refused it. Each answers the clients as the
 * service then holds them or why there is no answer, never a failure, since
 * every caller does the same with one: says so, and offers it again.
 */

export interface HostedMcpClientsClientOptions {
  /** What authorizes the read on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The Mac's own Better Auth session, for the revoke. */
  sessionCredential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED } as const;

export class HostedMcpClientsClient {
  readonly #hosted: HostedClient;
  /** The client for the revoke, under the Mac's session. */
  readonly #inSession: HostedClient;

  constructor(options: HostedMcpClientsClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#inSession = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      requestTimeoutMs: options.requestTimeoutMs,
      inSession: true,
    });
  }

  /** The clients the account allowed, newest allowed first, with the server's address. */
  list(): Effect.Effect<McpClientsView, never, HttpClient.HttpClient> {
    return Effect.orElseSucceed(
      askHosted(this.#hosted.mcpClients.list, undefined),
      () => UNANSWERED,
    );
  }

  /** One client revoked, answering the clients as they then stand. */
  revoke(clientId: string): Effect.Effect<McpClientsView, never, HttpClient.HttpClient> {
    // The client rides in the query, since a DELETE carries no body.
    return Effect.orElseSucceed(
      askHosted(this.#inSession.mcpClients.revoke, {
        query: { [MCP_CLIENT_QUERY.CLIENT_ID]: clientId },
      }),
      () => UNANSWERED,
    );
  }
}
