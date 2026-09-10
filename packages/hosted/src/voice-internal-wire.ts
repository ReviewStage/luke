import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { type HostedQuota, hostedQuotaSchema } from "./service-wire.js";

/**
 * The two internal calls the hosted voice service makes to the account
 * service, under `VOICE_SERVICE_SECRET_HEADER` and never an account bearer of
 * its own. Before it spends a GPT Live session it asks who opened the socket
 * and whether their allowance covers one more; after `session.closed` it
 * reports the seconds OpenAI billed for that session, once. Declared here so
 * the service that sends and the route that reads cannot drift.
 */

export const VOICE_INTERNAL_BOUNDS = {
  /** The account bearer as the desktop handed it on the socket's handshake; a token is far shorter. */
  BEARER_CHARS: 4_096,
  /** A GPT Live session id is opaque and short; the bound only refuses a document standing in for one. */
  SESSION_ID_CHARS: 256,
  /**
   * The most seconds one session may report. GPT Live sessions have a duration
   * limit of their own well under a day, so a larger figure is a miscount,
   * not a long call.
   */
  SESSION_SECONDS: 86_400,
} as const;

/** What the voice service forwards to learn whose session it is about to create. */
export interface VoiceAuthorizeRequest {
  /** The `Authorization` header value the desktop opened the socket with, scheme included. */
  bearer: string;
}

/** The account the bearer resolved to and the allowance the session was just spent against. */
export interface VoiceAuthorizeAnswer {
  userId: string;
  quota: HostedQuota;
}

/** One session's billed seconds, as `session.closed` reported them. */
export interface VoiceUsageRequest {
  userId: string;
  sessionId: string;
  seconds: number;
}

/**
 * How the account service took a usage report. The same session id reported
 * again is answered `REPEATED` and moves no counter, so a service that
 * retries a report after a lost answer cannot bill a session twice.
 */
export const VOICE_USAGE_RECORD = {
  RECORDED: "recorded",
  REPEATED: "repeated",
} as const;

export type VoiceUsageRecord = (typeof VOICE_USAGE_RECORD)[keyof typeof VOICE_USAGE_RECORD];

export interface VoiceUsageAnswer {
  record: VoiceUsageRecord;
}

const opaqueId = s.text({ ends: TEXT_ENDS.TRIM, max: VOICE_INTERNAL_BOUNDS.SESSION_ID_CHARS });

export const voiceAuthorizeRequestSchema: Schema<VoiceAuthorizeRequest> = s.record({
  bearer: s.text({ ends: TEXT_ENDS.TRIM, max: VOICE_INTERNAL_BOUNDS.BEARER_CHARS }),
});

export const voiceAuthorizeAnswerSchema: Schema<VoiceAuthorizeAnswer> = s.record(
  { userId: opaqueId, quota: hostedQuotaSchema },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export const voiceUsageRequestSchema: Schema<VoiceUsageRequest> = s.record({
  userId: opaqueId,
  sessionId: opaqueId,
  seconds: s.number({ minimum: 0, maximum: VOICE_INTERNAL_BOUNDS.SESSION_SECONDS }),
});

export const voiceUsageAnswerSchema: Schema<VoiceUsageAnswer> = s.record(
  { record: s.enumOf(Object.values(VOICE_USAGE_RECORD)) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
