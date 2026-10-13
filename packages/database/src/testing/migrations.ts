import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { MIGRATIONS_FOLDER } from "../core/migrator.js";

const MIGRATION_FILE = "migration.sql";

/**
 * The generated migrations as a folder of the test's own, holding them only
 * up to the one the test names: what a test of one migration over the rows
 * the deployment before it wrote migrates its database to first. `through`
 * copies the folder further, up to another migration or `latest`, and the
 * same `runWebMigrations` over the copy applies what was added. The copy
 * goes with the test's scope.
 */
export const migrationsFolderThrough = (name: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const path = yield* Path;
    const folder = yield* fileSystem.makeTempDirectoryScoped({ prefix: "luke-migrations-" });
    const names = (yield* fileSystem.readDirectory(MIGRATIONS_FOLDER))
      .filter((entry) => !entry.startsWith("."))
      .sort((left, right) => left.localeCompare(right));
    const latest = names.at(-1) ?? name;
    const copied = new Set<string>();
    const through = (last: string) =>
      Effect.gen(function* () {
        if (!names.includes(last)) return yield* Effect.die(new Error(`no migration ${last}`));
        const added = names.filter((entry) => entry.localeCompare(last) <= 0 && !copied.has(entry));
        yield* Effect.forEach(added, (entry) =>
          Effect.gen(function* () {
            yield* fileSystem.makeDirectory(path.join(folder, entry));
            yield* fileSystem.copyFile(
              path.join(MIGRATIONS_FOLDER, entry, MIGRATION_FILE),
              path.join(folder, entry, MIGRATION_FILE),
            );
            copied.add(entry);
          }),
        );
      });
    yield* through(name);
    return { folder, through, latest };
  });
