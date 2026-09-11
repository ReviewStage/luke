import assert from "node:assert/strict";
import { HttpClient } from "@effect/platform";
import type { Effect } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { disposeWebRuntime, runWeb, type WebServices, webRuntime } from "../server/runtime.js";

const client: Effect.Effect<HttpClient.HttpClient, never, WebServices> = HttpClient.HttpClient;

/**
 * The layer names a database, so building it needs a connection string. `pg`
 * connects on its first query, and nothing here queries, so this one is never
 * dialled — the placeholder `auth:generate` uses for the same reason.
 */
const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/luke";

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
