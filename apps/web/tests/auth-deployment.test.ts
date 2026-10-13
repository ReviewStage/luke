import assert from "node:assert/strict";
import { symmetricEncrypt } from "better-auth/crypto";
import { test } from "vitest";
import { authDeployment } from "../server/auth-deployment";
import { authProxy, isTrustedProxyCallback, oauthProxyCallbackURL } from "../server/auth-proxy";

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
