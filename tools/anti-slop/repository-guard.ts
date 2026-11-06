import path from "node:path";
import { fileURLToPath } from "node:url";

import { agentPinsGuard } from "./guards/agent-pins.ts";
import { antiSlopListsGuard } from "./guards/anti-slop-lists.ts";
import { catalogExamplesGuard } from "./guards/catalog-examples.ts";
import type { RepositoryGuard } from "./guards/guard.ts";
import { launchBundleGuard } from "./guards/launch-bundle.ts";
import { probeFixturesGuard } from "./guards/probe-fixtures.ts";
import { webPagesGuard } from "./guards/web-pages.ts";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GUARDS: Readonly<Record<string, RepositoryGuard>> = {
  "agent-pins": agentPinsGuard,
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
