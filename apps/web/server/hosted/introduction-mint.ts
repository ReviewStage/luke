import {
  introductionSessionConfig,
  type RealtimeSessionOptions,
  text as trimmedText,
} from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { FetchLike } from "./openai.js";
import type { IntroductionSpend } from "./quota.js";
import {
  mintRealtimeConnection,
  type VoiceMintPreferences,
  voiceMintPreferences,
} from "./voice-mint.js";

/**
 * Mints the one credential a fresh install may ask for before any account
 * exists: the spoken onboarding introduction. The request carries no bearer
 * and no identity — nothing joins an account or an analytics person. The
 * session document is built from the same shared code the ordinary mint uses,
 * so the caller's whole say is still a voice and a pace, and everything else
 * about the credential — including the introduction's shorter expiry — is
 * fixed here.
 */

/**
 * How soon a minted introduction secret dies, anchored to its creation. The
 * expiry bounds when the credential can open its one call, which is the only
 * knob the client-secrets endpoint offers — the ordinary mint leaves it at
 * the service default, but an unauthenticated credential should not outlive
 * the handshake it exists for, and a minute covers a slow network several
 * times over.
 */
export const INTRODUCTION_SECRET_EXPIRY = {
  ANCHOR: "created_at",
  SECONDS: 60,
} as const;

/**
 * The introduction's own session document with its expiry cap. Minted, not
 * merely asked for after connect: this endpoint answers callers with no
 * account, so the credential itself must declare no tools and the
 * introduction's instructions — a bound the client re-asserts on connect but
 * could never be trusted to add.
 */
export function introductionClientSecretRequest(options: RealtimeSessionOptions = {}) {
  return {
    session: introductionSessionConfig(options),
    expires_after: {
      anchor: INTRODUCTION_SECRET_EXPIRY.ANCHOR,
      seconds: INTRODUCTION_SECRET_EXPIRY.SECONDS,
    },
  };
}

const INTRODUCTION_MINT_FIELDS: readonly string[] = ["voice", "speed"];

/**
 * Reads the caller's voice and pace, tolerating an empty body like the
 * ordinary mint but refusing any field beyond those two: an authenticated
 * desktop earns the ordinary reader's tolerance for extra fields, and an
 * anonymous caller sending something this endpoint does not take is probing
 * it, not misconfigured.
 */
export async function introductionMintPreferences(
  request: Request,
): Promise<VoiceMintPreferences | undefined> {
  return voiceMintPreferences(request, INTRODUCTION_MINT_FIELDS);
}

export interface IntroductionMintOptions {
  request: Request;
  /** Luke's own OpenAI key, from the deployment environment; absent means the tier is off. */
  apiKey: string | undefined;
  /** A deployment-configured model override; the shared default otherwise. */
  model?: string;
  spend: () => Promise<IntroductionSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function handleIntroductionMint(options: IntroductionMintOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  // Trimmed like the ordinary mint's reads: a whitespace credential is the
  // kill switch, not a key, and a blank model override is no override at all.
  const apiKey = trimmedText(options.apiKey);
  const model = trimmedText(options.model);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  // Body before meter, so a malformed request is refused before it spends.
  const preferences = await introductionMintPreferences(request);
  if (!preferences) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  // The refusal carries no quota: the introduction is not an allowance the
  // desktop tracks, only a cap it may run into.
  const spend = await options.spend();
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }

  const minted = await mintRealtimeConnection({
    apiKey,
    model,
    preferences,
    clientSecretRequest: introductionClientSecretRequest,
    fetch: options.fetch,
    now: options.now,
    timeoutMs: options.timeoutMs,
  });
  if ("failure" in minted) return minted.failure;

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { connection: minted.connection });
}
