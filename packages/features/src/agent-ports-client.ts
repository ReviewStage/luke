/**
 * agent-ports-client.ts -- a coding agent's listening ports, as the desktop's host asks the service for them while it forwards them: the ports read, forwarding started, and the tunnel address one port's socket opens on.
 *
 * Every call is a procedure of the hosted contract over the one account
 * call (`hosted-link.ts`). Anything the service did not answer, a refusal
 * among it, answers nothing, which the host reads as no new look.
 */

import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, type HostedClient, hostedClient } from "./hosted-link.js";
import type { ForwardingStartAnswer, ListeningPortsAnswer } from "./listening-ports-wire.js";
import { SANDBOX_TUNNEL, TUNNEL_KIND } from "./sandbox-tunnel-wire.js";

export interface HostedAgentPortsClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

/** The tunnel address one forwarded port's socket opens on, at the service's socket origin. */
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

  /** The ports listened on in the agent's sandbox, and whether it runs; a stopped sandbox is never woken by it. */
  list(
    agentId: string,
  ): Effect.Effect<ListeningPortsAnswer | undefined, never, HttpClient.HttpClient> {
    return Effect.orElseSucceed(
      askHosted(this.#hosted.agentPorts.list, { id: agentId }),
      () => undefined,
    );
  }

  /** The agent's sandbox woken, and its repository's run command started where nothing listens. */
  startForwarding(
    agentId: string,
  ): Effect.Effect<ForwardingStartAnswer | undefined, never, HttpClient.HttpClient> {
    return Effect.orElseSucceed(
      askHosted(this.#hosted.agentPorts.startForwarding, { id: agentId }),
      () => undefined,
    );
  }
}
