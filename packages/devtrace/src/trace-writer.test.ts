import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { LIVE_SERVER_EVENT } from "@sidecar/live";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { isRecord, recordFromJsonLine } from "@sidecar/wire";
import { Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { AgentTraceWriter } from "./trace-writer.js";
import { TRACE_DIRECTION } from "./vocabulary.js";

/** The `FileSystem` and `Path` the host's layer hands the writer. */
const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);

it.effect("raw audio handed straight to the writer still never reaches the file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectoryScoped("devtrace-");
    const writer = yield* AgentTraceWriter.make({ directory });
    writer.recordWire({
      direction: TRACE_DIRECTION.CLIENT,
      event: { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAAAAA=" },
    });
    yield* writer.settled;
    const written = yield* fs.readFileString(writer.file);
    const [line] = written.split("\n");
    const entry = recordFromJsonLine(line ?? "");
    assert.ok(isRecord(entry?.event));
    assert.deepEqual(entry?.event, { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audioBytes: 5 });
  }).pipe(Effect.provide(platform)),
);

it.effect("a writer that cannot write reports once and stays quiet after", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* temporaryDirectoryScoped("devtrace-");
    // A file where the trace directory should be makes every mkdir fail.
    const blocked = path.join(directory, "blocked");
    yield* fs.writeFileString(blocked, "");
    const reports: string[] = [];
    const writer = yield* AgentTraceWriter.make({
      directory: blocked,
      report: (message) => reports.push(message),
    });
    writer.recordWire({ direction: TRACE_DIRECTION.CLIENT, event: { type: "one" } });
    writer.recordWire({ direction: TRACE_DIRECTION.CLIENT, event: { type: "two" } });
    yield* writer.settled;
    assert.equal(reports.length, 1);
  }).pipe(Effect.provide(platform)),
);
