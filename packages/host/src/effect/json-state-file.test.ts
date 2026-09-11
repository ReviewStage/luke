import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { Effect, Layer, Schema } from "effect";
import { jsonStateFileEffect } from "./json-state-file.js";
import { Reporter, StateRoot } from "./seams.js";

const RecordSchema = Schema.Struct({
  first: Schema.optional(Schema.String),
  second: Schema.optional(Schema.String),
});

const layers = (stateRoot: string, report: (message: string) => void) =>
  Layer.mergeAll(
    NodeFileSystem.layer,
    Layer.succeed(StateRoot, stateRoot),
    Layer.succeed(Reporter, { report }),
  );

const withTemporaryDirectory = <A>(run: (stateRoot: string) => Effect.Effect<A, never>) =>
  Effect.scoped(Effect.flatMap(temporaryDirectoryScoped(), run)).pipe(
    Effect.provide(NodeFileSystem.layer),
  );

describe("jsonStateFileEffect", () => {
  it.effect("reads an absent file as undefined", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const value = yield* file.read.pipe(Effect.provide(layers(stateRoot, () => {})));
        assert.equal(value, undefined);
      }),
    ),
  );

  it.effect("reads back what update wrote", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const provided = layers(stateRoot, () => {});
        yield* file.update(() => ({ first: "a" })).pipe(Effect.provide(provided));
        const value = yield* file.read.pipe(Effect.provide(provided));
        assert.deepEqual(value, { first: "a" });
      }),
    ),
  );

  it.effect("merges over whatever is on disk at the moment of the write, not an earlier read", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const provided = layers(stateRoot, () => {});
        yield* file.update(() => ({ first: "a" })).pipe(Effect.provide(provided));
        const value = yield* file
          .update((current) => ({ ...current, second: "b" }))
          .pipe(Effect.provide(provided));
        assert.deepEqual(value, { first: "a", second: "b" });
      }),
    ),
  );

  it.effect("writes the newline-delimited JSON on disk, with undefined fields absent", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        yield* file
          .update(() => ({ first: "a" }))
          .pipe(Effect.provide(layers(stateRoot, () => {})));
        const raw = fs.readFileSync(path.join(stateRoot, "state.json"), "utf8");
        assert.equal(raw, '{"first":"a"}\n');
      }),
    ),
  );

  it.effect("reads malformed JSON as undefined rather than failing", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        fs.writeFileSync(path.join(stateRoot, "state.json"), "not json");
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const value = yield* file.read.pipe(Effect.provide(layers(stateRoot, () => {})));
        assert.equal(value, undefined);
      }),
    ),
  );

  it.effect("reads a JSON value that is not an object as undefined", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        fs.writeFileSync(path.join(stateRoot, "state.json"), "[1,2,3]");
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const value = yield* file.read.pipe(Effect.provide(layers(stateRoot, () => {})));
        assert.equal(value, undefined);
      }),
    ),
  );

  it.effect("reads a record the schema refuses as undefined", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        fs.writeFileSync(path.join(stateRoot, "state.json"), JSON.stringify({ first: 12 }));
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const value = yield* file.read.pipe(Effect.provide(layers(stateRoot, () => {})));
        assert.equal(value, undefined);
      }),
    ),
  );

  it.effect("reads a record with no known field as undefined, the same as no record at all", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        fs.writeFileSync(path.join(stateRoot, "state.json"), JSON.stringify({ unrelated: "x" }));
        const file = jsonStateFileEffect({ fileName: "state.json", schema: RecordSchema });
        const value = yield* file.read.pipe(Effect.provide(layers(stateRoot, () => {})));
        assert.equal(value, undefined);
      }),
    ),
  );

  it.effect("reports a write that cannot land, and still answers the mutated record", () =>
    withTemporaryDirectory((stateRoot) =>
      Effect.gen(function* () {
        const reports: string[] = [];
        const file = jsonStateFileEffect({ fileName: "nested/state.json", schema: RecordSchema });
        const value = yield* file
          .update(() => ({ first: "a" }))
          .pipe(Effect.provide(layers(stateRoot, (message) => reports.push(message))));
        assert.deepEqual(value, { first: "a" });
        assert.equal(reports.length, 1);
        assert.match(reports[0] ?? "", /Could not persist nested\/state\.json/);
      }),
    ),
  );
});
