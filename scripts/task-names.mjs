import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { allowed, CANARY, refusedAt, refusedIn, refusesSqlName } from "./lib/task-names.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every tracked TypeScript source the apps, packages, and tools hold. */
const SOURCE_PATHSPECS = [
  "apps/*.ts",
  "apps/*.tsx",
  "apps/*.mts",
  "packages/*.ts",
  "packages/*.tsx",
  "packages/*.mts",
  "tools/*.ts",
  "tools/*.mts",
];

/** The canary's answers that differ from what it must answer, as lines; none where it holds. */
async function canaryDrift() {
  const drift = [];
  const invalid = `${CANARY.DIRECTORY}/invalid.ts`;
  const text = await readFile(path.join(REPOSITORY_ROOT, invalid), "utf8");
  const sighted = refusedIn(invalid, text).map(refusedAt);
  if (sighted.join("\n") !== CANARY.REFUSED.join("\n")) {
    drift.push(
      `${invalid} refused ${sighted.join(", ") || "nothing"} where it must refuse ${CANARY.REFUSED.join(", ")}`,
    );
  }
  for (const [name, file] of CANARY.ALLOWED) {
    if (allowed(name, file) === undefined)
      drift.push(`${name} is refused in ${file}, where it must stand`);
  }
  for (const name of CANARY.SQL_REFUSED) {
    if (!refusesSqlName(name)) drift.push(`the schema clause lets "${name}" stand`);
  }
  for (const name of CANARY.SQL_ALLOWED) {
    if (refusesSqlName(name)) drift.push(`the schema clause refuses "${name}"`);
  }
  return drift;
}

const drift = await canaryDrift();
if (drift.length > 0) {
  process.stderr.write(
    `error: the task-names canary does not hold, so its silence about the repository means nothing:\n${drift.map((line) => `  ${line}`).join("\n")}\n`,
  );
  process.exit(1);
}

const files = execFileSync("git", ["ls-files", "--", ...SOURCE_PATHSPECS], {
  cwd: REPOSITORY_ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const refused = [];
for (const file of files) {
  refused.push(...refusedIn(file, await readFile(path.join(REPOSITORY_ROOT, file), "utf8")));
}

if (refused.length > 0) {
  const lines = refused.map((one) => `  ${one.file}:${one.line}: ${one.name}`);
  process.stderr.write(
    `error: these names call the unit of work a plan. A task is the unit of work and a plan is the document inside it: name each one task, or, where it is the plan document or a wire or stored spelling, add a pattern to scripts/lib/task-names.mjs's allowlist with the reason it holds:\n${lines.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`No name calls a task a plan in ${files.length} files.\n`);
