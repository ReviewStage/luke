import assert from "node:assert/strict";
import test from "node:test";
import { authDeployment, LOCAL_AUTH_URL } from "../server/auth-deployment";

const PRODUCTION_URL = "https://tryluke.dev";

test("production names the registered address and trusts nothing beyond it", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "production",
    VERCEL_URL: "luke-abc123-luke.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
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

test("a blank proxy secret is absent, so the proxy falls back to the auth secret", () => {
  assert.equal(authDeployment({ BETTER_AUTH_PROXY_SECRET: "  " }).proxySecret, undefined);
  assert.equal(authDeployment({ BETTER_AUTH_PROXY_SECRET: "shared" }).proxySecret, "shared");
});
