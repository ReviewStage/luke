import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Option } from "effect";
import { AGENT_TRACE_DIRECTORY_VARIABLE, agentTraceDirectory } from "./trace-directory.js";

const readUnder = (entries: readonly (readonly [string, string])[]) =>
  Effect.withConfigProvider(agentTraceDirectory, ConfigProvider.fromMap(new Map(entries)));

it.effect("a provider naming the trace directory answers that directory", () =>
  Effect.gen(function* () {
    const read = yield* readUnder([
      [AGENT_TRACE_DIRECTORY_VARIABLE, "/tmp/luke-trace"],
      ["PATH", "/bin"],
    ]);
    assert.deepEqual(read, Option.some("/tmp/luke-trace"));
  }),
);

it.effect("a provider holding no trace directory answers none, never a default", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* readUnder([["PATH", "/bin"]]), Option.none());
    assert.deepEqual(yield* readUnder([]), Option.none());
  }),
);
