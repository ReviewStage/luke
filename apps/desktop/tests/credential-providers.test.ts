import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  INTEGRATION_PROVIDER_LIST,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../src/shared/credential-providers";

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
    assert.ok(provider.hint.length > 0);
    // The environment fallback every provider offers is `<PROVIDER>_API_KEY`.
    assert.ok(provider.environmentVariables[0]?.endsWith("_API_KEY"), provider.id);
    // A declared format has to say what it wants as well as refuse, because
    // the reason is the only thing the user has to act on.
    if (!provider.keyFormat) continue;
    assert.ok(provider.keyFormat.prefix.length > 0, provider.id);
    assert.ok(provider.keyFormat.label.length > 0, provider.id);
    assert.ok(provider.keyFormat.rejection.includes(provider.keyFormat.prefix), provider.id);
  }
});

test("splits the settings sections without losing a provider", () => {
  // The two sections together are exactly the registry: a provider missing
  // from both would hold a key no row can enter, and one in both would be
  // asked for the same key twice.
  assert.deepEqual(
    [...CLOUD_AGENT_PROVIDER_LIST, ...INTEGRATION_PROVIDER_LIST]
      .map((provider) => provider.id)
      .sort(),
    CREDENTIAL_PROVIDER_LIST.map((provider) => provider.id).sort(),
  );
  assert.deepEqual(
    INTEGRATION_PROVIDER_LIST.map((provider) => provider.id),
    [CREDENTIAL_PROVIDER_ID.LINEAR, CREDENTIAL_PROVIDER_ID.OPENAI],
  );
  // An integration's row carries its own answer to what connecting it buys.
  for (const provider of INTEGRATION_PROVIDER_LIST) {
    assert.ok(provider.description, `${provider.id} says what connecting it allows`);
  }
});

test("sends the user to the one GitHub token kind the agent-tasks API answers", () => {
  const copilot = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.COPILOT];

  assert.equal(copilot.displayName, "Copilot");
  assert.deepEqual(copilot.environmentVariables, ["COPILOT_API_KEY"]);
  // The endpoint takes only user tokens, and GitHub also issues the kinds it
  // refuses, so the copy has to name what to create and what will not work.
  assert.match(copilot.hint, /fine-grained personal access token/i);
  assert.match(copilot.hint, /Agent tasks/);
  assert.match(copilot.hint, /installation/i);
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
  // call it that too: its Settings · API keys page issues the `apk_` keys Luke
  // refuses, so asking for an "API key" would send the user to the wrong one.
  assert.equal(devin.keyFormat?.label, "Personal access token");
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

test("takes only the Linear key kind a person holds", () => {
  const linear = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];

  assert.equal(linear.displayName, "Linear");
  assert.deepEqual(linear.environmentVariables, ["LINEAR_API_KEY"]);
  // Luke reads the tracker as the user, with the key kind Linear issues to a
  // person. An OAuth token names an application acting for a workspace, which
  // is a different actor and would be refused where it matters least.
  assert.equal(linear.keyFormat?.prefix, "lin_api_");
  assert.equal(linear.keyFormat?.label, "Personal API key");
  assert.match(linear.apiKeysUrl, /^https:\/\/linear\.app\/settings\//);
});

test("holds the key Luke speaks through, apart from the agents he observes", () => {
  const openai = CREDENTIAL_PROVIDERS[VOICE_CREDENTIAL_PROVIDER_ID];

  // Voice is a credential like any other now: it can be pasted in, replaced and
  // deleted, rather than reaching the app only through the environment it was
  // launched with — which an app opened from Finder never has.
  assert.equal(isCredentialProviderId(CREDENTIAL_PROVIDER_ID.OPENAI), true);
  assert.equal(openai.displayName, "OpenAI");
  assert.deepEqual(openai.environmentVariables, ["OPENAI_API_KEY"]);
  // Realtime is what a spoken turn runs on, and an account that cannot reach it
  // fails at the first word rather than at the paste.
  assert.match(openai.hint, /Realtime/);
  assert.match(openai.hint, /billing/i);
  // No prefix: every kind OpenAI issues carries `sk-`, so a format would refuse
  // nothing a working key would not also be refused by.
  assert.equal(openai.keyFormat, undefined);

  // An integration rather than an agent: Luke speaks through it and asks it
  // about sessions, and observes nothing of it — there are no OpenAI sessions
  // for a row to belong to, and no adapter for a saved key to refresh.
  assert.ok(INTEGRATION_PROVIDER_LIST.includes(openai));
  assert.equal(CLOUD_AGENT_PROVIDER_LIST.includes(openai), false);
  // Both things the key buys are said on the row that holds it, because a
  // credential that quietly enables an outbound request should not have to be
  // learned from a README.
  assert.match(openai.description ?? "", /voice/i);
  assert.match(openai.description ?? "", /review/i);
});
