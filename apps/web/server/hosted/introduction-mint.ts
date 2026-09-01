import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  introductionSessionConfig,
  type RealtimeSessionOptions,
  text as trimmedText,
} from "../core.js";
import { HostedClock, HostedMeterService, HostedOpenAi } from "../services/tags.js";
import {
  decodeJsonBody,
  HOSTED_HTTP_STATUS,
  invalidRequest,
  jsonResponseEffect,
  methodNotAllowed,
  quotaExhausted,
  readBoundedBody,
  unavailable,
} from "./http-effect.js";
import { voiceMintPreferencesSchema } from "./schema.js";
import {
  type VoiceMintPreferences,
  VoiceMintUpstream,
  voiceMintPreferences,
} from "./voice-mint.js";

/**
 * Mints the one credential a fresh install may ask for before any account
 * exists: the spoken onboarding introduction. The request carries no bearer
 * and no identity — nothing about the caller is stored beyond a hashed
 * rate-limit key, and nothing joins an account or an analytics person. The
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

const CALLER_ADDRESS_HEADER = {
  /** Written by the deployment's own proxy, client address first. */
  FORWARDED_FOR: "x-forwarded-for",
  REAL_IP: "x-real-ip",
} as const;

/** Where a request with no readable address lands: one shared, bounded bucket. */
const SHARED_CALLER_BUCKET = "no-address";

/**
 * The rate-limit key for one request, and the only thing about the caller
 * that outlives it. The address is hashed before it can land anywhere
 * durable — the usage table needs a bucket for the day, never an address —
 * and a request whose address the proxy did not report shares one bucket
 * rather than minting unmetered.
 */
export function introductionCallerKey(request: Request): string {
  const forwarded = request.headers.get(CALLER_ADDRESS_HEADER.FORWARDED_FOR) ?? undefined;
  const address =
    trimmedText(request.headers.get(CALLER_ADDRESS_HEADER.REAL_IP) ?? undefined) ??
    trimmedText(forwarded?.split(",")[0]);
  if (!address) return SHARED_CALLER_BUCKET;
  return createHash("sha256").update(address).digest("hex");
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

export const handleIntroductionMint = Effect.fn("handleIntroductionMint")(function* (
  request: Request,
) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const openAi = yield* HostedOpenAi;
  const apiKey = trimmedText(openAi.apiKey);
  const model = trimmedText(openAi.realtimeModel);
  if (!apiKey) {
    return unavailable();
  }

  const raw = yield* readBoundedBody(request, 65_536);
  if (raw === undefined) {
    return invalidRequest();
  }
  let preferences: VoiceMintPreferences | undefined;
  if (!raw.trim()) {
    preferences = {};
  } else {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return invalidRequest();
    }
    preferences = decodeJsonBody(voiceMintPreferencesSchema(INTRODUCTION_MINT_FIELDS), payload);
  }
  if (preferences === undefined) {
    return invalidRequest();
  }

  const meter = yield* HostedMeterService;
  const spend = yield* meter.spendIntroduction(introductionCallerKey(request));
  if (!spend.allowed) {
    return quotaExhausted();
  }

  const upstream = yield* VoiceMintUpstream;
  const clock = yield* HostedClock;
  const minted = yield* upstream.mint({
    apiKey,
    model,
    preferences,
    clientSecretRequest: introductionClientSecretRequest,
    now: () => clock.now(),
  });
  if ("failure" in minted) return minted.failure;

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, { connection: minted.connection });
});

/** @deprecated Tests use hosted-runner shims. */
export interface IntroductionMintOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  spend: (callerKey: string) => Promise<import("./quota.js").IntroductionSpend>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
}
