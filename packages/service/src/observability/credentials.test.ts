import assert from "node:assert/strict";
import { it } from "vitest";
import { redactCredentials } from "./credentials.js";

it("a failure message keeps its words and loses every run shaped like a credential", () => {
  assert.equal(
    redactCredentials("Rate limit reached for gpt-5 in organization org-fixture on tokens per min"),
    "Rate limit reached for gpt-5 in organization org-fixture on tokens per min",
  );
  assert.equal(redactCredentials("key sk-fixture0001 refused"), "key [redacted] refused");
  assert.equal(
    redactCredentials("Authorization: Bearer abc.def refused"),
    "Authorization: [redacted] refused",
  );
  assert.equal(
    redactCredentials(`token eyJ${"a".repeat(16)}.payload expired`),
    "token [redacted] expired",
  );
  assert.equal(
    redactCredentials(`digest ${"0f".repeat(16)} mismatched`),
    "digest [redacted] mismatched",
  );
  assert.equal(
    redactCredentials(`blob ${"Ab+/".repeat(8)}= mismatched`),
    "blob [redacted] mismatched",
  );
  assert.equal(
    redactCredentials("url ?api_key=fixture&token=fixture&error=model_not_found secret=fixture"),
    "url ?[redacted]&[redacted]&error=model_not_found [redacted]",
  );
  // A named value is taken whole before the bare run can take its head and leave its tail.
  assert.equal(redactCredentials(`token=${"A".repeat(40)}-tail refused`), "[redacted] refused");
  assert.equal(
    redactCredentials(`{"api_key": "short-mixed_secret", "model": "gpt-5"}`),
    `{"[redacted]", "model": "gpt-5"}`,
  );
  assert.equal(
    redactCredentials(`id AKIA${"A".repeat(16)} and ${"a_b-".repeat(9)} refused`),
    "id [redacted] and [redacted] refused",
  );
  assert.equal(redactCredentials("Invalid API key provided"), "Invalid API key provided");
  assert.equal(
    redactCredentials(`{"accessToken": "fixture.value"} client_secret:fixture refused`),
    `{"[redacted]"} [redacted] refused`,
  );
});

it("a name however long its prefix still loses its whole value", () => {
  // Note that the value carries a dot, so the bare run cannot take it in the name's place.
  assert.equal(
    redactCredentials(`${"a".repeat(60)}api_key=fixture.value refused`),
    "[redacted] refused",
  );
  assert.equal(
    redactCredentials(`${"a".repeat(100)}_api_key=fixture.value refused`),
    "[redacted][redacted] refused",
  );
});
