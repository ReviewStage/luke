/**
 * agent-ports-client.ts -- a coding agent's listening ports, as the desktop's host asks the service for them while it forwards them: the ports read, the tunnel address one port's socket opens on, and one port shared by public link.
 *
 * Every call is a procedure of the hosted contract over the one account
 * call (`hosted-link.ts`), answering what the service said or how the call
 * failed (`hostedCall`); the host reads any failure as no new look.
 */

import type { CallCredential } from "./account-call.js";
import { hostedCall } from "./hosted-call.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
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
  list(agentId: string) {
    return hostedCall(this.#hosted.agentPorts.list, { id: agentId });
  }

  /** The port shared by a public link, replacing any shared before, answering the link; a sandbox not running is refused as stopped and never woken. */
  share(agentId: string, port: number) {
    return hostedCall(this.#hosted.agentPorts.share, { params: { id: agentId }, body: { port } });
  }

  /** The shared port's link closed. */
  unshare(agentId: string) {
    return hostedCall(this.#hosted.agentPorts.unshare, { id: agentId });
  }

  /** The port shared now and its link; none where nothing is shared or the sandbox is not running. */
  shared(agentId: string) {
    return hostedCall(this.#hosted.agentPorts.shared, { id: agentId });
  }
}
