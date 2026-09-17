import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { settleTextGolden } from "@sidecar/wire/testing";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { unboxExportEffect } from "./run.js";

const FIXTURES_ROOT = path.join(fileURLToPath(import.meta.url), "../../fixtures");
const SOURCE_PATH = path.join(FIXTURES_ROOT, "sample-trace.jsonl");
const GOLDEN_PATH = path.join(FIXTURES_ROOT, "sample-trace.json");

/**
 * A fixture trace, recorded through the same `FileSystem`-backed effect the
 * CLI runs, exports to the document held at `fixtures/sample-trace.json`,
 * byte for byte: the entry with an unrecognized `kind` is decoded against
 * `TraceEntryKindSchema` and costs only itself. `LUKE_UPDATE_FIXTURES=1`
 * records the golden through the shared helper instead of asserting it.
 */
it.effect("a fixture trace exports to the recorded document, byte for byte", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const destination = yield* fs.makeTempFileScoped();
    yield* unboxExportEffect(SOURCE_PATH, { path: destination }, { name: "sample-trace" });
    const written = yield* fs.readFileString(destination);
    yield* Effect.promise(() => settleTextGolden(GOLDEN_PATH, written));
  }).pipe(Effect.provide(NodeServices.layer)),
);
