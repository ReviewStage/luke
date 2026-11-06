import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import {
  fixtureToken,
  sandboxDeleted,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sessionAnswered,
  snapshotOf,
} from "../testing/vercel-sandbox-fake.js";
import { CODER } from "./coder-host/bounds.js";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";
import { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * A session's sandboxes stopped through `@vercel/sandbox`, as the deployment
 * asks it under its own OIDC token: the sandboxes carrying the session's tag
 * are listed in the token's project, the one up has its credential taken
 * off and then its running session stopped, one already stopped is left,
 * and a stop Vercel refused fails with its status alone. A running session
 * is kept alive by the timeout from now on the test clock, within the
 * platform's maximum. The token is a synthetic one, unexpired, so nothing
 * refreshes it.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const SESSION = "wrun_fixture";

interface Asked {
  readonly method: string;
  readonly url: URL;
}

/** A sandbox as a test names it, its creation where it names none the epoch's. */
interface NamedSandbox {
  readonly name: string;
  readonly status: string;
  readonly currentSessionId: string;
  readonly createdAt?: number;
  readonly timeout?: number;
  readonly currentSnapshotId?: string;
  readonly keepLastSnapshots?: object;
}

const listedOf = (sandbox: NamedSandbox) => ({ createdAt: 0, ...sandbox });

/** The sandbox a path names, its lookup or its update, where the sandboxes given hold it. */
function namedIn(sandboxes: readonly NamedSandbox[], path: string): NamedSandbox | undefined {
  const name = /^\/api\/v2\/sandboxes\/([^/]+)$/u.exec(path)?.[1];
  return sandboxes.find((sandbox) => sandbox.name === decodeURIComponent(name ?? ""));
}

/** Vercel answering the list with the sandboxes given and every stop with the status given, keeping what it was asked. */
function vercel(sandboxes: readonly NamedSandbox[], stopStatus = 200) {
  // The layer asks under the deployment's own token, read where the platform hands it.
  vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
  const asked: Asked[] = [];
  const updates: unknown[] = [];
  const layer = Layer.provide(
    sessionSandboxesLayer,
    sandboxFetchOver(async (url, init) => {
      const parsed = new URL(url);
      const method = init.method ?? "GET";
      asked.push({ method, url: parsed });
      const session = /\/sessions\/([^/]+)\//u.exec(parsed.pathname)?.[1] ?? "";
      if (parsed.pathname.endsWith("/network-policy")) {
        return Response.json(sessionAnswered({ id: session, status: "running" }));
      }
      if (parsed.pathname.endsWith("/stop")) {
        return (
          sandboxStopRefusal(init) ??
          (stopStatus === 200
            ? Response.json(sessionAnswered({ id: session, status: "stopped" }))
            : Response.json({ error: { code: "bad_request" } }, { status: stopStatus }))
        );
      }
      const named = namedIn(sandboxes, parsed.pathname);
      if (named !== undefined && method === "PATCH") {
        updates.push(JSON.parse(String(init.body)));
        return Response.json(sandboxDeleted(listedOf(named)));
      }
      if (named !== undefined) return Response.json(sandboxFound(listedOf(named)));
      return sandboxListRefusal(parsed) ?? Response.json(sandboxesListed(sandboxes.map(listedOf)));
    }),
  );
  return { layer, asked, updates };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The session's sandboxes stopped, the firewall's record kept in a database of the call's own. */
const stopFor = (sessionId: string, snapshotExpiry?: Duration.Duration) =>
  Effect.flatMap(SessionSandboxes, (sandboxes) =>
    sandboxes.stopFor(sessionId, snapshotExpiry),
  ).pipe(Effect.provide(getTestDB()));

it.effect(
  "the session's sandbox that is up has its credential taken off its firewall and then its running session stopped, in the token's project and team, and one already stopped is left",
  () =>
    Effect.gen(function* () {
      const api = vercel([
        { name: "eve-sbx-vercel-up", status: "running", currentSessionId: "sbs_up" },
        { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" },
      ]);

      const stopped = yield* stopFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(stopped, 1);
      const [list] = api.asked;
      assert.equal(list?.url.searchParams.get("tags"), `sessionId:${SESSION}`);
      assert.equal(list?.url.searchParams.get("project"), PROJECT);
      assert.equal(list?.url.searchParams.get("teamId"), TEAM);
      assert.deepEqual(
        api.asked.filter((asked) => asked.method !== "GET").map((asked) => asked.url.pathname),
        [
          "/api/v2/sandboxes/sessions/sbs_up/network-policy",
          "/api/v2/sandboxes/sessions/sbs_up/stop",
        ],
      );
    }),
);

it.effect(
  "a stop that names an expiry sets the sandbox up to keep the snapshot its stop writes that long before it stops it, and leaves one already stopped alone",
  () =>
    Effect.gen(function* () {
      const api = vercel([
        { name: "eve-sbx-vercel-up", status: "running", currentSessionId: "sbs_up" },
        { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" },
      ]);

      const stopped = yield* stopFor(SESSION, Duration.days(1)).pipe(Effect.provide(api.layer));

      assert.equal(stopped, 1);
      assert.deepEqual(api.updates, [
        { keepLastSnapshots: { count: 1, expiration: 86_400_000, deleteEvicted: true } },
      ]);
      // The retention is set before the stop that writes the snapshot it keeps, and the credential comes off before it too.
      assert.deepEqual(
        api.asked
          .filter((asked) => asked.method !== "GET")
          .map((asked) => `${asked.method} ${asked.url.pathname}`),
        [
          "PATCH /api/v2/sandboxes/eve-sbx-vercel-up",
          "POST /api/v2/sandboxes/sessions/sbs_up/network-policy",
          "POST /api/v2/sandboxes/sessions/sbs_up/stop",
        ],
      );
    }),
);

it.effect("a stop Vercel refused fails with its status alone", () =>
  Effect.gen(function* () {
    // Note that the refusal is one `@vercel/sandbox` never tries again, which it would a 5xx on a real timer.
    const api = vercel(
      [{ name: "eve-sbx-vercel-up", status: "running", currentSessionId: "sbs_up" }],
      409,
    );

    const failure = yield* stopFor(SESSION).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.status, 409);
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
 * Vercel answering the list with the sandboxes given, a lookup of each by
 * name with the session its record names, as the sessions given hold it,
 * and an extension of one by lengthening its timeout as the platform does,
 * refusing one under a second or past its maximum, or every one with the
 * status given; and an update of a sandbox's configuration kept as it was
 * asked. A session the sessions given hold none of is gone: the sandbox's
 * lookup answers the session it moved on to, which runs.
 */
function vercelSessions(
  sandboxes: readonly NamedSandbox[],
  sessions: Record<string, FakeSession>,
  extendStatus?: number,
  snapshots: Record<string, readonly { readonly id: string; readonly status: string }[]> = {},
) {
  vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
  const asked: Asked[] = [];
  const extensions: { readonly session: string; readonly duration: number }[] = [];
  const updates: { readonly name: string; readonly body: unknown }[] = [];
  /** A sandbox's lookup, with its current session as the sessions given hold it. */
  const found = (sandbox: NamedSandbox) => {
    const session = sessions[sandbox.currentSessionId];
    const answer = sandboxFound(listedOf(sandbox));
    return session === undefined
      ? { ...answer, session: { ...answer.session, id: "sbs_moved_on", status: "running" } }
      : { ...answer, session: { ...answer.session, ...session } };
  };
  const layer = Layer.provide(
    sessionSandboxesLayer,
    sandboxFetchOver(async (url, init) => {
      const parsed = new URL(url);
      const method = init.method ?? "GET";
      asked.push({ method, url: parsed });
      // A sandbox's snapshots, the newest first, and a lookup of one of them.
      if (parsed.pathname === "/api/v2/sandboxes/snapshots") {
        const listed = snapshots[parsed.searchParams.get("name") ?? ""] ?? [];
        return Response.json({
          snapshots: listed.slice(0, 1).map(snapshotOf),
          pagination: { count: Math.min(listed.length, 1), next: null },
        });
      }
      if (parsed.pathname.startsWith("/api/v2/sandboxes/snapshots/")) {
        const id = parsed.pathname.split("/").at(-1);
        const snapshot = Object.values(snapshots)
          .flat()
          .find((each) => each.id === id);
        return snapshot === undefined
          ? Response.json({ error: { code: "not_found" } }, { status: 404 })
          : Response.json({ snapshot: snapshotOf(snapshot) });
      }
      const [, id, action] =
        /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(parsed.pathname) ?? [];
      if (id === undefined) {
        const named = namedIn(sandboxes, parsed.pathname);
        if (named !== undefined && method === "PATCH") {
          updates.push({ name: named.name, body: JSON.parse(String(init.body)) });
          return Response.json(sandboxDeleted(listedOf(named)));
        }
        if (named !== undefined) return Response.json(found(named));
        return (
          sandboxListRefusal(parsed) ?? Response.json(sandboxesListed(sandboxes.map(listedOf)))
        );
      }
      const session = sessions[id];
      if (session === undefined)
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      if (action === "extend-timeout") {
        const refused = sandboxStopRefusal(init);
        if (refused !== undefined) return refused;
        if (extendStatus !== undefined) {
          return Response.json({ error: { code: "bad_request" } }, { status: extendStatus });
        }
        const { duration } = JSON.parse(String(init.body)) as { duration: number };
        if (duration < 1_000 || session.timeout + duration > CODER.SANDBOX_MAX_LIFETIME_MS) {
          return Response.json({ error: { code: "bad_request" } }, { status: 400 });
        }
        session.timeout += duration;
        extensions.push({ session: id, duration });
      }
      return Response.json(sessionAnswered({ id, ...session }));
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
      const looked = api.asked.filter((asked) => asked.url.pathname.includes("eve-sbx-vercel-"));
      assert.deepEqual(
        looked.map((asked) => [asked.url.pathname, asked.url.searchParams.get("resume")]),
        [["/api/v2/sandboxes/eve-sbx-vercel-up", "false"]],
      );
    }),
);

it.effect(
  "a session already ending within a keep-alive interval of the timeout from now is left as it is",
  () =>
    Effect.gen(function* () {
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
      yield* TestClock.adjust(Duration.millis(nearCap - 5 * MINUTE));

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 1);
      assert.deepEqual(api.extensions, [{ session: "sbs_up", duration: 10 * MINUTE }]);
    }),
);

it.effect(
  "a sandbox whose own session has stopped, or is gone, is not extended though the sandbox's record still reads running",
  () =>
    Effect.gen(function* () {
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
      assert.equal(update?.url.searchParams.get("projectId"), PROJECT);
      assert.deepEqual(api.extensions, [], "each running session still ends far enough ahead");
    }),
);

it.effect(
  "a running sandbox opened before its snapshot retention was bounded is brought onto it as it is kept alive, one whose snapshot is not its newest is left, and one bounded is never asked after",
  () =>
    Effect.gen(function* () {
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
          },
          {
            name: "eve-sbx-vercel-rolled",
            ...running("rolled"),
            currentSnapshotId: "snap_rolled_older",
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
