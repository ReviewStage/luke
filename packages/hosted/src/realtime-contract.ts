import { isRecord, text, type UnparsedWireValue, wholeNumber } from "@sidecar/wire";

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

/**
 * Reads an untrusted mint response into the contract. Anything that does not
 * carry a usable secret and expiry is discarded rather than repaired, so a
 * malformed response leaves voice unavailable instead of half-configured. A
 * response that omits its model is labelled with the one it was minted for,
 * which the caller knows and this package does not.
 */
export function realtimeCredentialFromResponse(
  payload: UnparsedWireValue,
  mintedModel: string,
): RealtimeCredential | undefined {
  if (!isRecord(payload)) return undefined;

  const value = text(payload.value);
  if (!value) return undefined;

  const expiresAtSeconds = wholeNumber(payload.expires_at);
  if (expiresAtSeconds === undefined || expiresAtSeconds <= 0) return undefined;

  const session = isRecord(payload.session) ? payload.session : undefined;
  const model = session ? text(session.model) : undefined;

  return {
    value,
    expiresAt: Math.floor(expiresAtSeconds * 1000),
    model: model ?? mintedModel,
  };
}
