import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_WIRE } from "@repo/features/host-wire";
import { temporaryDirectory } from "@repo/runtime/testing";
import { afterEach, beforeEach, test, vi } from "vitest";
import installScript from "../server/routes/hosts/install-script.js";
import { disposeWebRuntime } from "../server/runtime.js";
import { dispatched } from "./support/platform-landing.js";

const PLACEHOLDER_DATABASE_URL = "postgresql://install:script@127.0.0.1:5432/app";

const PREVIEW_ORIGIN = "https://vespin-git-feature-install-stage-review.vercel.app";

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

  const file = join(await temporaryDirectory(t, "install-script-"), "install.sh");
  writeFileSync(file, script);
  const origin = spawnSync("sh", ["-c", '. "$1"; printf %s "$ORIGIN"', "sh", file], {
    env: { PATH: process.env.PATH, APP_HOST_INSTALL_LIBRARY: "1" },
    encoding: "utf8",
  });
  assert.equal(origin.stdout, PREVIEW_ORIGIN, origin.stderr);
});
