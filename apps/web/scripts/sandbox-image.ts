import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { recordOciImageBuild } from "@luke/service/agents/sandbox-oci-image";
import { Effect, FileSystem, Path } from "effect";

/**
 * Writes the build context of the coding agent's OCI image into the
 * directory given, and prints its key and the reference it is published
 * under, one `name=value` line each, as a workflow's step outputs take them:
 *
 *   pnpm --dir apps/web exec tsx scripts/sandbox-image.ts <directory>
 *
 * `scripts/sandbox-image.sh` builds and publishes what it writes.
 */

const [directory] = process.argv.slice(2);
if (!directory) {
  process.stderr.write("Usage: sandbox-image <directory>\n");
  process.exit(1);
}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const build = yield* recordOciImageBuild();
  for (const file of build.files) {
    const destination = path.join(directory, file.path);
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    yield* fs.writeFile(destination, file.contents);
  }
  yield* Effect.sync(() =>
    process.stdout.write(`key=${build.key}\nreference=${build.reference}\n`),
  );
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
