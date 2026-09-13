import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANARY,
  compilerOptionsFrom,
  discardedAt,
  findDiscardedEffects,
} from "./lib/discarded-effect.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Everything the repository compiles, and the canary pair beside it. The
 * workspaces have tsconfigs of their own, but one program over all of them
 * costs a single bind rather than twenty-six, and this check reads no
 * diagnostic, so the differences between those tsconfigs — which `@types`
 * package each pulls in — change nothing about which values are Effects.
 */
const SOURCE_GLOBS = [
  "apps/*/src/**/*.ts",
  "apps/*/src/**/*.tsx",
  "apps/web/server/**/*.ts",
  "apps/web/tests/**/*.ts",
  "apps/web/scripts/**/*.ts",
  "apps/web/eve/**/*.ts",
  "packages/*/src/**/*.ts",
  "packages/*/src/**/*.tsx",
  "tools/*/src/**/*.ts",
  `${CANARY.DIRECTORY}/*.ts`,
];

const sourceFiles = [];
for await (const found of glob(SOURCE_GLOBS, { cwd: REPOSITORY_ROOT })) {
  sourceFiles.push(path.join(REPOSITORY_ROOT, found));
}

const base = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "tsconfig.base.json"), "utf8"));
const found = findDiscardedEffects({
  root: REPOSITORY_ROOT,
  rootNames: sourceFiles,
  compilerOptions: compilerOptionsFrom(REPOSITORY_ROOT, base.compilerOptions),
});

const canary = found.filter((one) => one.file.startsWith(`${CANARY.DIRECTORY}/`));
const reported = found.filter((one) => !one.file.startsWith(`${CANARY.DIRECTORY}/`));

const sighted = canary.map(discardedAt);
if (sighted.join("\n") !== CANARY.DISCARDED.join("\n")) {
  process.stderr.write(
    `error: the canary under ${CANARY.DIRECTORY} reported ${sighted.join(", ") || "nothing"} where it must report ${CANARY.DISCARDED.join(", ")}. This program does not resolve Effect's own types, so its silence about the repository means nothing.\n`,
  );
  process.exit(1);
}

if (reported.length > 0) {
  const lines = reported.map(
    (one) => `  ${one.file}:${one.line}: ${one.description} discarded by \`${one.text}\``,
  );
  process.stderr.write(
    `error: these statements describe work and drop it — an Effect, Stream, or Layer written as a statement runs nothing. Yield it inside the effect that wants it, or hand it to the runtime edge that runs it:\n${lines.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(`No discarded Effect, Stream, or Layer in ${sourceFiles.length} files.\n`);
