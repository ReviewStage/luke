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

/** The two eve app roots the deployment builds as services of their own. */
const EVE_ROOTS = { PLANNING: join(WEB, "eve"), CODER: join(WEB, "coder") } as const;
const VERCEL_OUTPUT = join(".vercel", "output", "config.json");
const BUILD_OUTPUT_VERSION = 3;
/** The chunk of the built server that registers every authored module by its source. */
const SERVER_CHUNK = join(
  ".vercel",
  "output",
  "functions",
  "__server.func",
  "_chunks",
  "vercel.web.mjs",
);
/** The Linear connection each root and its worker register, by the path under the root. */
const LINEAR_CONNECTION_FILES = [
  join("connections", "linear.ts"),
  join("subagents", "worker", "connections", "linear.ts"),
] as const;

const BuildOutputConfig = Schema.Struct({ version: Schema.Number });

function mtimeOrAbsent(path: string): number | undefined {
  return existsSync(path) ? statSync(path).mtimeMs : undefined;
}

test.for(Object.entries(EVE_ROOTS))(
  "eve resolves the %s root as a flat app root and writes its Vercel output there, with the root's and its worker's Linear connections",
  { timeout: 180_000 },
  ([, root]) => {
    const parentConfig = join(WEB, VERCEL_OUTPUT);
    const eveConfig = join(root, VERCEL_OUTPUT);
    const parentBefore = mtimeOrAbsent(parentConfig);
    const startedAt = Date.now();

    const build = spawnSync("pnpm", ["exec", "eve", "build", "--skip-sandbox-prewarm"], {
      cwd: root,
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

    // eve hands a declared worker none of its root's connections, so the build carries each one's own.
    const server = readFileSync(join(root, SERVER_CHUNK), "utf8");
    for (const connection of LINEAR_CONNECTION_FILES) {
      assert.ok(server.includes(`"sourcePath": "${join(root, connection)}"`), connection);
    }
  },
);
