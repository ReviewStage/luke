#!/usr/bin/env node
// Republish the default branch's visual evidence as the baseline every pull
// request is compared against.
//
//   EVIDENCE_DIRECTORY=artifacts/evidence node scripts/publish-evidence-baseline.mjs
//
// Runs on a push to the default branch, after `./scripts/verify.sh`.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { requiredEnvironment } from "./lib/github.mjs";
import { BASELINE_DIRECTORY, publishMedia } from "./publish-pr-media.mjs";

async function main() {
  const directory = requiredEnvironment("EVIDENCE_DIRECTORY");
  const names = (await readdir(directory)).filter((entry) => entry.endsWith(".png")).sort();
  if (names.length === 0) throw new Error(`No screenshots to publish in ${directory}`);

  const published = await publishMedia({
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
    directory: BASELINE_DIRECTORY,
    files: names.map((name) => join(directory, name)),
  });

  process.stdout.write(`Published ${published.length} baseline screenshots\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
