import assert from "node:assert/strict";
import test from "node:test";
import { codeChallenge, createCodeVerifier } from "./pkce.js";

test("S256 matches RFC 7636's published verifier and challenge", () => {
  assert.equal(
    codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("generated verifiers have RFC-safe length and characters", () => {
  const verifier = createCodeVerifier();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
});
