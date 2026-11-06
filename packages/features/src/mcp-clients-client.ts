import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, type HostedClient, hostedClient } from "./hosted-link.js";
import { MCP_CLIENTS_CALL_FAILURE, type McpClientsView } from "./mcp-client-view.js";
import { MCP_CLIENT_QUERY } from "./mcp-client-wire.js";

export interface HostedMcpClientsClientOptions {
  credential: CallCredential;
  sessionCredential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED } as const;

export class HostedMcpClientsClient {
  readonly #hosted: HostedClient;
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

  list(): Effect.Effect<McpClientsView, never, HttpClient.HttpClient> {
    return Effect.orElseSucceed(
      askHosted(this.#hosted.mcpClients.list, undefined),
      () => UNANSWERED,
    );
  }

  revoke(clientId: string): Effect.Effect<McpClientsView, never, HttpClient.HttpClient> {
    return Effect.orElseSucceed(
      askHosted(this.#inSession.mcpClients.revoke, {
        query: { [MCP_CLIENT_QUERY.CLIENT_ID]: clientId },
      }),
      () => UNANSWERED,
    );
  }
}
