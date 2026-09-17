import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { LIVE_SERVER_EVENT } from "@sidecar/live";
import { isRecord, recordFromJsonLine } from "@sidecar/wire";
import { Effect, Layer } from "effect";
import { AgentTraceWriter } from "./trace-writer.js";
import { TRACE_DIRECTION } from "./vocabulary.js";

/** A directory of this run's own, and the `FileSystem` the host's layer hands the writer. */
const traceDirectory = Effect.promise(() => mkdtemp(path.join(tmpdir(), "devtrace-")));

it.live("raw audio handed straight to the writer still never reaches the file", () =>
  Effect.gen(function* () {
    const directory = yield* traceDirectory;
    const writer = yield* AgentTraceWriter.make({ directory });
    writer.recordWire({
      direction: TRACE_DIRECTION.CLIENT,
      event: { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAAAAA=" },
    });
    yield* writer.settled;
    const written = yield* Effect.promise(() => readFile(writer.file, "utf8"));
    const [line] = written.split("\n");
    const entry = recordFromJsonLine(line ?? "");
    assert.ok(isRecord(entry?.event));
    assert.deepEqual(entry?.event, { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audioBytes: 5 });
  }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.live("a writer that cannot write reports once and stays quiet after", () =>
  Effect.gen(function* () {
    const directory = yield* traceDirectory;
    // A file where the trace directory should be makes every mkdir fail.
    const blocked = path.join(directory, "blocked");
    yield* Effect.promise(() => writeFile(blocked, ""));
    const reports: string[] = [];
    const writer = yield* AgentTraceWriter.make({
      directory: blocked,
      report: (message) => reports.push(message),
    });
    writer.recordWire({ direction: TRACE_DIRECTION.CLIENT, event: { type: "one" } });
    writer.recordWire({ direction: TRACE_DIRECTION.CLIENT, event: { type: "two" } });
    yield* writer.settled;
    assert.equal(reports.length, 1);
  }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);
