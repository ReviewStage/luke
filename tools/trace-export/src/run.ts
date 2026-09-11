/**
 * The effect a trace export runs: read the source file, convert it, and
 * write the document. It is the tool's one runtime edge, entered once from
 * `cli.ts` through `NodeRuntime.runMain`.
 */

import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect } from "effect";
import { type UnboxExportOptions, unboxTraceFromLines } from "./unbox-export.js";

/** Where the converted document goes: a path, or standard output when there is none. */
export type UnboxExportDestination = { path: string } | { stdout: true };

export function unboxExportEffect(
  sourcePath: string,
  destination: UnboxExportDestination,
  options: UnboxExportOptions,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const contents = yield* fs.readFileString(sourcePath);
    const trace = unboxTraceFromLines(contents.split("\n"), options);
    const document = `${JSON.stringify(trace, undefined, 2)}\n`;
    if ("path" in destination) {
      yield* fs.writeFileString(destination.path, document);
      yield* Effect.sync(() => process.stderr.write(`Wrote ${destination.path}\n`));
      return;
    }
    yield* Effect.sync(() => process.stdout.write(document));
  });
}
