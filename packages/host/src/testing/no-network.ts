/**
 * no-network.ts -- the `HttpClient` a composer's suite hands over where its fake service answers every call.
 *
 * Every composer asks the service over the host's own `HttpClient`, so a
 * suite whose fake client never sends a request still provides one. This is
 * that one: a request that does reach it fails as a transport error, which
 * every client answers as unanswered, and never touches the network.
 */

import { fakeHttpClientLayer } from "@luke/wire/testing";

export const noNetworkHttpClient = fakeHttpClientLayer(() => {
  throw new Error("this suite sends nothing over the network");
});
