import assert from "node:assert/strict";
import type { ConfigEnv, UserConfig } from "vite";
import { afterEach, test, vi } from "vitest";

/**
 * The web app's client build writes source maps, hidden, only where it will
 * upload them: a production build holding `SENTRY_AUTH_TOKEN`, on the same
 * gate the functions' bundler and the eve roots ask
 * (`@luke/service/observability/source-maps`). The SSR build, which only
 * prerenders, writes none.
 */

/** The build options `vite.config.ts` answers for one build under `environment`. */
async function buildConfig(
  environment: Readonly<Record<string, string>>,
  isSsrBuild: boolean,
): Promise<UserConfig["build"]> {
  vi.resetModules();
  vi.stubEnv("SENTRY_AUTH_TOKEN", environment.SENTRY_AUTH_TOKEN ?? "");
  vi.stubEnv("VERCEL_ENV", environment.VERCEL_ENV ?? "");
  const loaded: { default: (env: ConfigEnv) => UserConfig } = await import("../vite.config");
  return loaded.default({ command: "build", mode: "production", isSsrBuild }).build;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test("only a production client build holding the token writes hidden source maps", async () => {
  const production = { SENTRY_AUTH_TOKEN: "test-token", VERCEL_ENV: "production" };
  assert.equal((await buildConfig(production, false))?.sourcemap, "hidden");
  assert.equal((await buildConfig(production, true))?.sourcemap, false);
  for (const environment of [
    { SENTRY_AUTH_TOKEN: "test-token", VERCEL_ENV: "preview" },
    { SENTRY_AUTH_TOKEN: "test-token" },
    { VERCEL_ENV: "production" },
    { SENTRY_AUTH_TOKEN: "", VERCEL_ENV: "production" },
  ]) {
    assert.equal(
      (await buildConfig(environment, false))?.sourcemap,
      false,
      JSON.stringify(environment),
    );
  }
});
