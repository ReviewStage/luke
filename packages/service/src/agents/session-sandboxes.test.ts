import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import {
  fixtureToken,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
  sandboxStopRefusal,
  sessionAnswered,
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
 * is kept alive by the timeout from now on the test clock, from the end its
 * listing names. The token is a synthetic one, unexpired, so nothing
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
  readonly expiresAt?: number;
}

const listedOf = (sandbox: NamedSandbox) => ({ createdAt: 0, ...sandbox });

/** The sandbox a path names, its lookup, where the sandboxes given hold it. */
function namedIn(sandboxes: readonly NamedSandbox[], path: string): NamedSandbox | undefined {
  const name = /^\/api\/v2\/sandboxes\/([^/]+)$/u.exec(path)?.[1];
  return sandboxes.find((sandbox) => sandbox.name === decodeURIComponent(name ?? ""));
}

/** Vercel answering the list with the sandboxes given and every stop with the status given, keeping what it was asked. */
function vercel(sandboxes: readonly NamedSandbox[], stopStatus = 200) {
  // The layer asks under the deployment's own token, read where the platform hands it.
  vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
  const asked: Asked[] = [];
  const layer = Layer.provide(
    sessionSandboxesLayer,
    sandboxFetchOver(async (url, init) => {
      const parsed = new URL(url);
      asked.push({ method: init.method ?? "GET", url: parsed });
      const session = /\/sessions\/([^/]+)\//u.exec(parsed.pathname)?.[1] ?? "";
      if (parsed.pathname.endsWith("/stop")) {
        return (
          sandboxStopRefusal(init) ??
          (stopStatus === 200
            ? Response.json(sessionAnswered({ id: session, status: "stopped" }))
            : Response.json({ error: { code: "bad_request" } }, { status: stopStatus }))
        );
      }
      const named = namedIn(sandboxes, parsed.pathname);
      if (named !== undefined) return Response.json(sandboxFound(listedOf(named)));
      return sandboxListRefusal(parsed) ?? Response.json(sandboxesListed(sandboxes.map(listedOf)));
    }),
  );
  return { layer, asked };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The session's sandboxes stopped, the firewall's record kept in a database of the call's own. */
const stopFor = (sessionId: string) =>
  Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.stopFor(sessionId)).pipe(
    Effect.provide(getTestDB()),
  );

it.effect(
  "the session's sandbox that is up has its running session stopped, in the token's project and team, and one already stopped is left",
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
        ["/api/v2/sandboxes/sessions/sbs_up/stop"],
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

/**
 * Vercel answering the list with the sandboxes given, a lookup of each by
 * name with the session its record names, and an extension of a session by
 * lengthening it, or refusing every one with the status given.
 */
function vercelSessions(sandboxes: readonly NamedSandbox[], extendStatus?: number) {
  vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
  const asked: Asked[] = [];
  const extensions: { readonly session: string; readonly duration: number }[] = [];
  const layer = Layer.provide(
    sessionSandboxesLayer,
    sandboxFetchOver(async (url, init) => {
      const parsed = new URL(url);
      asked.push({ method: init.method ?? "GET", url: parsed });
      const [, id, action] =
        /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(parsed.pathname) ?? [];
      if (id === undefined || action !== "extend-timeout") {
        const named = namedIn(sandboxes, parsed.pathname);
        if (named !== undefined) return Response.json(sandboxFound(listedOf(named)));
        return (
          sandboxListRefusal(parsed) ?? Response.json(sandboxesListed(sandboxes.map(listedOf)))
        );
      }
      const refused = sandboxStopRefusal(init);
      if (refused !== undefined) return refused;
      if (extendStatus !== undefined) {
        return Response.json({ error: { code: "bad_request" } }, { status: extendStatus });
      }
      const { duration } = JSON.parse(String(init.body)) as { duration: number };
      extensions.push({ session: id, duration });
      return Response.json(sessionAnswered({ id, status: "running", timeout: duration }));
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
  "a running session is extended to end the timeout from now, read from the list alone, through its sandbox looked up without a resume, and a stopped sandbox is never looked up",
  () =>
    Effect.gen(function* () {
      const api = vercelSessions([
        UP,
        { name: "eve-sbx-vercel-down", status: "stopped", currentSessionId: "sbs_down" },
      ]);
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
    const api = vercelSessions([UP], 422);
    yield* TestClock.adjust(Duration.minutes(30));

    const failure = yield* keepAliveFor(SESSION).pipe(Effect.provide(api.layer), Effect.flip);

    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.status, 422);
    assert.deepEqual(api.extensions, []);
  }),
);
