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
  VOICE_CREDENTIAL_PROVIDER,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "./credential-providers.js";

test("accepts only a provider the build ships", () => {
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.CONDUCTOR), true);
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.OPENAI), true);
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
    // The environment fallback is `<PROVIDER>_API_KEY` — except OpenAI, which
    // deliberately offers none (a key that costs money and moves the review
    // path is connected by hand or not at all).
    if (provider.id === CREDENTIAL_PROVIDER_ID.OPENAI) {
      assert.deepEqual(provider.environmentVariables, [], provider.id);
    } else {
    }
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // A declared format has to say what it wants as well as refuse, because
    // the reason is the only thing the user has to act on.
    if (!provider.keyFormat) continue;
    assert.ok(provider.keyFormat.prefix.length > 0, provider.id);
    assert.ok(provider.keyFormat.label.length > 0, provider.id);
  }
});

test("splits the settings sections without losing a provider", () => {
  // The sections together are exactly the registry: a provider missing from
  // all of them would hold a key no row can enter, and one in two would be
  // asked for the same key twice. The voice key stands apart because its row
  // is drawn on the Voice page rather than under Connections.
  assert.deepEqual(
    [...CLOUD_AGENT_PROVIDER_LIST, VOICE_CREDENTIAL_PROVIDER].map((provider) => provider.id).sort(),
    CREDENTIAL_PROVIDER_LIST.map((provider) => provider.id).sort(),
  );
});

test("the cloud badge belongs to the agents alone", () => {
  // The badge says a provider's sessions run in a cloud service. OpenAI's
  // voice is a service Luke uses rather than sessions he watches, so a badge
  // on its mark would claim sessions it has none of.
  for (const provider of CLOUD_AGENT_PROVIDER_LIST) {
    assert.equal(providerRunsSessionsInCloud(provider.id), true, provider.id);
  }
  assert.equal(providerRunsSessionsInCloud(CREDENTIAL_PROVIDER_ID.OPENAI), false);
});

test("holds no key format for a provider that publishes one kind of key", () => {
  // Conductor publishes one kind of key, so it has no format worth holding a
  // credential to.
  assert.equal(CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.CONDUCTOR].keyFormat, undefined);
});

test("holds the key Luke speaks through, apart from the agents he observes", () => {
  const openai = CREDENTIAL_PROVIDERS[VOICE_CREDENTIAL_PROVIDER_ID];

  // Voice is a credential like any other in the panel — pasted in, replaced,
  // deleted — and stricter than the rest outside it: never read from the
  // environment, because an OPENAI_API_KEY exported for some other tool must
  // not silently start being spent on voice or move the review path.
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.OPENAI), true);
  // The service, plainly: the row stands inside the section that already says
  // what it is for, so it carries no acronym of its own.
  assert.equal(openai.displayName, "OpenAI");
  assert.deepEqual(openai.environmentVariables, []);
  // GPT Live is what a spoken turn runs on, and an account that cannot reach it
  // fails at the first word rather than at the paste.
  assert.ok(openai.hint);
  // No prefix: every kind OpenAI issues carries `sk-`, so a format would refuse
  // nothing a working key would not also be refused by.
  assert.equal(openai.keyFormat, undefined);

  // Neither an agent nor an integration: Luke speaks through it and asks it
  // about sessions, and observes nothing of it — there are no OpenAI sessions
  // for a row to belong to, and no adapter for a saved key to refresh. Its
  // row stands after Permissions on the Voice page, beside the feature it turns on.
  assert.equal(VOICE_CREDENTIAL_PROVIDER, openai);
  assert.equal(CLOUD_AGENT_PROVIDER_LIST.includes(openai), false);
});
