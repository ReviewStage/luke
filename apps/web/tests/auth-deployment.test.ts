import assert from "node:assert/strict";
import { Redacted } from "effect";
import { test } from "vitest";
import {
  authDeployment,
  authSecrets,
  GITHUB_APP_ENVIRONMENT,
  LOCAL_AUTH_URL,
  type SocialClient,
  socialClientConfigured,
} from "../server/auth-deployment";

const PRODUCTION_URL = "https://tryluke.dev";

const GITHUB_APP = {
  [GITHUB_APP_ENVIRONMENT.CLIENT_ID]: "Iv1.fixture-app-client",
  [GITHUB_APP_ENVIRONMENT.CLIENT_SECRET]: "fixture-app-client-secret",
};
const GITHUB_OAUTH_APP = {
  GITHUB_CLIENT_ID: "the-oauth-app-from-before",
  GITHUB_CLIENT_SECRET: "its-secret",
};

/** A social client as the fixture reads it: the id beside the secret unsealed, or none. */
function revealed(client: SocialClient) {
  return {
    clientId: client.clientId,
    clientSecret:
      client.clientSecret === undefined ? undefined : Redacted.value(client.clientSecret),
  };
}

test("production names the registered address and trusts nothing beyond it", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "production",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
    BETTER_AUTH_PROXY_SECRET: "shared",
  });

  assert.equal(deployment.baseURL, PRODUCTION_URL);
  assert.deepEqual(deployment.trustedOrigins, []);
  assert.equal(deployment.productionURL, PRODUCTION_URL);
});

test("a preview names itself, so its own origin is the one it trusts", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    VERCEL_BRANCH_URL: "luke-git-fix-preview-auth-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
    BETTER_AUTH_PROXY_SECRET: "shared",
  });

  assert.equal(deployment.baseURL, "https://luke-abc123-luke.vercel.app");
  assert.deepEqual(deployment.trustedOrigins, [
    "https://luke-git-fix-preview-auth-luke.vercel.app",
  ]);
});

test("a preview reaches the providers through production's registered callback", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
    BETTER_AUTH_PROXY_SECRET: "shared",
  });

  assert.equal(deployment.productionURL, PRODUCTION_URL);
  assert.notEqual(deployment.baseURL, deployment.productionURL);
});

test("one hostname under two names is trusted once", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    VERCEL_BRANCH_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
  });

  assert.deepEqual(deployment.trustedOrigins, []);
});

test("a deployment host arrives bare and becomes an https origin", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-luke.vercel.app/",
    BETTER_AUTH_URL: PRODUCTION_URL,
  });

  assert.equal(deployment.baseURL, "https://luke-abc123-luke.vercel.app");
});

test("an unreadable preview host leaves the deployment on its production shape", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: " ",
    VERCEL_BRANCH_URL: "http://",
    BETTER_AUTH_URL: PRODUCTION_URL,
  });

  assert.equal(deployment.baseURL, PRODUCTION_URL);
  assert.deepEqual(deployment.trustedOrigins, []);
});

test("a machine with no deployment at all answers on the dev server", () => {
  const deployment = authDeployment({});

  assert.equal(deployment.baseURL, LOCAL_AUTH_URL);
  assert.deepEqual(deployment.trustedOrigins, []);
  assert.equal(deployment.productionURL, undefined);
  assert.equal(deployment.proxySecret, undefined);
});

test("a blank proxy secret is no secret", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
    BETTER_AUTH_PROXY_SECRET: "  ",
  });

  assert.equal(deployment.proxySecret, undefined);
  assert.equal(authDeployment({ BETTER_AUTH_PROXY_SECRET: "shared" }).proxySecret, "shared");
});

test("the GitHub sign-in's client is the Luke GitHub App's, read from the App's own variables", () => {
  const secrets = authSecrets({ ...GITHUB_OAUTH_APP, ...GITHUB_APP });

  assert.deepEqual(revealed(secrets.github), {
    clientId: "Iv1.fixture-app-client",
    clientSecret: "fixture-app-client-secret",
  });
  assert.equal(socialClientConfigured(secrets.github), true);
  // The Google client and the session secret are untouched by the GitHub client.
  assert.deepEqual(revealed(secrets.google), { clientId: "", clientSecret: undefined });
  assert.equal(secrets.sessionSecret, undefined);
});

test("the OAuth App from before the App is not read: without the App's client there is no GitHub sign-in", () => {
  assert.deepEqual(revealed(authSecrets(GITHUB_OAUTH_APP).github), {
    clientId: "",
    clientSecret: undefined,
  });
  assert.equal(socialClientConfigured(authSecrets(GITHUB_OAUTH_APP).github), false);
  assert.equal(socialClientConfigured(authSecrets({}).github), false);
});

test("half an App client is no client: a blank id or secret is absent, never borrowed from the OAuth App", () => {
  const withoutAppSecret = authSecrets({
    ...GITHUB_OAUTH_APP,
    [GITHUB_APP_ENVIRONMENT.CLIENT_ID]: GITHUB_APP[GITHUB_APP_ENVIRONMENT.CLIENT_ID],
    [GITHUB_APP_ENVIRONMENT.CLIENT_SECRET]: "  ",
  });
  const withoutAppId = authSecrets({
    ...GITHUB_OAUTH_APP,
    [GITHUB_APP_ENVIRONMENT.CLIENT_SECRET]: GITHUB_APP[GITHUB_APP_ENVIRONMENT.CLIENT_SECRET],
  });

  assert.deepEqual(revealed(withoutAppSecret.github), {
    clientId: "Iv1.fixture-app-client",
    clientSecret: undefined,
  });
  assert.deepEqual(revealed(withoutAppId.github), {
    clientId: "",
    clientSecret: "fixture-app-client-secret",
  });
  for (const secrets of [withoutAppSecret, withoutAppId]) {
    assert.equal(socialClientConfigured(secrets.github), false);
  }
});
