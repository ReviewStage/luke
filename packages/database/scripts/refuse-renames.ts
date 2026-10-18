/**
 * refuse-renames.ts -- fails when a new migration renames a table or column in place.
 *
 * Run by `scripts/repository-checks.sh`; `src/core/migration-renames.ts`
 * says why the rename is refused.
 */
import { fileURLToPath } from "node:url";
import { migrationRenames, RENAME_ADVICE } from "../src/core/migration-renames.js";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const renames = migrationRenames(MIGRATIONS);
if (renames.length > 0) {
  process.stderr.write(
    `error: a new migration renames a table or column in place, which breaks the deployment still serving the old names; ${RENAME_ADVICE}:\n${renames
      .map((one) => `  ${one.folder}: ${one.statement}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}
