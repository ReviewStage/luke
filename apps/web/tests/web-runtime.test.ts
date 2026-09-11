import assert from "node:assert/strict";
import { HttpClient } from "@effect/platform";
import type { Effect } from "effect";
import { test } from "vitest";
import { disposeWebRuntime, runWeb, type WebServices, webRuntime } from "../server/runtime.js";

const client: Effect.Effect<HttpClient.HttpClient, never, WebServices> = HttpClient.HttpClient;

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
