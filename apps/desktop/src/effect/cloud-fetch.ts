import { Context, Data, Effect, Layer } from "effect";
import {
  CLOUD_FAILURE,
  type CloudFailure,
  type CloudFetch,
  type CloudRequestError,
  HTTP_STATUS,
} from "../cloud-session-adapter";

export class CloudFetchService extends Context.Tag("CloudFetchService")<
  CloudFetchService,
  CloudFetch
>() {}

export class CloudFetchFailure extends Data.TaggedError("CloudFetchFailure")<{
  readonly failure: CloudFailure;
  readonly message: string;
}> {}

const defaultCloudFetch: CloudFetch = (url, init) => fetch(url, init);

export const CloudFetchLive = Layer.succeed(CloudFetchService, defaultCloudFetch);

export function fromCloudRequestError(error: CloudRequestError): CloudFetchFailure {
  return new CloudFetchFailure({ failure: error.failure, message: error.message });
}

function networkFailure(url: string): CloudFetchFailure {
  return new CloudFetchFailure({
    failure: CLOUD_FAILURE.TRANSIENT,
    message: `Request to ${url} failed`,
  });
}

function httpFailure(url: string, status: number): CloudFetchFailure {
  if (status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.FORBIDDEN) {
    return new CloudFetchFailure({
      failure: CLOUD_FAILURE.UNAUTHORIZED,
      message: `Request to ${url} was rejected (${status})`,
    });
  }
  return new CloudFetchFailure({
    failure: CLOUD_FAILURE.TRANSIENT,
    message: `Request to ${url} responded with status ${status}`,
  });
}

export const cloudFetch = (
  url: string,
  init: RequestInit,
): Effect.Effect<Response, CloudFetchFailure, CloudFetchService> =>
  Effect.gen(function* () {
    const fetch = yield* CloudFetchService;
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, init),
      catch: () => networkFailure(url),
    });
    if (!response.ok) {
      return yield* Effect.fail(httpFailure(url, response.status));
    }
    return response;
  });
