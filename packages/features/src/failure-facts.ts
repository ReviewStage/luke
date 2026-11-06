import { Schema } from "effect";

export const FAILURE_FACT = {
  HOSTED_REFUSED: "HostedRefused",
  HOSTED_UNANSWERED: "HostedUnanswered",
  GATE_CLOSED: "GateClosed",
  LIVE_BROKEN: "LiveBroken",
  SEAL_UNANSWERED: "SealUnanswered",
} as const;
type FailureFact = (typeof FAILURE_FACT)[keyof typeof FAILURE_FACT];

export const GATE_CLOSED_BY = {
  NO_NETWORK: "no-network",
  NO_ACCOUNT: "no-account",
} as const;

export interface FailureFacts {
  readonly _tag: FailureFact;
  readonly refusal?: string;
  readonly fault?: string;
  readonly status?: number;
  readonly code?: string;
  readonly errorName?: string;
  readonly reason?: string;
  readonly traceId?: string;
  readonly cause?: FailureFacts;
}

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
