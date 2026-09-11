import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { test } from "vitest";

/**
 * The eve deployment rests on one discovery outcome: eve resolves `eve/` as
 * a flat app root, so its build output lands inside that directory, which is
 * the eve Vercel project's Root Directory. A directory eve resolved as the
 * nested layout instead would put the app root at `apps/web` and the output
 * one level above where the project reads it, and nothing before the deploy
 * would say so. This runs the real build under Vercel's marker and reads
 * where the output landed.
 */

const WEB = join(import.meta.dirname, "..");
const EVE = join(WEB, "eve");
const VERCEL_OUTPUT = join(".vercel", "output", "config.json");
const BUILD_OUTPUT_VERSION = 3;

const BuildOutputConfig = Schema.Struct({ version: Schema.Number });

function mtimeOrAbsent(path: string): number | undefined {
  return existsSync(path) ? statSync(path).mtimeMs : undefined;
}

test("eve resolves eve/ as a flat app root and writes its Vercel output there", {
  timeout: 180_000,
}, () => {
  const parentConfig = join(WEB, VERCEL_OUTPUT);
  const eveConfig = join(EVE, VERCEL_OUTPUT);
  const parentBefore = mtimeOrAbsent(parentConfig);
  const startedAt = Date.now();

  const build = spawnSync("pnpm", ["exec", "eve", "build", "--skip-sandbox-prewarm"], {
    cwd: EVE,
    encoding: "utf8",
    env: { ...process.env, VERCEL: "1", EVE_TELEMETRY_DISABLED: "1" },
  });
  assert.equal(build.status, 0, build.stderr);

  const eveAfter = mtimeOrAbsent(eveConfig);
  assert.ok(eveAfter !== undefined && eveAfter >= startedAt);
  assert.equal(mtimeOrAbsent(parentConfig), parentBefore);

  const config = Schema.decodeUnknownSync(BuildOutputConfig)(
    JSON.parse(readFileSync(eveConfig, "utf8")),
  );
  assert.equal(config.version, BUILD_OUTPUT_VERSION);
});
