import assert from "node:assert/strict";
import test from "node:test";
import { codeChallenge } from "./pkce.js";

test("S256 matches RFC 7636's published verifier and challenge", () => {
  assert.equal(
    codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});
