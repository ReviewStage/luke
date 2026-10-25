import path from "node:path";
import { fileURLToPath } from "node:url";

import { agentPinsGuard } from "./guards/agent-pins.ts";
import { agentToolsGuard } from "./guards/agent-tools.ts";
import { antiSlopListsGuard } from "./guards/anti-slop-lists.ts";
import { catalogExamplesGuard } from "./guards/catalog-examples.ts";
import type { RepositoryGuard } from "./guards/guard.ts";
import { launchBundleGuard } from "./guards/launch-bundle.ts";
import { probeFixturesGuard } from "./guards/probe-fixtures.ts";
import { webPagesGuard } from "./guards/web-pages.ts";

/**
 * repository-guard.ts -- the rules about the repository's state a lint rule cannot see, run by `scripts/repository-checks.sh`.
 *
 * Each guard was once a test that read the repository to forbid or require
 * a pattern, which root AGENTS.md's "Testing" leaves to a check; each reads
 * what it holds (a manifest, an installed package, a directory, a page) and
 * fails on what disagrees. Run under the tsx loader, since several load the
 * module whose constants they compare: `node --import tsx tools/anti-slop/repository-guard.ts`.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GUARDS: Readonly<Record<string, RepositoryGuard>> = {
  "agent-pins": agentPinsGuard,
  "agent-tools": agentToolsGuard,
  "anti-slop-lists": antiSlopListsGuard,
  "catalog-examples": catalogExamplesGuard,
  "launch-bundle": launchBundleGuard,
  "probe-fixtures": probeFixturesGuard,
  "web-pages": webPagesGuard,
};

for (const [name, guard] of Object.entries(GUARDS)) {
  const problems = await guard.problems(REPOSITORY_ROOT);
  if (problems.length === 0) continue;
  process.stderr.write(
    `error: ${name}: ${guard.holds}:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
