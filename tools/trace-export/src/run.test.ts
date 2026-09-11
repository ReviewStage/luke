import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as FileSystem from "@effect/platform/FileSystem";
import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { unboxExportEffect } from "./run.js";

/** Records the golden instead of asserting it. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const FIXTURES_ROOT = path.join(fileURLToPath(import.meta.url), "../../fixtures");
const SOURCE_PATH = path.join(FIXTURES_ROOT, "sample-trace.jsonl");
const GOLDEN_PATH = path.join(FIXTURES_ROOT, "sample-trace.json");

/**
 * A fixture trace, recorded through the same `FileSystem`-backed effect the
 * CLI runs, exports to the document held at `fixtures/sample-trace.json`,
 * byte for byte: the entry with an unrecognized `kind` is decoded against
 * `TraceEntryKindSchema` and costs only itself.
 */
it.scoped("a fixture trace exports to the recorded document, byte for byte", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const destination = yield* fs.makeTempFileScoped();
    yield* unboxExportEffect(SOURCE_PATH, { path: destination }, { name: "sample-trace" });
    const written = yield* fs.readFileString(destination);
    yield* Effect.promise(async () => {
      if (UPDATE_FIXTURES) {
        await writeFile(GOLDEN_PATH, written);
        return;
      }
      const golden = await readFile(GOLDEN_PATH, "utf8");
      assert.equal(written, golden);
    });
  }).pipe(Effect.provide(NodeContext.layer)),
);
