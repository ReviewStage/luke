import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  HELD_PRODUCT_EVENTS_VERSION,
  type HeldProductEventsRecord,
  PRODUCT_EVENT,
} from "@sidecar/analytics";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { Effect } from "effect";
import { HELD_PRODUCT_EVENTS_FILE, heldProductEvents } from "./held-product-events.js";

const AT = Date.parse("2026-09-12T12:00:00.000Z");

const withStateRoot = <A>(
  run: (stateRoot: string) => Effect.Effect<A, never, FileSystem.FileSystem>,
) =>
  Effect.scoped(Effect.flatMap(temporaryDirectoryScoped(), run)).pipe(
    Effect.provide(NodeFileSystem.layer),
  );

it.effect("an absent hold reads as nothing", () =>
  withStateRoot((stateRoot) =>
    Effect.gen(function* () {
      const fileSystem = yield* Effect.context<FileSystem.FileSystem>();
      const hold = heldProductEvents(stateRoot, () => undefined, fileSystem);
      assert.equal(yield* hold.read, undefined);
    }),
  ),
);

it.effect("a written hold reads back whole, and an empty one reads as nothing", () =>
  withStateRoot((stateRoot) =>
    Effect.gen(function* () {
      const fileSystem = yield* Effect.context<FileSystem.FileSystem>();
      const hold = heldProductEvents(stateRoot, () => undefined, fileSystem);
      const record: HeldProductEventsRecord = {
        version: HELD_PRODUCT_EVENTS_VERSION,
        events: [{ name: PRODUCT_EVENT.INTRODUCTION_COMPLETE, at: AT, properties: {} }],
      };
      yield* hold.write(record);
      assert.deepEqual(yield* hold.read, record);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(stateRoot, HELD_PRODUCT_EVENTS_FILE), "utf8")),
        record,
      );

      yield* hold.write({ version: HELD_PRODUCT_EVENTS_VERSION, events: [] });
      assert.deepEqual(yield* hold.read, { version: HELD_PRODUCT_EVENTS_VERSION, events: [] });
    }),
  ),
);

it.effect("a hold of another version or shape reads as nothing", () =>
  withStateRoot((stateRoot) =>
    Effect.gen(function* () {
      const fileSystem = yield* Effect.context<FileSystem.FileSystem>();
      const hold = heldProductEvents(stateRoot, () => undefined, fileSystem);
      const file = path.join(stateRoot, HELD_PRODUCT_EVENTS_FILE);
      fs.writeFileSync(
        file,
        JSON.stringify({ version: HELD_PRODUCT_EVENTS_VERSION + 1, events: [] }),
      );
      assert.equal(yield* hold.read, undefined);
      fs.writeFileSync(file, "not json");
      assert.equal(yield* hold.read, undefined);
    }),
  ),
);

it.effect("a write that cannot land is reported and read as nothing", () =>
  withStateRoot((stateRoot) =>
    Effect.gen(function* () {
      const fileSystem = yield* Effect.context<FileSystem.FileSystem>();
      const reported: string[] = [];
      const hold = heldProductEvents(
        path.join(stateRoot, "missing", "deeper"),
        (message) => reported.push(message),
        fileSystem,
      );
      yield* hold.write({ version: HELD_PRODUCT_EVENTS_VERSION, events: [] });
      assert.equal(reported.length, 1);
      assert.equal(yield* hold.read, undefined);
    }),
  ),
);
