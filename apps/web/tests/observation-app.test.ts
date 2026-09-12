import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import { routeFromHttpApp } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
import {
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The observation group carries each route's own promise-shaped handler
 * unchanged, so what this holds is that carrying: the group's `HttpRouter`
 * dispatches the right path to the right handler, on any method (a wrong one
 * is the handler's own 405, never the group's 404), and the response —
 * status, headers, and bytes — crosses the `HttpServerRequest`/
 * `HttpServerResponse` adaptor exactly as the handler answered it.
 *
 * `server/observation-app.ts` imports `../auth.js`, which builds Better
 * Auth's instance at module load, so `DATABASE_URL` has to stand before that
 * import runs — before any `beforeEach` fires. It is set here, once, ahead of
 * the dynamic import below.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/observation-route");

/** The layer names a database and nothing here queries one, as in `web-runtime.test.ts`. */
const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/luke";
process.env.DATABASE_URL ??= PLACEHOLDER_DATABASE_URL;

const { observationApp } = await import("../server/observation-app.js");

const ORIGIN = "https://luke.test";
const ENCRYPTION_SECRET = "a".repeat(64);

interface Exchange {
  name: string;
  request: () => Request;
  handle: () => Promise<Response>;
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "sessions-messages",
    request: () => new Request(`${ORIGIN}/api/sessions/messages`),
    handle: async () => {
      const { handleConversationRead } = await import("../server/hosted/conversation-read.js");
      const { executeConversationRead } = await import("../server/hosted/action-execute.js");
      const { hostedVaultSeams } = await import("../server/hosted/vault-route.js");
      return handleConversationRead({
        ...hostedVaultSeams,
        encryptionSecret: undefined,
        request: new Request(`${ORIGIN}/api/sessions/messages`),
        execute: executeConversationRead,
      });
    },
  },
  {
    name: "projects",
    request: () => new Request(`${ORIGIN}/api/projects`),
    handle: async () => {
      const { handleProjects } = await import("../server/hosted/projects.js");
      const { hostedVaultSeams } = await import("../server/hosted/vault-route.js");
      const { runWeb } = await import("../server/runtime.js");
      return runWeb(
        handleProjects({
          ...hostedVaultSeams,
          encryptionSecret: undefined,
          request: new Request(`${ORIGIN}/api/projects`),
        }),
      );
    },
  },
  {
    name: "observe",
    request: () => new Request(`${ORIGIN}/api/observe`),
    handle: async () => {
      const { handleObserve } = await import("../server/hosted/observe.js");
      const { hostedVaultSeams } = await import("../server/hosted/vault-route.js");
      const { runWeb } = await import("../server/runtime.js");
      return runWeb(
        handleObserve({
          ...hostedVaultSeams,
          encryptionSecret: undefined,
          request: new Request(`${ORIGIN}/api/observe`),
        }),
      );
    },
  },
  {
    name: "events",
    request: () =>
      new Request(`${ORIGIN}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      }),
    handle: async () => {
      const { handleEvents } = await import("../server/hosted/events.js");
      return handleEvents({
        request: new Request(`${ORIGIN}/api/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "[]",
        }),
        projectApiKey: undefined,
        resolveUserId: async () => "user-1",
      });
    },
  },
  {
    name: "observation-tick",
    request: () => new Request(`${ORIGIN}/api/observation/tick`),
    handle: async () => {
      const { handleObservationTick } = await import("../server/hosted/observation-tick.js");
      return handleObservationTick({
        request: new Request(`${ORIGIN}/api/observation/tick`),
        cronSecret: undefined,
        encryptionSecret: ENCRYPTION_SECRET,
        listAccounts: async () => [],
        forgetIneligible: async () => undefined,
        purgeCleared: async () => 0,
        sweepSpeech: async () => ({ held: 0, released: 0, expired: 0, turns: 0 }),
        pushSpeech: async () => ({
          pushed: 0,
          undelivered: 0,
          unaddressed: 0,
          unreadable: 0,
          waiting: 0,
        }),
        observe: async () => ({ complete: false, changed: false }),
        openTurns: async () => ({ observation: 0, holdRelease: 0, failed: 0, reseeded: 0 }),
      });
    },
  },
];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

test("the group answers each route the way its own handler answers it", async () => {
  for (const exchange of EXCHANGES) {
    const answered = await routeFromHttpApp(observationApp()).fetch(exchange.request());
    const carried = await recordedResponse(answered);
    const direct = await recordedResponse(await exchange.handle());

    assert.deepEqual(carried, direct);
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
  }
});

test("a wrong method on a declared path is the handler's own refusal, not the group's", async () => {
  const answered = await routeFromHttpApp(observationApp()).fetch(
    new Request(`${ORIGIN}/api/projects`, { method: "DELETE" }),
  );
  const carried = await recordedResponse(answered);

  assert.equal(carried.status, 405);
  await settleResponseGolden(GOLDEN_ROOT, "method-not-allowed", carried);
});

test("a path the group declares no route for is refused with the hosted not-found", async () => {
  const answered = await routeFromHttpApp(observationApp()).fetch(
    new Request(`${ORIGIN}/api/not-in-this-group`),
  );
  const carried = await recordedResponse(answered);

  assert.equal(carried.status, 404);
  await settleResponseGolden(GOLDEN_ROOT, "route-not-found", carried);
});

test("a HEAD on a declared path keeps the handler's own status and drops the body", async () => {
  const answered = await routeFromHttpApp(observationApp()).fetch(
    new Request(`${ORIGIN}/api/projects`, { method: "HEAD" }),
  );
  const carried = await recordedResponse(answered);

  // handleProjects only answers GET; HEAD is refused exactly as DELETE is above.
  assert.equal(carried.status, 405);
  assert.equal(carried.body, "");
  await settleResponseGolden(GOLDEN_ROOT, "head-method-not-allowed", carried);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = [
    ...EXCHANGES.map((exchange) => exchange.name),
    "method-not-allowed",
    "route-not-found",
    "head-method-not-allowed",
  ].sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
