import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { fakeHttpClientLayer } from "@repo/wire/testing";
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
 * the timeout from now on the test clock, from the end its listing names. The token is a synthetic one the
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
      if (parsed.pathname.endsWith("/network-policy")) return Response.json({});
      return parsed.pathname.endsWith("/stop")
        ? (sandboxStopRefusal(init) ?? new Response("{}", { status: stopStatus }))
        : (sandboxListRefusal(parsed) ?? Response.json({ sandboxes }));
    }),
  );
  return { layer, asked };
}

/** The session's sandboxes stopped, the firewall's record kept in a database of the call's own. */
const stopFor = (sessionId: string) =>
  Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.stopFor(sessionId)).pipe(
    Effect.provide(getTestDB()),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

it.effect(
  "the session's sandbox that is up has its credential taken off its firewall and then its running session stopped, in the token's project and team, and one already stopped is left",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel([
        { name: "eve-sbx-vercel-up", status: "running", currentSessionId: "sbs_up" },
        { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" },
      ]);

      const stopped = yield* stopFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(stopped, 1);
      const [list, policy, stop, ...rest] = api.asked;
      assert.ok(list !== undefined && policy !== undefined && stop !== undefined);
      assert.deepEqual(rest, []);
      assert.equal(policy.url.pathname, "/api/v2/sandboxes/sessions/sbs_up/network-policy");
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

/**
 * Vercel answering the list with the sandboxes given, and an extension of a
 * session by lengthening it, or refusing every one with the status given.
 */
function vercelSessions(sandboxes: readonly object[], extendStatus?: number) {
  const asked: Asked[] = [];
  const extensions: { readonly session: string; readonly duration: number }[] = [];
  const layer = Layer.provide(
    sessionSandboxesLayer,
    fakeHttpClientLayer(async (url, init) => {
      const parsed = new URL(url);
      const contentType = new Headers(init.headers).get("content-type");
      asked.push({ method: init.method ?? "GET", url: parsed, contentType });
      const [, id, action] =
        /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(parsed.pathname) ?? [];
      if (id === undefined || action !== "extend-timeout") {
        return sandboxListRefusal(parsed) ?? Response.json({ sandboxes });
      }
      const refused = sandboxStopRefusal(init);
      if (refused !== undefined) return refused;
      if (extendStatus !== undefined) return new Response("{}", { status: extendStatus });
      const { duration } = JSON.parse(String(init.body)) as { duration: number };
      extensions.push({ session: id, duration });
      return Response.json({ session: { id, status: "running", createdAt: 0, timeout: duration } });
    }),
  );
  return { layer, asked, extensions };
}

const keepAliveFor = (sessionId: string) =>
  Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.keepAliveFor(sessionId));

const MINUTE = 60_000;
/** A running sandbox whose session ends the timeout after the test clock's start. */
const UP = {
  name: "eve-sbx-vercel-up",
  status: "running",
  currentSessionId: "sbs_up",
  expiresAt: CODER.SANDBOX_TIMEOUT_MS,
} as const;

it.effect(
  "a running session is extended to end the timeout from now, by a JSON POST in the token's team, read from the list alone, and a stopped sandbox is left",
  () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercelSessions([
        UP,
        { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" },
      ]);
      yield* TestClock.adjust(Duration.minutes(25));

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 1);
      assert.deepEqual(api.extensions, [{ session: "sbs_up", duration: 25 * MINUTE }]);
      const [list, extension, ...rest] = api.asked;
      assert.ok(list !== undefined && extension !== undefined);
      assert.deepEqual(rest, []);
      assert.equal(list.url.pathname, "/api/v2/sandboxes");
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
      const api = vercelSessions([UP]);
      yield* TestClock.adjust(
        Duration.subtract(CODER.SANDBOX_KEEP_ALIVE_EVERY, Duration.millis(1)),
      );

      const extended = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer));

      assert.equal(extended, 0);
      assert.deepEqual(api.extensions, []);
    }),
);

it.effect("an extension Vercel refused fails with its status alone", () =>
  Effect.gen(function* () {
    vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
    const api = vercelSessions([UP], 422);
    yield* TestClock.adjust(Duration.minutes(30));

    const failure = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.status, 422);
    assert.deepEqual(api.extensions, []);
  }),
);
