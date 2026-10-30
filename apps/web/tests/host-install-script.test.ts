import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_WIRE } from "@luke/features/host-wire";
import { temporaryDirectory } from "@luke/runtime/testing";
import { afterEach, beforeEach, test, vi } from "vitest";
import installScript from "../server/routes/hosts/install-script.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { dispatched } from "./support/platform-landing.js";

/**
 * host-install-script.test.ts -- the install script the web service answers
 * at `/install.sh` names, as the origin its box enrolls against, the address
 * it was fetched from, so a Preview's install command pairs the box with that
 * Preview rather than production, and nothing in it is left unfilled.
 *
 * The request lands as the platform lands it, by the committed table, on the
 * route file itself, and a shell reads the origin out of the script it
 * answered. The web runtime the route is built on names a database, which
 * nothing here dials.
 */

const PLACEHOLDER_DATABASE_URL = "postgresql://install:script@127.0.0.1:5432/luke";

/** An address a Preview answers on, apart from production's and its other ones. */
const PREVIEW_ORIGIN = "https://luke-git-feature-install-reviewstage.vercel.app";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

test("the install script fetched from a Preview names that Preview as the origin its box enrolls against, with nothing left unfilled", async (t) => {
  const answer = await dispatched(
    new Request(new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, PREVIEW_ORIGIN)),
    new Map([["hosts/install-script", installScript]]),
  );
  const script = await answer.text();
  assert.equal(answer.status, 200);
  assert.doesNotMatch(script, /@@[A-Z0-9_]+@@/u);

  const file = join(await temporaryDirectory(t, "luke-install-script-"), "install.sh");
  writeFileSync(file, script);
  // The script stops once it has defined what it carries, under the variable its own tests set.
  const origin = spawnSync("sh", ["-c", '. "$1"; printf %s "$ORIGIN"', "sh", file], {
    env: { PATH: process.env.PATH, LUKE_HOST_INSTALL_LIBRARY: "1" },
    encoding: "utf8",
  });
  assert.equal(origin.stdout, PREVIEW_ORIGIN, origin.stderr);
});
