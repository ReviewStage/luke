// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as Sentry from "@sentry/browser";
import { afterEach, test, vi } from "vitest";
import { startWebSentry } from "../src/app/web-sentry";

/**
 * The tab reports to Sentry only where its build carries a DSN, under the
 * deployment's environment and release and the desktop's share of traces.
 */

// Nothing leaves the test: whatever the SDK sends is answered here.
vi.hoisted(() => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
});

const DSN = "https://public@o1.ingest.us.sentry.io/1";

afterEach(async () => {
  await Sentry.getClient()?.close();
  Sentry.getCurrentScope().setClient(undefined);
});

test("a build without a DSN starts no SDK and answers nothing to report through", async () => {
  const sentry = await startWebSentry({ dsn: "", environment: "production", release: "abc123" });
  assert.equal(sentry, undefined);
  assert.equal(Sentry.getClient(), undefined);
});

test("a build with a DSN starts the SDK under the deployment's environment and release, tracing one page load in ten", async () => {
  const sentry = await startWebSentry({ dsn: DSN, environment: "preview", release: "abc123" });
  assert.ok(sentry !== undefined);
  const options = Sentry.getClient()?.getOptions();
  assert.equal(options?.dsn, DSN);
  assert.equal(options?.environment, "preview");
  assert.equal(options?.release, "abc123");
  assert.equal(options?.tracesSampleRate, 0.1);
});
