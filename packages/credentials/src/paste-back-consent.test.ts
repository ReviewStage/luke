import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { LoopbackAuthorization, LoopbackExchange } from "./consent.js";
import { PASTE_BACK_REASON, pasteBackConsent } from "./paste-back-consent.js";

const REFUSED = "Example did not grant access.";

function trip(pasted: (authorization: LoopbackAuthorization) => string) {
  let authorization: LoopbackAuthorization | undefined;
  const exchanges: LoopbackExchange[] = [];
  const consent = pasteBackConsent(
    Effect.sync(() => (authorization === undefined ? undefined : pasted(authorization))),
  )<{ token: string }>({
    callbackPath: "/callback",
    pages: {
      granted: { badge: "Signed in", title: "Signed in", body: "Close this tab." },
      notGranted: { badge: "Not signed in", title: "Not signed in", body: "Try again." },
    },
    reasons: { refused: REFUSED, timedOut: "Timed out." },
    authorizationUrl: (input) => {
      authorization = input;
      return "https://example.test/authorize";
    },
    exchange: (input) =>
      Effect.sync(() => {
        exchanges.push(input);
        return { token: "granted" };
      }),
    openExternal: () => undefined,
  });
  return { outcome: Effect.scoped(consent.signInEffect()), exchanges };
}

type Refused = readonly [
  label: string,
  pasted: (authorization: LoopbackAuthorization) => string,
  reason: string,
];

it.effect.each<Refused>([
  [
    "another trip's state",
    (at: LoopbackAuthorization) => `${at.redirectUri}?code=c&state=other`,
    PASTE_BACK_REASON.OTHER_TRIP,
  ],
  [
    "a refusal",
    (at: LoopbackAuthorization) => `${at.redirectUri}?error=access_denied&state=${at.state}`,
    REFUSED,
  ],
  ["no address at all", () => "not a url", PASTE_BACK_REASON.NOT_AN_ADDRESS],
])("refuses %s without exchanging a code", ([, pasted, reason]) =>
  Effect.gen(function* () {
    const { outcome, exchanges } = trip(pasted);
    assert.deepEqual(yield* Effect.map(outcome, (end) => "reason" in end && end.reason), reason);
    assert.deepEqual(exchanges, []);
  }),
);

it.effect("exchanges the code the trip's own redirect carried, on that redirect", () =>
  Effect.gen(function* () {
    const { outcome, exchanges } = trip(
      (at) => `  ${at.redirectUri}?code=the-code&state=${encodeURIComponent(at.state)}\n`,
    );
    assert.deepEqual(yield* outcome, { token: "granted" });
    assert.equal(exchanges[0]?.code, "the-code");
    assert.match(exchanges[0]?.redirectUri ?? "", /^http:\/\/127\.0\.0\.1:\d+\/callback$/u);
  }),
);
