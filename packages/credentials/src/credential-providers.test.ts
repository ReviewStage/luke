import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  INTEGRATION_PROVIDER_LIST,
  isCredentialProviderId,
  providerRunsSessionsInCloud,
  VOICE_CREDENTIAL_PROVIDER,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "./credential-providers.js";

test("accepts only a provider the build ships", () => {
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.CONDUCTOR), true);
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.CURSOR), true);
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.DEVIN), true);
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
      // One sentence shape for every key: what to create and where, ending on
      // the destination the link sits on, named as a ">" path with no closing
      // punctuation of its own — the renderer supplies the full stop.
      assert.match(provider.hint.lead, /^Create a .+ under$/, provider.id);
      assert.ok(provider.hint.destination.length > 0, provider.id);
      assert.doesNotMatch(provider.hint.destination, /[.·]/, provider.id);
    } else {
      assert.equal(provider.hint, undefined, provider.id);
      assert.equal(provider.apiKeysUrl, undefined, provider.id);
    }
    // The environment fallback is `<PROVIDER>_API_KEY` — except OpenAI, which
    // deliberately offers none (a key that costs money and moves the review
    // path is connected by hand or not at all), and except a provider
    // connected by consent, where there is no key for an environment to hold.
    if (
      provider.id === CREDENTIAL_PROVIDER_ID.OPENAI ||
      provider.connection === CREDENTIAL_CONNECTION.CONSENT
    ) {
      assert.deepEqual(provider.environmentVariables, [], provider.id);
    } else {
      assert.ok(provider.environmentVariables[0]?.endsWith("_API_KEY"), provider.id);
    }
    // A consent grant is never typed, so no format could refuse one.
    if (provider.connection === CREDENTIAL_CONNECTION.CONSENT) {
      assert.equal(provider.keyFormat, undefined, provider.id);
    }
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // A declared format has to say what it wants as well as refuse, because
    // the reason is the only thing the user has to act on.
    if (!provider.keyFormat) continue;
    assert.ok(provider.keyFormat.prefix.length > 0, provider.id);
    assert.ok(provider.keyFormat.label.length > 0, provider.id);
    assert.ok(provider.keyFormat.rejection.includes(provider.keyFormat.prefix), provider.id);
  }
});

test("splits the settings sections without losing a provider", () => {
  // The sections together are exactly the registry: a provider missing from
  // all of them would hold a key no row can enter, and one in two would be
  // asked for the same key twice. The voice key stands apart because its row
  // is drawn on the Voice page rather than under Connections.
  assert.deepEqual(
    [...CLOUD_AGENT_PROVIDER_LIST, ...INTEGRATION_PROVIDER_LIST, VOICE_CREDENTIAL_PROVIDER]
      .map((provider) => provider.id)
      .sort(),
    CREDENTIAL_PROVIDER_LIST.map((provider) => provider.id).sort(),
  );
  assert.deepEqual(
    INTEGRATION_PROVIDER_LIST.map((provider) => provider.id),
    [CREDENTIAL_PROVIDER_ID.LINEAR],
  );
});

test("the cloud badge belongs to the agents alone", () => {
  // The badge says a provider's sessions run in a cloud service. Linear's
  // issues and OpenAI's voice are services Luke uses rather than sessions he
  // watches, so a badge on their marks would claim sessions neither has.
  for (const provider of CLOUD_AGENT_PROVIDER_LIST) {
    assert.equal(providerRunsSessionsInCloud(provider.id), true, provider.id);
  }
  assert.equal(providerRunsSessionsInCloud(CREDENTIAL_PROVIDER_ID.LINEAR), false);
  assert.equal(providerRunsSessionsInCloud(CREDENTIAL_PROVIDER_ID.OPENAI), false);
});

test("sends the user to the one GitHub token kind the agent-tasks API answers", () => {
  const copilot = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.COPILOT];

  assert.equal(copilot.displayName, "Copilot");
  assert.deepEqual(copilot.environmentVariables, ["COPILOT_API_KEY"]);
  // A pasted key carries both, and the matches below are what they must say.
  assert.ok(copilot.hint);
  assert.ok(copilot.apiKeysUrl);
  // The endpoint takes only user tokens, and GitHub also issues the kinds it
  // refuses, so the copy has to name what to create and what will not work.
  assert.match(copilot.hint.lead, /fine-grained personal access token/i);
  assert.match(copilot.hint.caveat ?? "", /Agent tasks/);
  assert.match(copilot.hint.caveat ?? "", /installation/i);
  assert.match(copilot.apiKeysUrl, /personal-access-tokens\/new$/);
  // No key format: fine-grained PATs and GitHub App user tokens carry
  // different prefixes, and a single one would refuse a working credential.
  assert.equal(copilot.keyFormat, undefined);
});

test("takes only the Devin credentials its API version issues", () => {
  const devin = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.DEVIN];

  assert.equal(devin.displayName, "Devin");
  assert.deepEqual(devin.environmentVariables, ["DEVIN_API_KEY"]);
  // Luke reads Devin's v3 API, whose credentials all carry one prefix. The
  // deprecated v1 and v2 keys carry another and would only ever be refused.
  assert.equal(devin.keyFormat?.prefix, "cog_");
  // Devin calls this a personal access token, and the settings field has to
  // call it that too: its Settings > API keys page issues the `apk_` keys Luke
  // refuses, so asking for an "API key" would send the user to the wrong one.
  assert.equal(devin.keyFormat?.label, "Personal access token");
  assert.ok(devin.apiKeysUrl);
  assert.match(devin.apiKeysUrl, /devin-api\?tab=pats$/);
  for (const legacy of ["apk_service-key", "apk_user_personal-key"]) {
    assert.equal(legacy.startsWith(devin.keyFormat?.prefix ?? ""), false, legacy);
  }
  // Conductor and Cursor each publish one kind of key, so neither has a format
  // worth holding a credential to.
  for (const providerId of [CREDENTIAL_PROVIDER_ID.CONDUCTOR, CREDENTIAL_PROVIDER_ID.CURSOR]) {
    assert.equal(CREDENTIAL_PROVIDERS[providerId].keyFormat, undefined, providerId);
  }
});

test("connects Linear by consent rather than by a key", () => {
  const linear = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];

  assert.equal(linear.displayName, "Linear");
  assert.equal(linear.connection, CREDENTIAL_CONNECTION.CONSENT);
  // Nothing is pasted for Linear, so there is nothing for a launch
  // environment to supply, no page to send anyone to, and no shape to refuse:
  // what authorizes a read is granted on Linear's own consent page and
  // withdrawn there or from the row.
  assert.deepEqual(linear.environmentVariables, []);
  assert.equal(linear.hint, undefined);
  assert.equal(linear.apiKeysUrl, undefined);
  assert.equal(linear.keyFormat, undefined);
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
  // Realtime is what a spoken turn runs on, and an account that cannot reach it
  // fails at the first word rather than at the paste.
  assert.ok(openai.hint);
  assert.match(openai.hint.caveat ?? "", /Realtime/);
  assert.match(openai.hint.caveat ?? "", /billing/i);
  // No prefix: every kind OpenAI issues carries `sk-`, so a format would refuse
  // nothing a working key would not also be refused by.
  assert.equal(openai.keyFormat, undefined);

  // Neither an agent nor an integration: Luke speaks through it and asks it
  // about sessions, and observes nothing of it — there are no OpenAI sessions
  // for a row to belong to, and no adapter for a saved key to refresh. Its
  // row stands at the top of the Voice page, beside the feature it turns on.
  assert.equal(VOICE_CREDENTIAL_PROVIDER, openai);
  assert.equal(INTEGRATION_PROVIDER_LIST.includes(openai), false);
  assert.equal(CLOUD_AGENT_PROVIDER_LIST.includes(openai), false);
});
