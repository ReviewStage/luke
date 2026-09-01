import {
  type CloudFetch,
  HTTP_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { ELEVENLABS_API_ORIGIN, ELEVENLABS_KEY_HEADER } from "./elevenlabs-voices.js";

/**
 * Minting the one credential a speech socket may carry.
 *
 * The long-lived key stays in the main process and authenticates only this
 * call. What the renderer receives is a single-use token: it expires fifteen
 * minutes after it is issued, is spent by the socket that opens on it, and is
 * never cached or reused — a second reply mints a second token, because a
 * token held for later is a credential outliving the act it was minted for.
 */

const SINGLE_USE_TOKEN_PATH = "/v1/single-use-token/tts_websocket";

/** The exact address a client credential is minted at. */
export const ELEVENLABS_TOKEN_URL = new URL(
  SINGLE_USE_TOKEN_PATH,
  ELEVENLABS_API_ORIGIN,
).toString();

export const TOKEN_MINT_OUTCOME = {
  OK: "ok",
  /** The key was refused: revoked, or missing the `text_to_speech` permission. */
  UNAUTHORIZED: "unauthorized",
  HTTP_ERROR: "http-error",
  NETWORK_ERROR: "network-error",
  MALFORMED_RESPONSE: "malformed-response",
} as const;

export type TokenMintOutcome = (typeof TOKEN_MINT_OUTCOME)[keyof typeof TOKEN_MINT_OUTCOME];

export interface TokenMintResult {
  outcome: TokenMintOutcome;
  /** Present on `ok`, and only then. */
  token?: string;
  /** A status code or error name. Never a response body, and never the key. */
  detail?: string;
}

const TOKEN_MINT_EXPLANATIONS = {
  [TOKEN_MINT_OUTCOME.OK]: "A single-use speech token was minted.",
  [TOKEN_MINT_OUTCOME.UNAUTHORIZED]:
    "ElevenLabs refused the key. It may have been revoked, or it may not carry the Text to speech permission.",
  [TOKEN_MINT_OUTCOME.HTTP_ERROR]: "ElevenLabs rejected the token request.",
  [TOKEN_MINT_OUTCOME.NETWORK_ERROR]: "The token request did not complete.",
  [TOKEN_MINT_OUTCOME.MALFORMED_RESPONSE]: "ElevenLabs answered without a usable token.",
} satisfies Record<TokenMintOutcome, string>;

/** Explains a mint outcome in one sentence, for the panel and for logs. */
export function tokenMintExplanation(outcome: TokenMintOutcome): string {
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
  } catch (error) {
    return {
      outcome: TOKEN_MINT_OUTCOME.NETWORK_ERROR,
      detail: error instanceof Error ? error.name : undefined,
    };
  }

  if (!response.ok) {
    const unauthorized =
      response.status === HTTP_STATUS.UNAUTHORIZED || response.status === HTTP_STATUS.FORBIDDEN;
    return {
      outcome: unauthorized ? TOKEN_MINT_OUTCOME.UNAUTHORIZED : TOKEN_MINT_OUTCOME.HTTP_ERROR,
      detail: String(response.status),
    };
  }

  let payload: UnparsedWireValue;
  try {
    payload = (await response.json()) as UnparsedWireValue;
  } catch {
    return { outcome: TOKEN_MINT_OUTCOME.MALFORMED_RESPONSE };
  }

  const token = elevenlabsTokenFromResponse(payload);
  if (!token) return { outcome: TOKEN_MINT_OUTCOME.MALFORMED_RESPONSE };
  return { outcome: TOKEN_MINT_OUTCOME.OK, token };
}
