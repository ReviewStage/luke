/**
 * failure-facts.ts -- what a failure the host caught says of itself as it crosses to a window, so the window that shows it can report what failed, never its words.
 *
 * A call the host makes for a window answers rather than fails
 * (`agent-client.ts`), so the window draws its one sentence for every
 * failure it cannot name, "Luke didn't hear back" among them. What failed
 * rides beside that answer as these facts: which failure it was, the fault,
 * refusal, HTTP status, code, error name, reason, and trace id it names, and
 * the failure beneath it where there is one. The panel hands the answer on as
 * a shown failure's cause (`@luke/panel/failure-report`), whose reader
 * (`shown-failure.ts`) reads each field by the name an error carries it
 * under and follows `cause` down the chain. Nothing here decides what a
 * window draws.
 *
 * Note that every field is a name, a code, or a number, and none an error's
 * own words, which could carry a credential; `reason` is the host's own fixed
 * sentence for why a follow stopped. The fields that name another
 * vocabulary's value (a call's fault, a service's refusal, an oRPC code) are
 * strings here, because this record carries them to a report and nothing
 * reads them back to branch on.
 */

import { Schema } from "effect";

/** Which failure the facts are of: each named as the error the host caught names itself (`_tag`). */
export const FAILURE_FACT = {
  /** The service refused, with a refusal the caller names no failure for. */
  HOSTED_REFUSED: "HostedRefused",
  /** The service's answer never arrived or could not be read (`hosted-link.ts`). */
  HOSTED_UNANSWERED: "HostedUnanswered",
  /** The host asked nothing, because its gate to the service stood closed: signed out, or a run that sends nothing. */
  GATE_CLOSED: "GateClosed",
  /** A live read the host followed stopped for good (`@luke/host`'s `live-follow.ts`). */
  LIVE_BROKEN: "LiveBroken",
  /** A live read's first answer never came, asked again and again (`@luke/host`'s `transcript-follow.ts`). */
  SEAL_UNANSWERED: "SealUnanswered",
} as const;
type FailureFact = (typeof FAILURE_FACT)[keyof typeof FAILURE_FACT];

/** Why the host's gate to the service stood closed. */
export const GATE_CLOSED_BY = {
  /** The run sends nothing to the network, as a fixture or an offline run. */
  NO_NETWORK: "no-network",
  /** No account's capabilities are open: signed out, or signing in. */
  NO_ACCOUNT: "no-account",
} as const;

/** What a failure the host caught says of itself, each where it says it, and the failure beneath it. */
export interface FailureFacts {
  readonly _tag: FailureFact;
  /** The service's refusal slug, where it refused. */
  readonly refusal?: string;
  /** Where a call ended before any status was read (`CALL_FAULT`). */
  readonly fault?: string;
  /** The HTTP status the service answered, where one was read. */
  readonly status?: number;
  /** A code the failure names: an oRPC error's, what of an answer went unread, a failed read's, or why a gate stood closed. */
  readonly code?: string;
  /** The kind of error a call ended with, never its words. */
  readonly errorName?: string;
  /** The host's own sentence for why a follow stopped. */
  readonly reason?: string;
  /** The trace the call travelled under, which the service's log lines for it carry. */
  readonly traceId?: string;
  /** The failure beneath, read as these facts are. */
  readonly cause?: FailureFacts;
}

/** The facts as they cross the act port to a window, the failure beneath read as the facts are. */
export const failureFactsSchema: Schema.Codec<FailureFacts> = Schema.Struct({
  _tag: Schema.Literals(Object.values(FAILURE_FACT)),
  refusal: Schema.optionalKey(Schema.String),
  fault: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.Number),
  code: Schema.optionalKey(Schema.String),
  errorName: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  traceId: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.suspend((): Schema.Codec<FailureFacts> => failureFactsSchema)),
});
