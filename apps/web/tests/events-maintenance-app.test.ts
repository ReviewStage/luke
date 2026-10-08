import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, beforeEach, test, vi } from "vitest";
import { routeFromHttpRouter } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { runWithoutDatabase } from "./support/no-database.js";
import {
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The events and maintenance groups carry each route's own handler unchanged,
 * so what this holds is that carrying: each group's `HttpRouter` dispatches
 * its path to its handler, on any method (a wrong one is the handler's own
 * 405, never the group's 404), and the response — status, headers, and bytes
 * — crosses the `HttpServerRequest`/`HttpServerResponse` adaptor exactly as
 * the handler answered it.
 *
 * `server/events-app.ts` imports `../auth.js`, which builds Better Auth's
 * instance at module load, so `DATABASE_URL` has to stand before that import
 * runs — before any `beforeEach` fires. It is set here, once, ahead of the
 * dynamic imports below.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/events-maintenance-route");

/** The layer names a database and nothing here queries one, as in `web-runtime.test.ts`. */
const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/luke";
process.env.DATABASE_URL ??= PLACEHOLDER_DATABASE_URL;

const { eventsApp } = await import("../server/events-app.js");
const { maintenanceApp } = await import("../server/maintenance-app.js");

const ORIGIN = "https://luke.test";

const GROUP = {
  EVENTS: "events",
  MAINTENANCE: "maintenance",
} as const;
type Group = (typeof GROUP)[keyof typeof GROUP];

const GROUP_APP = {
  [GROUP.EVENTS]: eventsApp,
  [GROUP.MAINTENANCE]: maintenanceApp,
} as const;

/** The golden each group's own not-found is recorded under. */
const NOT_FOUND_GOLDEN = {
  [GROUP.EVENTS]: "events-route-not-found",
  [GROUP.MAINTENANCE]: "maintenance-route-not-found",
} as const;

interface Exchange {
  name: string;
  group: Group;
  request: () => Request;
  handle: () => Promise<Response>;
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "events",
    group: GROUP.EVENTS,
    request: () =>
      new Request(`${ORIGIN}/api/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      }),
    handle: async () => {
      const { handleEvents } = await import("../server/hosted/events.js");
      const { Effect } = await import("effect");
      return runWithoutDatabase(
        handleEvents({
          request: new Request(`${ORIGIN}/api/events`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "[]",
          }),
          projectApiKey: undefined,
          resolveUserId: () => Effect.succeedSome("user-1"),
        }),
      );
    },
  },
  {
    name: "maintenance-sweep",
    group: GROUP.MAINTENANCE,
    request: () => new Request(`${ORIGIN}/api/maintenance/sweep`),
    handle: async () => {
      const { handleMaintenanceSweep } = await import("../server/hosted/maintenance-sweep.js");
      const { NOTHING_ORPHANED } = await import("../server/voice/orphan-sweep.js");
      const { Effect } = await import("effect");
      return runWithoutDatabase(
        handleMaintenanceSweep({
          request: new Request(`${ORIGIN}/api/maintenance/sweep`),
          cronSecret: undefined,
          purgeCleared: () => Effect.succeed(0),
          sweepAbandonedTurns: () => Effect.succeed(0),
          sweepVoice: () => Effect.succeed(NOTHING_ORPHANED),
        }),
      );
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
    const answered = await routeFromHttpRouter(GROUP_APP[exchange.group]()).fetch(
      exchange.request(),
    );
    const carried = await recordedResponse(answered);
    const direct = await recordedResponse(await exchange.handle());

    assert.deepEqual(carried, direct);
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
  }
});

test("a wrong method on a declared path is the handler's own refusal, not the group's", async () => {
  const answered = await routeFromHttpRouter(eventsApp()).fetch(
    new Request(`${ORIGIN}/api/events`, { method: "DELETE" }),
  );
  const carried = await recordedResponse(answered);

  assert.equal(carried.status, 405);
  await settleResponseGolden(GOLDEN_ROOT, "method-not-allowed", carried);
});

test("a path a group declares no route for is refused with the hosted not-found", async () => {
  for (const group of Object.values(GROUP)) {
    const answered = await routeFromHttpRouter(GROUP_APP[group]()).fetch(
      new Request(`${ORIGIN}/api/not-in-this-group`),
    );
    const carried = await recordedResponse(answered);

    assert.equal(carried.status, 404);
    await settleResponseGolden(GOLDEN_ROOT, NOT_FOUND_GOLDEN[group], carried);
  }
});

test("a HEAD on a declared path keeps the handler's own status and drops the body", async () => {
  const answered = await routeFromHttpRouter(eventsApp()).fetch(
    new Request(`${ORIGIN}/api/events`, { method: "HEAD" }),
  );
  const carried = await recordedResponse(answered);

  // handleEvents only answers POST; HEAD is refused exactly as DELETE is above.
  assert.equal(carried.status, 405);
  assert.equal(carried.body, "");
  await settleResponseGolden(GOLDEN_ROOT, "head-method-not-allowed", carried);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = [
    ...EXCHANGES.map((exchange) => exchange.name),
    "method-not-allowed",
    ...Object.values(NOT_FOUND_GOLDEN),
    "head-method-not-allowed",
  ].sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
