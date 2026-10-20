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
  // Sentry's default data collection, as the desktop's and the service's: the
  // SDK's own `dataCollection` (v11's successor to `sendDefaultPii`), widened by nothing here.
  assert.equal(options?.dataCollection, undefined);
});

/** A refusal as the browser says it, which jsdom does not construct itself. */
function refusal(effectiveDirective: string, blockedURI: string): Event {
  return Object.assign(new Event("securitypolicyviolation"), { effectiveDirective, blockedURI });
}

test("each kind of request the page's policy refuses is sent once as a warning, by its directive and origin alone, however often the SDK starts", async () => {
  // A tab whose app mounted, closed, and mounted again starts the SDK twice.
  await startWebSentry({ dsn: DSN, environment: "production", release: "abc123" });
  await Sentry.getClient()?.close();
  await startWebSentry({ dsn: DSN, environment: "production", release: "abc123" });
  const sent: { message: string | undefined; level: string | undefined }[] = [];
  // Read before Sentry's own deduplication, which would hide a second listener's copy.
  Sentry.getClient()?.on("preprocessEvent", (event) => {
    sent.push({ message: event.message, level: event.level });
  });

  const socket = "wss://br-x-neonrealtimesocket.compute.c-10.us-east-1.aws.neon.tech/v1?token=t";
  document.dispatchEvent(refusal("connect-src", socket));
  document.dispatchEvent(refusal("connect-src", socket));
  document.dispatchEvent(refusal("script-src-elem", "inline"));
  document.dispatchEvent(refusal("img-src", "not a url?token=t"));
  await Sentry.flush(1_000);

  assert.deepEqual(sent, [
    {
      message:
        "Content-Security-Policy refused connect-src to wss://br-x-neonrealtimesocket.compute.c-10.us-east-1.aws.neon.tech",
      level: "warning",
    },
    { message: "Content-Security-Policy refused script-src-elem to inline", level: "warning" },
    {
      message: "Content-Security-Policy refused img-src to an unreadable address",
      level: "warning",
    },
  ]);
});
