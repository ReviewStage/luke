import assert from "node:assert/strict";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Fiber, Option, Redacted, TestClock } from "effect";
import { test } from "vitest";
import {
  EVE_HEALTH_PATH,
  EXPECTED_STATUS,
  judge,
  type PlannedRequest,
  PROBE_DOOR,
  PROBE_METHOD,
  PROBE_STATUS,
  planProbes,
  probeDeployment,
  readProbePaths,
  SITE_ROOT_PATH,
  VERDICT,
} from "../server/preview-probe.js";

const WEB = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB, "..", "..");

const PREVIEW = "https://luke-abc123-stage-review.vercel.app";
const SSO =
  "https://vercel.com/sso-api?url=https%3A%2F%2Fluke-abc123-stage-review.vercel.app%2F&nonce=1";
const SECRET = Redacted.make("bypass-secret-value");
const PATHS = {
  callers: ["/api/brain/capabilities", "/api/devices", "/api/auth/", "/api/brain/turns/probe"],
  crons: ["/api/observation/tick", "/api/devices"],
};

const get = (path: string, expected?: number): PlannedRequest => ({
  method: PROBE_METHOD.GET,
  path,
  expected,
});

const answer = (status: number, headers: Readonly<Record<string, string>> = {}) => ({
  status,
  vercelError: Option.fromNullable(headers["x-vercel-error"]),
  location: Option.fromNullable(headers.location),
});

test("whose answer it is decides the verdict: the platform's header, the SSO redirect, a 5xx, or the table", () => {
  const verdicts = [
    judge(get("/api/nowhere"), answer(404, { "x-vercel-error": "NOT_FOUND" })),
    judge(get("/api/auth/"), answer(404, { "x-vercel-cache": "MISS" })),
    judge(get("/"), answer(302, { location: SSO })),
    judge(get("/"), answer(302, { location: "https://tryluke.dev/sign-in" })),
    judge(get("/api/brain/ask"), answer(500, { "x-vercel-error": "FUNCTION_INVOCATION_FAILED" })),
    judge(get("/api/brain/ask"), answer(500)),
    judge(get("/api/brain/capabilities", PROBE_STATUS.UNAUTHORIZED), answer(401)),
    judge(get("/api/brain/capabilities", PROBE_STATUS.UNAUTHORIZED), answer(405)),
    judge(get("/api/brain/turns/probe"), answer(401)),
  ];
  assert.deepEqual(verdicts, [
    VERDICT.PLATFORM_ERROR,
    VERDICT.OK,
    VERDICT.PROTECTED,
    VERDICT.OK,
    VERDICT.PLATFORM_ERROR,
    VERDICT.SERVER_ERROR,
    VERDICT.OK,
    VERDICT.UNEXPECTED_STATUS,
    VERDICT.OK,
  ]);
});

test("the bypass door plans a GET for the page, every caller and cron path once, and eve's health, sorted", () => {
  const plan = planProbes(PROBE_DOOR.BYPASS_SECRET, PATHS);
  assert.deepEqual(
    plan.map((request) => [request.method, request.path, request.expected]),
    [
      [PROBE_METHOD.GET, SITE_ROOT_PATH, PROBE_STATUS.OK],
      [PROBE_METHOD.GET, "/api/auth/", undefined],
      [PROBE_METHOD.GET, "/api/brain/capabilities", PROBE_STATUS.UNAUTHORIZED],
      [PROBE_METHOD.GET, "/api/brain/turns/probe", undefined],
      [PROBE_METHOD.GET, "/api/devices", PROBE_STATUS.METHOD_NOT_ALLOWED],
      [PROBE_METHOD.GET, "/api/observation/tick", PROBE_STATUS.UNAUTHORIZED],
      [PROBE_METHOD.GET, EVE_HEALTH_PATH, PROBE_STATUS.OK],
    ],
  );
});

test("the OPTIONS door plans an OPTIONS for the same paths without the page, eve's health held to no code", () => {
  const plan = planProbes(PROBE_DOOR.OPTIONS_ALLOWLIST, PATHS);
  assert.deepEqual(new Set(plan.map((request) => request.method)), new Set([PROBE_METHOD.OPTIONS]));
  assert.equal(
    plan.some((request) => request.path === SITE_ROOT_PATH),
    false,
  );
  assert.deepEqual(
    plan.map((request) => [request.path, request.expected]),
    [
      ["/api/auth/", undefined],
      ["/api/brain/capabilities", PROBE_STATUS.METHOD_NOT_ALLOWED],
      ["/api/brain/turns/probe", undefined],
      ["/api/devices", PROBE_STATUS.METHOD_NOT_ALLOWED],
      ["/api/observation/tick", PROBE_STATUS.METHOD_NOT_ALLOWED],
      [EVE_HEALTH_PATH, undefined],
    ],
  );
});

it.effect(
  "the repository's callers are probed as the check matches them, and every path the table names is among them",
  () =>
    Effect.gen(function* () {
      const paths = yield* readProbePaths({ repoRoot: REPO_ROOT, web: WEB });
      for (const door of Object.values(PROBE_DOOR)) {
        const planned = new Set(planProbes(door, paths).map((request) => request.path));
        const unplanned = [...EXPECTED_STATUS[door].keys()].filter((path) => !planned.has(path));
        assert.deepEqual(unplanned, []);
      }
      // `/api/auth` is the base better-auth's client appends to, resolved as a prefix; the base alone is no route.
      assert.equal(paths.callers.includes("/api/auth"), false);
      assert.equal(paths.callers.includes("/api/auth/probe"), true);
      assert.equal(paths.crons.includes("/api/observation/tick"), true);
      assert.notEqual(paths.callers.length, 0);
    }),
);

interface Seen {
  readonly url: URL;
  readonly method: string;
  readonly bypass: string | null;
  readonly cacheControl: string | null;
}

/** A deployment in the services shape, answering as production did on 2026-09-12, with one function missing. */
function deployment(seen: Seen[], protectedFrom: (init: RequestInit) => boolean = () => false) {
  return fakeHttpClientLayer((url, init) => {
    const headers = new Headers(init.headers);
    const request = new URL(url);
    seen.push({
      url: request,
      method: init.method ?? "GET",
      bypass: headers.get("x-vercel-protection-bypass"),
      cacheControl: headers.get("cache-control"),
    });
    if (protectedFrom(init)) return new Response(null, { status: 302, headers: { location: SSO } });
    switch (request.pathname) {
      case "/":
        return new Response("<html></html>", { status: 200 });
      case "/api/brain/capabilities":
      case "/api/observation/tick":
        return new Response("{}", { status: 401, headers: { "x-vercel-cache": "MISS" } });
      case "/api/devices":
        return new Response("{}", { status: 405, headers: { "x-vercel-cache": "MISS" } });
      case "/api/auth/":
        return new Response("{}", { status: 404, headers: { "x-vercel-cache": "MISS" } });
      case EVE_HEALTH_PATH:
        return new Response("{}", { status: 200, headers: { "x-vercel-cache": "MISS" } });
      default:
        return new Response("NOT_FOUND", {
          status: 404,
          headers: { "x-vercel-error": "NOT_FOUND" },
        });
    }
  });
}

it.effect(
  "every planned request is sent cache-busted with the secret, and judged by whose answer came back",
  () =>
    Effect.gen(function* () {
      const seen: Seen[] = [];
      const plan = planProbes(PROBE_DOOR.BYPASS_SECRET, PATHS);
      const results = yield* probeDeployment(
        { address: PREVIEW, bypassSecret: Option.some(SECRET) },
        plan,
      ).pipe(Effect.provide(deployment(seen)));

      assert.deepEqual(
        results.map((result) => [result.path, result.status, result.vercelError, result.verdict]),
        [
          [SITE_ROOT_PATH, 200, undefined, VERDICT.OK],
          ["/api/auth/", 404, undefined, VERDICT.OK],
          ["/api/brain/capabilities", 401, undefined, VERDICT.OK],
          ["/api/brain/turns/probe", 404, "NOT_FOUND", VERDICT.PLATFORM_ERROR],
          ["/api/devices", 405, undefined, VERDICT.OK],
          ["/api/observation/tick", 401, undefined, VERDICT.OK],
          [EVE_HEALTH_PATH, 200, undefined, VERDICT.OK],
        ],
      );
      assert.equal(seen.length, plan.length);
      assert.deepEqual(new Set(seen.map((request) => request.url.origin)), new Set([PREVIEW]));
      assert.deepEqual(new Set(seen.map((request) => request.method)), new Set([PROBE_METHOD.GET]));
      assert.deepEqual(
        new Set(seen.map((request) => request.bypass)),
        new Set([Redacted.value(SECRET)]),
      );
      assert.deepEqual(new Set(seen.map((request) => request.cacheControl)), new Set(["no-cache"]));
      assert.equal(
        seen.every((request) => request.url.searchParams.has("nocache")),
        true,
      );
      assert.equal(new Set(seen.map((request) => request.url.search)).size, seen.length);
    }),
);

it.effect(
  "the OPTIONS door sends OPTIONS and no secret, and a protection redirect is reported as protected",
  () =>
    Effect.gen(function* () {
      const seen: Seen[] = [];
      const plan = planProbes(PROBE_DOOR.OPTIONS_ALLOWLIST, PATHS);
      const results = yield* probeDeployment(
        { address: PREVIEW, bypassSecret: Option.none() },
        plan,
      ).pipe(Effect.provide(deployment(seen, (init) => init.method === PROBE_METHOD.OPTIONS)));

      assert.deepEqual(
        new Set(seen.map((request) => request.method)),
        new Set([PROBE_METHOD.OPTIONS]),
      );
      assert.deepEqual(new Set(seen.map((request) => request.bypass)), new Set([null]));
      assert.deepEqual(
        new Set(results.map((result) => result.verdict)),
        new Set([VERDICT.PROTECTED]),
      );
      assert.equal(results.length, plan.length);
    }),
);

it.effect("a dropped connection is retried and an answer is not", () =>
  Effect.gen(function* () {
    let calls = 0;
    const layer = fakeHttpClientLayer(() => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return new Response("{}", { status: 401, headers: { "x-vercel-cache": "MISS" } });
    });
    const fiber = yield* Effect.fork(
      probeDeployment({ address: PREVIEW, bypassSecret: Option.none() }, [
        get("/api/brain/capabilities", PROBE_STATUS.UNAUTHORIZED),
      ]).pipe(Effect.provide(layer)),
    );
    yield* TestClock.adjust("1 second");
    const results = yield* Fiber.join(fiber);
    assert.equal(calls, 2);
    assert.deepEqual(
      results.map((result) => result.verdict),
      [VERDICT.OK],
    );
  }),
);
