import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { test } from "vitest";
import { authDeployment } from "./auth-deployment.js";

const PRODUCTION_URL = "https://tryluke.dev";

const PRODUCTION = {
  VERCEL_ENV: "production",
  VERCEL_URL: "luke-abc123-luke.vercel.app",
  BETTER_AUTH_URL: PRODUCTION_URL,
  BETTER_AUTH_PROXY_SECRET: "shared",
} as const;

/** Whether production's Better Auth, through its own matcher, trusts the origin. */
async function productionTrusts(origin: string): Promise<boolean> {
  const deployment = authDeployment(PRODUCTION);
  const auth = betterAuth({
    baseURL: deployment.baseURL,
    trustedOrigins: deployment.trustedOrigins,
    secret: "production-session-secret-of-enough-length",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  });
  return (await auth.$context).isTrustedOrigin(origin);
}

test("production names the registered address", () => {
  const deployment = authDeployment(PRODUCTION);

  assert.equal(deployment.baseURL, PRODUCTION_URL);
  assert.equal(deployment.productionURL, PRODUCTION_URL);
});

test("production trusts every preview, by deployment or by branch, and the dev server, as the OAuth proxy's docs prescribe", async () => {
  assert.ok(await productionTrusts(PRODUCTION_URL));
  assert.ok(await productionTrusts("https://luke-abc123xyz-stage-review.vercel.app"));
  assert.ok(await productionTrusts("https://luke-web-git-feature-branch-stage-review.vercel.app"));
  assert.ok(await productionTrusts("http://localhost:5173"));
});

test("production trusts no other host", async () => {
  assert.equal(await productionTrusts("https://evil-stage-review.vercel.app"), false);
  assert.equal(await productionTrusts("https://luke-abc-stage-review.vercel.app.evil.com"), false);
  assert.equal(await productionTrusts("https://luke-abc-stage-review.evil.com"), false);
  assert.equal(await productionTrusts("http://luke-abc-stage-review.vercel.app"), false);
  assert.equal(await productionTrusts("http://localhost:3000"), false);
});

test("a preview trusts its own hostnames and no other preview", () => {
  const deployment = authDeployment({
    VERCEL_ENV: "preview",
    VERCEL_URL: "luke-abc123-stage-review.vercel.app",
    VERCEL_BRANCH_URL: "luke-web-git-feature-stage-review.vercel.app",
    BETTER_AUTH_URL: PRODUCTION_URL,
  });

  assert.equal(deployment.baseURL, "https://luke-abc123-stage-review.vercel.app");
  assert.deepEqual(deployment.trustedOrigins, [
    "https://luke-web-git-feature-stage-review.vercel.app",
  ]);
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
