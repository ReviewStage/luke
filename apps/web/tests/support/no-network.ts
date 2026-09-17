/**
 * no-network.ts -- the HttpClient a suite that reaches no network hands where production reads one.
 */

import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, type Layer } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { EveUnreachable } from "../../server/hosted/brain-host/eve-sessions";

/**
 * A client that refuses every request. The suites that hand it stand a fake
 * eve in place of the real client, so nothing they run sends; a request that
 * did reach this is a test composing a client it meant to fake, and this is
 * what makes that a failure rather than a call onto the network.
 */
export const noNetwork: Layer.Layer<HttpClient.HttpClient> = fakeHttpClientLayer(() => {
  throw new Error("this test reaches no network");
});

/** eve as a fake that never reached it answers: the client's own transport error, on a request to eve's session route. */
export function eveUnreachable(origin = "https://eve.test"): Effect.Effect<never, EveUnreachable> {
  const request = HttpClientRequest.post(`${origin}/eve/v1/session`);
  return Effect.fail(
    new EveUnreachable({
      cause: new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          cause: new Error("fixture: eve unreachable"),
        }),
      }),
    }),
  );
}
