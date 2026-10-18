/**
 * refuse-contractions.ts -- fails when a new migration renames or drops what old code still reads.
 *
 * Run by `scripts/repository-checks.sh`; `src/core/migration-contractions.ts`
 * says why the rename or drop is refused.
 */
import { fileURLToPath } from "node:url";
import { CONTRACTION_ADVICE, migrationContractions } from "../src/core/migration-contractions.js";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

const contractions = migrationContractions(MIGRATIONS);
if (contractions.length > 0) {
  process.stderr.write(
    `error: a new migration renames or drops a table, column, type, or view, which breaks the deployment still serving the old names and every coding agent run pinned to it; ${CONTRACTION_ADVICE}:\n${contractions
      .map((one) => `  ${one.folder}: ${one.statement}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}
