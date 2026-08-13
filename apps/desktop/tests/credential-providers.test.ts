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
