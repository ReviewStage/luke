/**
 * no-network.ts -- the HttpClient a suite that reaches no network hands where production reads one.
 */

import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import type { Layer } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";

/**
 * A client that refuses every request. The suites that hand it stand a fake
 * eve in place of the real client, so nothing they run sends; a request that
 * did reach this is a test composing a client it meant to fake, and this is
 * what makes that a failure rather than a call onto the network.
 */
export const noNetwork: Layer.Layer<HttpClient.HttpClient> = fakeHttpClientLayer(() => {
  throw new Error("this test reaches no network");
});
