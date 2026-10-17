import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer } from "effect";
import { afterEach, vi } from "vitest";
import { sandboxListRefusal, sandboxStopRefusal } from "../testing/vercel-sandbox-fake.js";
import { SessionSandboxes, sessionSandboxesLayer } from "./session-sandboxes.js";
import { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * A session's sandboxes stopped through Vercel Sandbox's REST API, as the
 * deployment asks it under its own OIDC token: the sandboxes carrying the
 * session's tag are listed in the token's project, the one up has its
 * running session stopped by a POST sent as JSON, which Vercel refuses
 * with 415 otherwise, one already stopped is left, and a stop Vercel
 * refused fails with its status alone. The token is a synthetic one the
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
