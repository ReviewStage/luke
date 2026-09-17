import assert from "node:assert/strict";
import { Cause, Effect, Schema } from "effect";
import { TestConsole } from "effect/testing";
import { HttpClient } from "effect/unstable/http";
import { afterEach, beforeEach, test, vi } from "vitest";
import { disposeWebRuntime, runWeb, type WebServices, webRuntime } from "../server/runtime.js";

const client: Effect.Effect<HttpClient.HttpClient, never, WebServices> = HttpClient.HttpClient;

/**
 * The layer names a database, so building it needs a connection string. `pg`
 * connects on its first query, and nothing here queries, so this one is never
 * dialled — the placeholder `auth:generate` uses for the same reason.
 */
const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/luke";

/** The fields of a logged line this suite reads back. */
const LOGGED_ENTRY = Schema.Struct({
  level: Schema.String,
  message: Schema.String,
  cause: Schema.String,
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the runtime is one instance for every invocation on a warm module", async () => {
  try {
    assert.equal(webRuntime(), webRuntime());
  } finally {
    await disposeWebRuntime();
  }
});

test("a service the layer built for one invocation is the service the next one gets", async () => {
  try {
    assert.equal(await runWeb(client), await runWeb(client));
  } finally {
    await disposeWebRuntime();
  }
});

test("disposing leaves the next invocation to build the runtime again", async () => {
  const cold = webRuntime();
  await disposeWebRuntime();
  try {
    assert.notEqual(webRuntime(), cold);
  } finally {
    await disposeWebRuntime();
  }
});

test("an instance configured with no database is refused at the edge", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  try {
    await assert.rejects(runWeb(client));
  } finally {
    await disposeWebRuntime();
  }
});

test("a line logged on the runtime is one JSON object with its level, message, and cause", async () => {
  const logged = Effect.gen(function* () {
    yield* Effect.logWarning("the line", Cause.fail("the reason"));
    return yield* TestConsole.logLines;
  }).pipe(Effect.provide(TestConsole.layer));
  try {
    const lines = await runWeb(logged);
    assert.equal(lines.length, 1);
    const entry = Schema.decodeUnknownSync(LOGGED_ENTRY)(JSON.parse(String(lines[0])));
    assert.equal(entry.level, "WARN");
    assert.equal(entry.message, "the line");
    assert.match(entry.cause, /the reason/);
  } finally {
    await disposeWebRuntime();
  }
});
