import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  isCredentialProviderId,
  providerRunsSessionsInCloud,
} from "./credential-providers.js";

test("accepts only a provider the build ships", () => {
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.CONDUCTOR), true);
  assert.equal(isCredentialProviderId("openai"), false, "the voice key of LUKE-205 is gone");
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
    // A pasted key has an editor to say where to fetch one, and a page to
    // fetch it from. A consent grant has neither: nothing is fetched by hand.
    if (provider.connection === CREDENTIAL_CONNECTION.KEY) {
      assert.ok(provider.hint, provider.id);
      assert.ok(provider.apiKeysUrl, provider.id);
      assert.ok(provider.hint.destination.length > 0, provider.id);
    } else {
      assert.equal(provider.hint, undefined, provider.id);
      assert.equal(provider.apiKeysUrl, undefined, provider.id);
    }
    // The environment fallback is `<PROVIDER>_API_KEY`, and a provider may
    // honour more names beside it.
    assert.ok(provider.environmentVariables.length > 0, provider.id);
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // A declared format has to say what it wants as well as refuse, because
    // the reason is the only thing the user has to act on.
    if (!provider.keyFormat) continue;
    assert.ok(provider.keyFormat.prefix.length > 0, provider.id);
    assert.ok(provider.keyFormat.label.length > 0, provider.id);
  }
});

test("the Providers section is exactly the registry", () => {
  // A provider missing from the section would hold a key no row can enter.
  // Voice holds no credential of its own, so nothing stands apart from it.
  assert.deepEqual(
    CLOUD_AGENT_PROVIDER_LIST.map((provider) => provider.id).sort(),
    CREDENTIAL_PROVIDER_LIST.map((provider) => provider.id).sort(),
  );
});

test("the cloud badge belongs to every agent the registry names", () => {
  // The badge says a provider's sessions run in a cloud service, which is
  // what every key this build holds buys.
  for (const provider of CLOUD_AGENT_PROVIDER_LIST) {
    assert.equal(providerRunsSessionsInCloud(provider.id), true, provider.id);
  }
});

test("holds no key format for a provider that publishes one kind of key", () => {
  // Conductor publishes one kind of key, so it has no format worth holding a
  // credential to.
  assert.equal(CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR].keyFormat, undefined);
});
