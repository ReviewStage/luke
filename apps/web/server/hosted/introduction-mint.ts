import { introductionSessionConfig, type RealtimeSessionOptions } from "../core.js";

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

/**
 * The fields the introduction's own reader takes and nothing else: an
 * authenticated desktop earns the ordinary reader's tolerance for extra
 * fields, and an anonymous caller sending something this endpoint does not
 * take is probing it, not misconfigured.
 */
export const INTRODUCTION_MINT_FIELDS: readonly string[] = ["voice", "speed"];
