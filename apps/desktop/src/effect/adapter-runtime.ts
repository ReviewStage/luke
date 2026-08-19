import { Cause, Effect, Exit, Layer } from "effect";
import {
  CLI_FAILURE,
  CliCommandError,
  type CliRun,
  type CliRunResult,
} from "../cli-session-adapter";
import { CLOUD_FAILURE, type CloudFetch, CloudRequestError } from "../cloud-session-adapter";
import { CliRunFailure, CliRunService, cliRun } from "./cli-run";
import { CloudFetchFailure, CloudFetchService, cloudFetch } from "./cloud-fetch";

export function runWithCloudFetch(fetch: CloudFetch): Layer.Layer<CloudFetchService> {
  return Layer.succeed(CloudFetchService, fetch);
}

export function runWithCliRun(run: CliRun): Layer.Layer<CliRunService> {
  return Layer.succeed(CliRunService, run);
}

export function mapCloudFetchFailureToRequestError(
  failure: CloudFetchFailure,
  providerDisplayName: string,
): CloudRequestError {
  if (failure.failure === CLOUD_FAILURE.UNAUTHORIZED) {
    return new CloudRequestError(
      CLOUD_FAILURE.UNAUTHORIZED,
      `${providerDisplayName} rejected the configured API key`,
    );
  }
  const statusMatch = /responded with status (\d+)/.exec(failure.message);
  if (statusMatch) {
    return new CloudRequestError(
      CLOUD_FAILURE.TRANSIENT,
      `${providerDisplayName} responded with status ${statusMatch[1]}`,
    );
  }
  return new CloudRequestError(CLOUD_FAILURE.TRANSIENT, `${providerDisplayName} request failed`);
}

function cloudFetchFailureFromCause(cause: Cause.Cause<CloudFetchFailure>): CloudFetchFailure {
  const failure = Cause.failureOption(cause);
  if (failure._tag === "Some") return failure.value;
  return new CloudFetchFailure({
    failure: CLOUD_FAILURE.TRANSIENT,
    message: "Request failed",
  });
}

function cliRunFailureFromCause(cause: Cause.Cause<CliRunFailure>): CliRunFailure {
  const failure = Cause.failureOption(cause);
  if (failure._tag === "Some") return failure.value;
  return new CliRunFailure({
    failure: CLI_FAILURE.TRANSIENT,
    message: "CLI could not be run",
  });
}

/**
 * Invokes fetch without treating non-ok HTTP statuses as Effect failures, so
 * a write can map each status to its own refusal rather than failing early.
 */
export function cloudFetchRaw(
  url: string,
  init: RequestInit,
): Effect.Effect<Response, CloudFetchFailure, CloudFetchService> {
  return Effect.gen(function* () {
    const fetch = yield* CloudFetchService;
    return yield* Effect.tryPromise({
      try: () => fetch(url, init),
      catch: () =>
        new CloudFetchFailure({
          failure: CLOUD_FAILURE.TRANSIENT,
          message: `Request to ${url} failed`,
        }),
    });
  });
}

export async function runCloudFetch(
  fetch: CloudFetch,
  url: string,
  init: RequestInit,
  providerDisplayName: string,
): Promise<Response> {
  const exit = await Effect.runPromiseExit(
    cloudFetch(url, init).pipe(Effect.provide(runWithCloudFetch(fetch))),
  );
  if (Exit.isFailure(exit)) {
    throw mapCloudFetchFailureToRequestError(
      cloudFetchFailureFromCause(exit.cause),
      providerDisplayName,
    );
  }
  return exit.value;
}

export async function runCloudFetchRaw(
  fetch: CloudFetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const exit = await Effect.runPromiseExit(
    cloudFetchRaw(url, init).pipe(Effect.provide(runWithCloudFetch(fetch))),
  );
  if (Exit.isFailure(exit)) {
    throw cloudFetchFailureFromCause(exit.cause);
  }
  return exit.value;
}

export async function runCliRun(
  run: CliRun,
  binary: string,
  argv: readonly string[],
  options: Readonly<{ timeoutMs: number; maximumOutputBytes: number }>,
): Promise<CliRunResult> {
  const exit = await Effect.runPromiseExit(
    cliRun(binary, argv, options).pipe(Effect.provide(runWithCliRun(run))),
  );
  if (Exit.isFailure(exit)) {
    const failure = cliRunFailureFromCause(exit.cause);
    throw new CliCommandError(failure.failure, failure.message);
  }
  return exit.value;
}
