import assert from "node:assert/strict";
import { symmetricEncrypt } from "better-auth/crypto";
import { oAuthProxy } from "better-auth/plugins";
import { test } from "vitest";
import { authDeployment, LOCAL_AUTH_URL } from "../server/auth-deployment";
import {
  authProxy,
  isTrustedProxyCallback,
  oauthProxyCallbackURL,
  resumeAuthorizeURL,
} from "../server/auth-proxy";

const PRODUCTION_URL = "https://tryluke.dev";

test("production names the registered address and trusts nothing beyond it", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "production",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
    BETTER_AUTH_PROXY_SECRET: "shared",
    BETTER_AUTH_PROXY_TRUSTED_ORIGINS: "https://luke-web-*-stage-review.vercel.app",
  });

  assert.equal(deployment.baseURL, PRODUCTION_URL);
  assert.deepEqual(deployment.trustedOrigins, []);
  assert.equal(deployment.productionURL, PRODUCTION_URL);
  assert.equal(deployment.acceptsProxyProfiles, false);
  assert.equal("oAuthProxy" in authProxy(deployment).endpoints, false);
  assert.equal(authProxy(deployment).hooks.before.length > 0, true);
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
  assert.equal(deployment.acceptsProxyProfiles, true);
  assert.equal("oAuthProxy" in authProxy(deployment).endpoints, true);
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
  assert.equal(deployment.acceptsProxyProfiles, false);
});

test("a machine with no deployment at all answers on the dev server", () => {
  const deployment = authDeployment({});

  assert.equal(deployment.baseURL, LOCAL_AUTH_URL);
  assert.deepEqual(deployment.trustedOrigins, []);
  assert.equal(deployment.productionURL, undefined);
  assert.equal(deployment.proxySecret, undefined);
  assert.equal(deployment.acceptsProxyProfiles, false);
  assert.equal("oAuthProxy" in authProxy(deployment).endpoints, false);
  assert.deepEqual(authProxy(deployment).hooks, { before: [], after: [] });
});

test("a Preview without a dedicated proxy secret refuses returned profiles", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
    BETTER_AUTH_PROXY_SECRET: "  ",
  });

  assert.equal(deployment.proxySecret, undefined);
  assert.equal(deployment.acceptsProxyProfiles, false);
  assert.equal("oAuthProxy" in authProxy(deployment).endpoints, false);
  assert.equal(authDeployment({ BETTER_AUTH_PROXY_SECRET: "shared" }).proxySecret, "shared");
});

test("the production relay accepts only this project's Preview callback", () => {
  const trustedOrigins = ["https://luke-web-*-stage-review.vercel.app"];
  const preview = "https://luke-web-git-fix-auth-stage-review.vercel.app";

  assert.equal(
    isTrustedProxyCallback(
      `${preview}/api/auth/oauth-proxy-callback?callbackURL=%2Fadmin`,
      trustedOrigins,
    ),
    true,
  );
  assert.equal(
    isTrustedProxyCallback(
      `https://attacker.example/api/auth/oauth-proxy-callback?callbackURL=%2Fadmin`,
      trustedOrigins,
    ),
    false,
  );
  assert.equal(
    isTrustedProxyCallback(
      `${preview}/api/auth/oauth-proxy-callback?callbackURL=https%3A%2F%2Fattacker.example`,
      trustedOrigins,
    ),
    false,
  );
  assert.equal(
    isTrustedProxyCallback(
      `${preview}.attacker.example/api/auth/oauth-proxy-callback?callbackURL=%2Fadmin`,
      trustedOrigins,
    ),
    false,
  );
});

test("the relay reads the callback only from state encrypted with the proxy key", async () => {
  const secret = "shared-secret-at-least-thirty-two-characters";
  const callbackURL =
    "https://luke-web-git-fix-auth-stage-review.vercel.app/api/auth/oauth-proxy-callback?callbackURL=%2Fadmin";
  const stateCookie = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify({ callbackURL }),
  });
  const state = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify({ isOAuthProxy: true, stateCookie }),
  });

  assert.equal(await oauthProxyCallbackURL(state, secret), callbackURL);
  assert.equal(
    await oauthProxyCallbackURL(state, "another-secret-at-least-thirty-two-characters"),
    undefined,
  );

  const truthyStringState = await symmetricEncrypt({
    key: secret,
    data: JSON.stringify({ isOAuthProxy: "true", state: "nonce", stateCookie }),
  });
  assert.equal(await oauthProxyCallbackURL(truthyStringState, secret), callbackURL);
});

test("a preview's sign-in returns to the desktop's authorize request, unsigned and without the login prompt", () => {
  const signedQuery =
    "response_type=code&client_id=luke-desktop&redirect_uri=http%3A%2F%2F127.0.0.1%3A54698%2Fcallback" +
    "&scope=openid+profile&state=google.abc&code_challenge=xyz&code_challenge_method=S256&prompt=login" +
    "&exp=1789770969&ba_iat=1789770369176&ba_param=ba_iat&ba_param=client_id&sig=zjn6%3D";

  const resumed = new URL(
    resumeAuthorizeURL("https://luke-abc123-luke.vercel.app/api/auth/", signedQuery),
  );

  assert.equal(
    resumed.origin + resumed.pathname,
    "https://luke-abc123-luke.vercel.app/api/auth/oauth2/authorize",
  );
  assert.deepEqual(Object.fromEntries(resumed.searchParams), {
    response_type: "code",
    client_id: "luke-desktop",
    redirect_uri: "http://127.0.0.1:54698/callback",
    scope: "openid profile",
    state: "google.abc",
    code_challenge: "xyz",
    code_challenge_method: "S256",
  });
});

test("only a preview carries the sign-in hook that names that return, ahead of the proxy's own", () => {
  const plugin = oAuthProxy({ productionURL: PRODUCTION_URL, secret: "shared" });
  const preview = authProxy(
    authDeployment({
      VERCEL_ENV: "preview",
      VERCEL_URL: "luke-abc123-luke.vercel.app",
      BETTER_AUTH_URL: PRODUCTION_URL,
      BETTER_AUTH_PROXY_SECRET: "shared",
    }),
  );
  const production = authProxy(
    authDeployment({
      VERCEL_ENV: "production",
      BETTER_AUTH_URL: PRODUCTION_URL,
      BETTER_AUTH_PROXY_SECRET: "shared",
    }),
  );

  // The preview adds one hook ahead of the plugin's; production adds only the relay guard, and keeps the plugin's own.
  assert.equal(preview.hooks.before.length, plugin.hooks.before.length + 1);
  assert.notEqual(preview.hooks.before[0], plugin.hooks.before[0]);
  assert.equal(production.hooks.before.length, plugin.hooks.before.length + 1);
  assert.equal(production.hooks.before[0] === preview.hooks.before[0], false);
});
