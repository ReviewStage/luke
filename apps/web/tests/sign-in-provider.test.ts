import assert from "node:assert/strict";
import test from "node:test";
import { SOCIAL_PROVIDER, socialProviderFromState } from "../src/sign-in-provider";

test("the signed desktop state fixes the one provider the hosted flow may use", () => {
  assert.equal(socialProviderFromState("google.random-state"), SOCIAL_PROVIDER.GOOGLE);
  assert.equal(socialProviderFromState("github.random-state"), SOCIAL_PROVIDER.GITHUB);
});

test("a missing or unknown provider hint cannot choose a fallback identity", () => {
  assert.equal(socialProviderFromState(null), undefined);
  assert.equal(socialProviderFromState("unknown.random-state"), undefined);
});
