import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { codeChallenge, createCodeVerifier } from "./pkce.js";

it.effect("S256 matches RFC 7636's published verifier and challenge", () =>
  Effect.gen(function* () {
    assert.equal(
      yield* codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  }),
);

it("a verifier is 43 unpadded URL-safe characters, RFC 7636's minimum length", () => {
  assert.match(createCodeVerifier(), /^[A-Za-z0-9_-]{43}$/);
});
