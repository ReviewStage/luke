import {
  type CloudFetch,
  HTTP_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { ELEVENLABS_API_ORIGIN, ELEVENLABS_KEY_HEADER } from "./elevenlabs-voices.js";
import {
  ELEVENLABS_OUTCOME,
  type ElevenlabsFailure,
  type ElevenlabsOutcome,
} from "./speech-provider.js";

/**
 * Minting the one credential a speech socket may carry.
 *
 * The long-lived key stays in the main process and authenticates only this
 * call. What the renderer receives is a single-use token: it expires fifteen
 * minutes after it is issued, is spent by the socket that opens on it, and is
 * never cached or reused — a second reply mints a second token, because a
 * token held for later is a credential outliving the act it was minted for.
 */

/**
 * The token type is the socket it is spent on, and the two are not
 * interchangeable: each refuses a token minted for the other by name, so this
 * moves whenever `elevenlabsSpeechUrl` does.
 */
const SINGLE_USE_TOKEN_PATH = "/v1/single-use-token/tts_websocket";

/** The exact address a client credential is minted at. */
export const ELEVENLABS_TOKEN_URL = new URL(
  SINGLE_USE_TOKEN_PATH,
  ELEVENLABS_API_ORIGIN,
).toString();

export interface TokenMintResult {
  outcome: ElevenlabsOutcome;
  /** Present on `ok`, and only then. */
  token?: string;
}

const TOKEN_MINT_EXPLANATIONS = {
  [ELEVENLABS_OUTCOME.UNAUTHORIZED]:
    "ElevenLabs refused the key. It may have been revoked, or it may not carry the Text to speech permission.",
  [ELEVENLABS_OUTCOME.HTTP_ERROR]: "ElevenLabs rejected the token request.",
  [ELEVENLABS_OUTCOME.NETWORK_ERROR]: "The token request did not complete.",
  [ELEVENLABS_OUTCOME.MALFORMED_RESPONSE]: "ElevenLabs answered without a usable token.",
} satisfies Record<ElevenlabsFailure, string>;

/** Explains a failed mint in one sentence, for the panel and for logs. */
export function tokenMintExplanation(outcome: ElevenlabsFailure): string {
  return TOKEN_MINT_EXPLANATIONS[outcome];
}

/** Reads a mint answer, which carries a token and nothing else Luke uses. */
export function elevenlabsTokenFromResponse(payload: UnparsedWireValue): string | undefined {
  if (!isRecord(payload)) return undefined;
  return text(payload.token) || undefined;
}

export interface TokenMintOptions {
  apiKey: string;
  fetch: CloudFetch;
}

export async function mintElevenlabsToken(options: TokenMintOptions): Promise<TokenMintResult> {
  let response: Response;
  try {
    response = await options.fetch(ELEVENLABS_TOKEN_URL, {
      method: "POST",
      headers: { [ELEVENLABS_KEY_HEADER]: options.apiKey },
    });
  } catch {
    return { outcome: ELEVENLABS_OUTCOME.NETWORK_ERROR };
  }

  if (!response.ok) {
    const unauthorized =
      response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
    return {
      outcome: unauthorized ? ELEVENLABS_OUTCOME.UNAUTHORIZED : ELEVENLABS_OUTCOME.HTTP_ERROR,
    };
  }

  let payload: UnparsedWireValue;
  try {
    // SAFETY: An untrusted body is unparsed wire until `elevenlabsTokenFromResponse` reads it.
    payload = (await response.json()) as UnparsedWireValue;
  } catch {
    return { outcome: ELEVENLABS_OUTCOME.MALFORMED_RESPONSE };
  }

  const token = elevenlabsTokenFromResponse(payload);
  if (!token) return { outcome: ELEVENLABS_OUTCOME.MALFORMED_RESPONSE };
  return { outcome: ELEVENLABS_OUTCOME.OK, token };
}
