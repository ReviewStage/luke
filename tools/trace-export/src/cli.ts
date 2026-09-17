/**
 * Turns a recorded trace into the JSON unbox-ai opens:
 *
 *   pnpm --filter @luke/trace-export export <trace.jsonl> [out.json]
 *   npx unbox-ai out.json
 *
 * Reading and writing stay on this machine; the viewer the output is meant
 * for runs locally too.
 */

import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Path } from "effect";
import { unboxExportEffect } from "./run.js";

const [source, destination] = process.argv.slice(2);
if (!source) {
  process.stderr.write("Usage: export <trace.jsonl> [out.json]\n");
  process.exit(1);
}

// pnpm runs a script with the owning package as its working directory — the
// workspace root for the `trace:export` alias, this package for `--filter` —
// not where the command was typed, so a relative path resolved against the
// process's own cwd lands inside the repository. INIT_CWD is pnpm's record
// of where the developer actually stood.
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const sourcePath = path.resolve(invocationDirectory, source);
  yield* unboxExportEffect(
    sourcePath,
    destination ? { path: path.resolve(invocationDirectory, destination) } : { stdout: true },
    { name: path.basename(sourcePath, ".jsonl") },
  );
});

NodeRuntime.runMain(
  program.pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);
