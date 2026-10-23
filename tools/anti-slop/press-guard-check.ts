import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  configWeakensGuard,
  guardSuppressionLines,
  isOutsideUi,
  JSX_SOURCE,
  PRESS_GUARD_RULE,
} from "./shared/press-guard.ts";

/**
 * The guard has no escape hatch: oxlint honors every inline disable and has
 * no flag to refuse one, so `pnpm lint` runs this after it. It fails on a
 * JSX-capable file outside `@luke/ui` holding a directive that would
 * silence `no-raw-press-outside-ui`, and on an `.oxlintrc.json` that leaves
 * the rule short of an error anywhere.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Tracked files and new ones git does not ignore, so a local run sees a file not yet added. */
function sourceFiles(): readonly string[] {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    },
  );
  if (listed.status !== 0) throw new Error(`git ls-files failed:\n${listed.stderr}`);
  return listed.stdout.split("\0").filter((file) => file.length > 0);
}

const problems: string[] = [];
const config: unknown = JSON.parse(
  readFileSync(path.join(REPOSITORY_ROOT, ".oxlintrc.json"), "utf8"),
);
const weakened = configWeakensGuard(config);
if (weakened !== undefined) problems.push(`.oxlintrc.json: ${weakened}`);
for (const file of sourceFiles()) {
  const absolute = path.join(REPOSITORY_ROOT, file);
  if (!JSX_SOURCE.test(file) || !isOutsideUi(absolute) || !existsSync(absolute)) continue;
  for (const line of guardSuppressionLines(readFileSync(absolute, "utf8"))) {
    problems.push(`${file}:${line}: a disable directive silences ${PRESS_GUARD_RULE}`);
  }
}
if (problems.length > 0) {
  process.stderr.write(
    `error: ${PRESS_GUARD_RULE} takes no suppression. Move the press onto a @luke/ui component or variant instead:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n`,
  );
  process.exitCode = 1;
}
