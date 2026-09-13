import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANARY,
  compilerOptionsFrom,
  discardedAt,
  findDiscardedEffects,
} from "./lib/discarded-effect.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) => path.join(REPOSITORY_ROOT, CANARY.DIRECTORY, name);

const base = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "tsconfig.base.json"), "utf8"));
const found = findDiscardedEffects({
  root: REPOSITORY_ROOT,
  rootNames: [fixture("invalid.ts"), fixture("valid.ts")],
  compilerOptions: compilerOptionsFrom(REPOSITORY_ROOT, base.compilerOptions),
});

test("every description written as a statement is reported, `void` in front of it included", () => {
  assert.deepEqual(found.map(discardedAt), CANARY.DISCARDED);
});

test("a yielded description, a built layer, and a forked fiber are left alone", () => {
  assert.deepEqual(
    found.filter((one) => path.basename(one.file) === "valid.ts"),
    [],
  );
});
