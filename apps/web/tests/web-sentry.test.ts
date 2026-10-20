// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Sentry from "@sentry/browser";
import { Effect } from "effect";
import { afterEach, test, vi } from "vitest";
import { startWebSentry } from "../src/app/web-sentry";

/**
 * The tab reports to Sentry only where its build carries a DSN, under the
 * deployment's environment and release and the desktop's share of traces;
 * what is reported before the SDK's chunk lands waits for it.
 */

// Nothing leaves the test: whatever the SDK sends is kept here and answered.
const { sentBodies } = vi.hoisted(() => {
  const sentBodies: string[] = [];
  globalThis.fetch = async (_input, init) => {
    if (typeof init?.body === "string") sentBodies.push(init.body);
    return new Response("{}", { status: 200 });
  };
  return { sentBodies };
});

const DSN = "https://public@o1.ingest.us.sentry.io/1";

const PRODUCTION = { dsn: DSN, environment: "production", release: "abc123" } as const;

afterEach(async () => {
  await Sentry.getClient()?.close();
  Sentry.getCurrentScope().setClient(undefined);
  sentBodies.length = 0;
});

/** The exceptions' messages the SDK sent, read from the envelopes it posted. */
function sentExceptions(): string[] {
  return sentBodies.flatMap((body) =>
    body
      .split("\n")
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
      .flatMap((item) => item?.exception?.values ?? [])
      .map((exception: { value?: string }) => exception.value ?? ""),
  );
}

test("a build without a DSN starts no SDK and sends nothing, a blank tab's report among it", async () => {
  const sentry = startWebSentry({ dsn: "", environment: "production", release: "abc123" });
  sentry.reportBlankTab(new Error("nothing drawn"));
  await sentry.settled;
  assert.equal(Sentry.getClient(), undefined);
  assert.deepEqual(sentBodies, []);
});

test("a build with a DSN starts the SDK under the deployment's environment and release, tracing one page load in ten", async () => {
  await startWebSentry({ dsn: DSN, environment: "preview", release: "abc123" }).settled;
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
function refusal(effectiveDirective: string, blockedURI: string, sourceFile = ""): Event {
  return Object.assign(new Event("securitypolicyviolation"), {
    effectiveDirective,
    blockedURI,
    sourceFile,
  });
}

test("each kind of request the page's policy refuses is sent once as a warning, by its directive and origin alone, however often the SDK starts", async () => {
  // A tab whose app mounted, closed, and mounted again starts the SDK twice.
  await startWebSentry(PRODUCTION).settled;
  await Sentry.getClient()?.close();
  await startWebSentry(PRODUCTION).settled;
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
  // The same origin under another directive is another kind, and so is another origin under the same.
  document.dispatchEvent(refusal("img-src", socket));
  document.dispatchEvent(refusal("connect-src", "wss://other.example/socket"));
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
    {
      message:
        "Content-Security-Policy refused img-src to wss://br-x-neonrealtimesocket.compute.c-10.us-east-1.aws.neon.tech",
      level: "warning",
    },
    {
      message: "Content-Security-Policy refused connect-src to wss://other.example",
      level: "warning",
    },
  ]);
});

test("a refusal of a browser extension's address, or of what its own script did, is not sent", async () => {
  await startWebSentry(PRODUCTION).settled;
  const sent: (string | undefined)[] = [];
  Sentry.getClient()?.on("preprocessEvent", (event) => {
    sent.push(event.message);
  });

  document.dispatchEvent(refusal("script-src-elem", "chrome-extension://abcdef/inject.js"));
  document.dispatchEvent(refusal("img-src", "moz-extension://1234-5678/icon.png"));
  document.dispatchEvent(refusal("style-src-elem", "safari-web-extension://x/style.css"));
  document.dispatchEvent(refusal("font-src", "chrome-extension"));
  document.dispatchEvent(
    refusal("style-src-attr", "inline", "chrome-extension://abcdef/content.js"),
  );
  document.dispatchEvent(refusal("frame-src", "https://extension.example/frame"));
  await Sentry.flush(1_000);

  assert.deepEqual(sent, [
    "Content-Security-Policy refused frame-src to https://extension.example",
  ]);
});

test("a refusal said before the SDK's chunk lands is sent once it does", async () => {
  const sentry = startWebSentry(PRODUCTION);
  // Said in the same turn the tab started in, long before the chunk could land.
  document.dispatchEvent(refusal("connect-src", "wss://early.example/socket?token=t"));
  await sentry.settled;
  await Sentry.flush(1_000);

  assert.ok(
    sentBodies.some((body) =>
      body.includes("Content-Security-Policy refused connect-src to wss://early.example"),
    ),
  );
  assert.ok(sentBodies.every((body) => !body.includes("token=t")));
});

it.effect(
  "a failure an Effect boundary of the tab's runtime reports before the SDK lands is sent once it does",
  () =>
    Effect.gen(function* () {
      const sentry = startWebSentry(PRODUCTION);

      yield* Effect.exit(
        Effect.withErrorReporting(Effect.die(new Error("the host's follow fell over")), {
          defectsOnly: true,
        }).pipe(Effect.provide(sentry.errorReporting)),
      );
      yield* Effect.promise(() => sentry.settled);
      yield* Effect.promise(() => Sentry.flush(1_000));

      assert.deepEqual(sentExceptions(), ["the host's follow fell over"]);
    }),
);

test("each page load and navigation, and the errors under it, are named by the kind of place it opens, never by its slug or ids", async () => {
  history.replaceState(null, "", "/acme/plan/0b805267-0061-4b69-8e2c-964920ec4a30");
  const named: string[] = [];
  const transactions: (string | undefined)[] = [];
  // Each navigation follows a press, as a link's does; one with none this soon is told as a redirect.
  const navigate = (path: string) => {
    document.dispatchEvent(new MouseEvent("click"));
    history.pushState(null, "", path);
    transactions.push(Sentry.getCurrentScope().getScopeData().transactionName);
  };

  await startWebSentry(PRODUCTION).settled;
  transactions.push(Sentry.getCurrentScope().getScopeData().transactionName);
  Sentry.getClient()?.on("spanStart", (span) => {
    const { name, attributes } = Sentry.spanToJSON(span);
    if (attributes?.["sentry.op"] === "navigation") named.push(name);
  });
  navigate("/acme/plan/0b805267-0061-4b69-8e2c-964920ec4a30/agent/f458cf99");
  navigate("/acme/inbox");
  navigate("/app");
  navigate("/acme/nothing-here/at-all");

  assert.deepEqual(named, ["/app/agent", "/app/inbox", "/app", "/app"]);
  assert.deepEqual(transactions, ["/app/task", "/app/agent", "/app/inbox", "/app", "/app"]);
});
