import assert from "node:assert/strict";
import test from "node:test";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  isCredentialProviderId,
} from "../src/shared/credential-providers";

test("accepts only a provider the build ships", () => {
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.CONDUCTOR), true);
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.CURSOR), true);
  assert.equal(isCredentialProviderId("unknown-cloud"), false);
  // An inherited property name is not a provider, and neither is a value that
  // is not a string at all.
  assert.equal(isCredentialProviderId("toString"), false);
  assert.equal(isCredentialProviderId("__proto__"), false);
  assert.equal(isCredentialProviderId(undefined), false);
  assert.equal(isCredentialProviderId({ id: CREDENTIAL_PROVIDER_ID.CONDUCTOR }), false);
});

test("describes every provider it lists", () => {
  assert.deepEqual(CREDENTIAL_PROVIDER_LIST, Object.values(CREDENTIAL_PROVIDERS));
  for (const provider of CREDENTIAL_PROVIDER_LIST) {
    assert.equal(CREDENTIAL_PROVIDERS[provider.id], provider, "a provider is filed under its id");
    assert.ok(provider.displayName.length > 0);
    assert.ok(provider.hint.length > 0);
    // The environment fallback every provider offers is `<PROVIDER>_API_KEY`.
    assert.ok(provider.environmentVariables[0]?.endsWith("_API_KEY"), provider.id);
  }
});
