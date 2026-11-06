import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, type HostedClient, hostedClient } from "./hosted-link.js";
import type { ListeningPortsAnswer } from "./listening-ports-wire.js";
import { SANDBOX_TUNNEL, TUNNEL_KIND } from "./sandbox-tunnel-wire.js";

export interface HostedAgentPortsClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
}

export function portForwardAddress(
  socketOrigin: string,
  ask: { readonly agentId: string; readonly port: number },
): string {
  const query = new URLSearchParams({
    [SANDBOX_TUNNEL.QUERY.AGENT]: ask.agentId,
    [SANDBOX_TUNNEL.QUERY.KIND]: TUNNEL_KIND.PORT_FORWARD,
    [SANDBOX_TUNNEL.QUERY.PORT]: String(ask.port),
  });
  return `${socketOrigin}${SANDBOX_TUNNEL.PATH}?${query}`;
}

export class HostedAgentPortsClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedAgentPortsClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
  }

  list(
    agentId: string,
  ): Effect.Effect<ListeningPortsAnswer | undefined, never, HttpClient.HttpClient> {
    return Effect.orElseSucceed(
      askHosted(this.#hosted.agentPorts.list, { id: agentId }),
      () => undefined,
    );
  }
}
