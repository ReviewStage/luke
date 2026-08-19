import * as Data from "effect/Data";

/** HTTP statuses the adapter names when a response is not simply ok. */
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;

export const CLOUD_FAILURE = {
  UNAUTHORIZED: "unauthorized",
  TRANSIENT: "transient",
} as const;

export type CloudFailureKind = (typeof CLOUD_FAILURE)[keyof typeof CLOUD_FAILURE];

export class CloudFailure extends Data.TaggedError("CloudFailure")<{
  readonly failure: CloudFailureKind;
  readonly status?: number;
  readonly provider: string;
}> {}

/**
 * How a CLI-observed provider fails. Unavailable means there is nothing to
 * observe with — the binary is not installed, or its login probe answered no —
 * which is the CLI analogue of a missing API key and clears observed state the
 * same way. Transient covers a command that ran and failed, which keeps the
 * last snapshot until the next attempt the way a network blip does.
 */
export const CLI_FAILURE = {
  UNAVAILABLE: "unavailable",
  TRANSIENT: "transient",
} as const;

export type CliFailureKind = (typeof CLI_FAILURE)[keyof typeof CLI_FAILURE];

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly failure: CliFailureKind;
  readonly exitCode?: number;
  readonly provider: string;
}> {}

export class AccountClientFailure extends Data.TaggedError("AccountClientFailure")<{
  readonly status?: number;
  readonly oauthError?: string;
}> {}
