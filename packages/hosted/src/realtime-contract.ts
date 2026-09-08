/** The OpenAI path a Realtime connection opens after minting. */
export const REALTIME_CALLS_PATH = "/realtime/calls";

/** An ephemeral Realtime credential, safe to hand to a sandboxed renderer. */
export interface RealtimeCredential {
  value: string;
  expiresAt: number;
  model: string;
}

/** Everything a renderer needs to open a call, and nothing more. */
export interface RealtimeConnection extends RealtimeCredential {
  callsUrl: string;
  /**
   * WebSocket realtime endpoint, including ?model=, for a client that opens
   * the call over WebSocket rather than WebRTC. The hosted mint always
   * carries it; a connection minted straight against OpenAI on the
   * developer's own key does not, because that mint answers a calls URL
   * alone and composing one here would invent an endpoint.
   */
  wsUrl?: string;
}

export function realtimeCredentialIsUsable(credential: RealtimeCredential, now: number): boolean {
  return credential.expiresAt > now;
}
