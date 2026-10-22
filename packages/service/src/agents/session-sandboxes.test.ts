import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { sandboxListRefusal, sandboxStopRefusal } from "../testing/vercel-sandbox-fake.js";
import { CODER } from "./coder-host/bounds.js";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";
import { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * A session's sandboxes stopped through Vercel Sandbox's REST API, as the
 * deployment asks it under its own OIDC token: the sandboxes carrying the
 * session's tag are listed in the token's project, the one up has its
 * running session stopped by a POST sent as JSON, which Vercel refuses
 * with 415 otherwise, one already stopped is left, and a stop Vercel
 * refused fails with its status alone. A running session is kept alive by
 * the timeout from now on the test clock, within the platform's maximum. The token is a synthetic one the
 * environment carries, unexpired, so nothing refreshes it.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const SESSION = "wrun_fixture";

/** An unsigned token naming the fixture's project and team, a year from expiring. */
function fixtureToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: PROJECT, owner_id: TEAM, exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

interface Asked {
  readonly method: string;
  readonly url: URL;
  readonly contentType: string | null;
}

/** Vercel answering the list with the sandboxes given and every stop with the status given, keeping what it was asked. */
function vercel(sandboxes: readonly object[], stopStatus = 200) {
  const asked: Asked[] = [];
  const layer = Layer.provide(
    sessionSandboxesLayer,
    fakeHttpClientLayer((url, init) => {
      const parsed = new URL(url);
      const contentType = new Headers(init.headers).get("content-type");
      asked.push({ method: init.method ?? "GET", url: parsed, contentType });
      return parsed.pathname.endsWith("/stop")
        ? (sandboxStopRefusal(init) ?? new Response("{}", { status: stopStatus }))
        : (sandboxListRefusal(parsed) ?? Response.json({ sandboxes }));
    }),
  );
  return { layer, asked };
}

const stopFor = (sessionId: string) =>
  Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.stopFor(sessionId));

afterEach(() => {
  vi.unstubAllEnvs();
});

it.effect(
  "the session's sandbox that is up has its running session stopped, in the token's project and team, and one already stopped is left",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel([
        { name: "eve-sbx-vercel-up", status: "running", currentSessionId: "sbs_up" },
        { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" },
      ]);

      const stopped = yield* stopFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(stopped, 1);
      const [list, stop, ...rest] = api.asked;
      assert.ok(list !== undefined && stop !== undefined);
      assert.deepEqual(rest, []);
      assert.equal(list.url.pathname, "/api/v2/sandboxes");
      assert.equal(list.url.searchParams.get("tags"), `sessionId:${SESSION}`);
      assert.equal(list.url.searchParams.get("project"), PROJECT);
      assert.equal(list.url.searchParams.get("teamId"), TEAM);
      assert.equal(stop.method, "POST");
      assert.equal(stop.contentType, "application/json");
      assert.equal(stop.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/stop");
      assert.equal(stop.url.searchParams.get("teamId"), TEAM);
    }),
);

it.effect("a stop Vercel refused fails with its status alone", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercel(
      [{ name: "eve-sbx-vercel-up", status: "running", currentSessionId: "sbs_up" }],
      503,
    );

    const failure = yield* stopFor(SESSION).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.status, 503);
  }),
);

it.effect(
  "a sandbox that is up with no session named fails the stop rather than counting as stopped",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel([{ name: "eve-sbx-vercel-up", status: "running" }]);

      const failure = yield* stopFor(SESSION).pipe(Effect.provide(api.layer), Effect.flip);

      assert.ok(failure instanceof SandboxUnavailable);
    }),
);

/** A sandbox session as Vercel answers a lookup or an extension of it. */
interface FakeSession {
  readonly status: string;
  readonly createdAt: number;
  readonly startedAt?: number;
  timeout: number;
}

/**
 * Vercel answering the list with the sandboxes given, a lookup of each
 * session it holds with that session, and an extension of one by
 * lengthening its timeout as the platform does, refusing one under a second
 * or past its maximum, or every one with the status given; and an update
 * of a sandbox's configuration kept as it was asked.
 */
function vercelSessions(
  sandboxes: readonly object[],
  sessions: Record<string, FakeSession>,
  extendStatus?: number,
  snapshots: Record<string, readonly { readonly id: string; readonly status: string }[]> = {},
) {
  const asked: Asked[] = [];
  const extensions: { readonly session: string; readonly duration: number }[] = [];
  const updates: { readonly name: string; readonly body: unknown }[] = [];
  const layer = Layer.provide(
    sessionSandboxesLayer,
    fakeHttpClientLayer(async (url, init) => {
      const parsed = new URL(url);
      const contentType = new Headers(init.headers).get("content-type");
      asked.push({ method: init.method ?? "GET", url: parsed, contentType });
      if (init.method === "PATCH") {
        const name = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
        updates.push({ name, body: JSON.parse(String(init.body)) });
        return Response.json({ sandbox: { name } });
      }
      // A sandbox's snapshots, the newest first, and a lookup of one of them.
      if (parsed.pathname === "/api/v2/sandboxes/snapshots") {
        const listed = snapshots[parsed.searchParams.get("name") ?? ""] ?? [];
        return Response.json({ snapshots: listed.slice(0, 1) });
      }
      if (parsed.pathname.startsWith("/api/v2/sandboxes/snapshots/")) {
        const id = parsed.pathname.split("/").at(-1);
        const found = Object.values(snapshots)
          .flat()
          .find((each) => each.id === id);
        return found === undefined
          ? new Response("{}", { status: 404 })
          : Response.json({ snapshot: found });
      }
      const [, id, action] =
        /^\/api\/v2\/sandboxes\/sessions\/([^/]+)(?:\/(.+))?$/u.exec(parsed.pathname) ?? [];
      if (id === undefined) return sandboxListRefusal(parsed) ?? Response.json({ sandboxes });
      const session = sessions[id];
      if (session === undefined) return new Response("{}", { status: 404 });
      if (action === "extend-timeout") {
        const refused = sandboxStopRefusal(init);
        if (refused !== undefined) return refused;
        if (extendStatus !== undefined) return new Response("{}", { status: extendStatus });
        const { duration } = JSON.parse(String(init.body)) as { duration: number };
        if (duration < 1_000 || session.timeout + duration > CODER.SANDBOX_MAX_LIFETIME_MS) {
          return new Response("{}", { status: 400 });
        }
        session.timeout += duration;
        extensions.push({ session: id, duration });
      }
      return Response.json({ session: { id, ...session } });
    }),
  );
  return { layer, asked, extensions, updates };
}

const keepAliveFor = (sessionId: string) =>
  Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.keepAliveFor(sessionId));

const MINUTE = 60_000;
/** The snapshot retention a sandbox opened today stands at, which a keep-alive leaves as it is. */
const BOUND = {
  count: CODER.SANDBOX_SNAPSHOTS.count,
  expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
  deleteEvicted: true,
} as const;
const UP = {
  name: "eve-sbx-vercel-up",
  status: "running",
  currentSessionId: "sbs_up",
  keepLastSnapshots: BOUND,
} as const;

it.effect(
  "a running session is extended to end the timeout from now, by a JSON POST in the token's team, and a stopped sandbox is never looked up",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercelSessions(
        [UP, { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" }],
        {
          sbs_up: {
            status: "running",
            createdAt: 0,
            startedAt: 0,
            timeout: CODER.SANDBOX_TIMEOUT_MS,
          },
        },
      );
      yield* TestClock.adjust(Duration.minutes(25));

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 1);
      assert.deepEqual(api.extensions, [{ session: "sbs_up", duration: 25 * MINUTE }]);
      const [, lookup, extension, ...rest] = api.asked;
      assert.ok(lookup !== undefined && extension !== undefined);
      assert.deepEqual(rest, []);
      assert.equal(lookup.method, "GET");
      assert.equal(lookup.url.pathname, "/api/v2/sandboxes/sessions/sbs_up");
      assert.equal(extension.method, "POST");
      assert.equal(extension.contentType, "application/json");
      assert.equal(extension.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/extend-timeout");
      assert.equal(extension.url.searchParams.get("teamId"), TEAM);
    }),
);

it.effect(
  "a session already ending within a keep-alive interval of the timeout from now is left as it is",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercelSessions([UP], {
        sbs_up: {
          status: "running",
          createdAt: 0,
          startedAt: 0,
          timeout: CODER.SANDBOX_TIMEOUT_MS,
        },
      });
      yield* TestClock.adjust(
        Duration.subtract(CODER.SANDBOX_KEEP_ALIVE_EVERY, Duration.millis(1)),
      );

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 0);
      assert.deepEqual(api.extensions, []);
    }),
);

it.effect(
  "a session is counted from its creation where Vercel names no start, and extended no further than the platform's maximum lifetime",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const nearCap = CODER.SANDBOX_MAX_LIFETIME_MS - 10 * MINUTE;
      const api = vercelSessions(
        [
          UP,
          {
            name: "eve-sbx-vercel-capped",
            status: "running",
            currentSessionId: "sbs_capped",
            keepLastSnapshots: BOUND,
          },
        ],
        {
          sbs_up: { status: "running", createdAt: 0, timeout: nearCap },
          sbs_capped: { status: "running", createdAt: 0, timeout: CODER.SANDBOX_MAX_LIFETIME_MS },
        },
      );
      yield* TestClock.adjust(Duration.millis(nearCap - 20 * MINUTE));

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 1);
      assert.deepEqual(api.extensions, [{ session: "sbs_up", duration: 10 * MINUTE }]);
    }),
);

it.effect(
  "a sandbox whose own session has stopped, or is gone, is not extended though the sandbox's record still reads running",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercelSessions(
        [
          UP,
          {
            name: "eve-sbx-vercel-gone",
            status: "running",
            currentSessionId: "sbs_gone",
            keepLastSnapshots: BOUND,
          },
        ],
        {
          sbs_up: {
            status: "stopped",
            createdAt: 0,
            startedAt: 0,
            timeout: CODER.SANDBOX_TIMEOUT_MS,
          },
        },
      );
      yield* TestClock.adjust(Duration.minutes(30));

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 0);
      assert.deepEqual(api.extensions, []);
    }),
);

it.effect("an extension Vercel refused fails with its status alone", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercelSessions(
      [UP],
      {
        sbs_up: {
          status: "running",
          createdAt: 0,
          startedAt: 0,
          timeout: CODER.SANDBOX_TIMEOUT_MS,
        },
      },
      422,
    );
    yield* TestClock.adjust(Duration.minutes(30));

    const failure = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.status, 422);
    assert.deepEqual(api.extensions, []);
  }),
);

it.effect(
  "a running sandbox opened before the cap has the timeout its next sessions open with lowered to it, and one already at it is left",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercelSessions(
        [
          { ...UP, timeout: CODER.SANDBOX_MAX_LIFETIME_MS },
          {
            name: "eve-sbx-vercel-capped",
            status: "running",
            currentSessionId: "sbs_capped",
            timeout: CODER.SANDBOX_TIMEOUT_MS,
            keepLastSnapshots: BOUND,
          },
        ],
        {
          sbs_up: {
            status: "running",
            createdAt: 0,
            startedAt: 0,
            timeout: CODER.SANDBOX_MAX_LIFETIME_MS,
          },
          sbs_capped: {
            status: "running",
            createdAt: 0,
            startedAt: 0,
            timeout: CODER.SANDBOX_TIMEOUT_MS,
          },
        },
      );

      yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.deepEqual(api.updates, [
        { name: "eve-sbx-vercel-up", body: { timeout: CODER.SANDBOX_TIMEOUT_MS } },
      ]);
      const update = api.asked.find((asked) => asked.method === "PATCH");
      assert.equal(update?.contentType, "application/json");
      assert.equal(update?.url.searchParams.get("projectId"), PROJECT);
      assert.deepEqual(api.extensions, [], "each running session still ends far enough ahead");
    }),
);

it.effect(
  "a running sandbox opened before its snapshot retention was bounded is brought onto it as it is kept alive, one whose snapshot is not its newest is left, and one bounded is never asked after",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const running = (name: string) => ({
        status: "running",
        currentSessionId: `sbs_${name}`,
        timeout: CODER.SANDBOX_TIMEOUT_MS,
      });
      const session = {
        status: "running",
        createdAt: 0,
        startedAt: 0,
        timeout: CODER.SANDBOX_TIMEOUT_MS,
      };
      const api = vercelSessions(
        [
          {
            name: "eve-sbx-vercel-old",
            ...running("old"),
            currentSnapshotId: "snap_old_newest",
            keepLastSnapshots: null,
          },
          {
            name: "eve-sbx-vercel-rolled",
            ...running("rolled"),
            currentSnapshotId: "snap_rolled_older",
            keepLastSnapshots: null,
          },
          {
            name: "eve-sbx-vercel-bounded",
            ...running("bounded"),
            currentSnapshotId: "snap_bounded",
            keepLastSnapshots: BOUND,
          },
        ],
        { sbs_old: session, sbs_rolled: session, sbs_bounded: session },
        undefined,
        {
          "eve-sbx-vercel-old": [
            { id: "snap_old_newest", status: "created" },
            { id: "snap_old_older", status: "created" },
          ],
          "eve-sbx-vercel-rolled": [
            { id: "snap_rolled_newest", status: "created" },
            { id: "snap_rolled_older", status: "created" },
          ],
        },
      );

      yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.deepEqual(api.updates, [
        { name: "eve-sbx-vercel-old", body: { keepLastSnapshots: BOUND } },
      ]);
      const listedFor = api.asked
        .filter((asked) => asked.url.pathname === "/api/v2/sandboxes/snapshots")
        .map((asked) => asked.url.searchParams.get("name"));
      assert.deepEqual(listedFor, ["eve-sbx-vercel-old", "eve-sbx-vercel-rolled"]);
    }),
);
