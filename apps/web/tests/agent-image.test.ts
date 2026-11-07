/**
 * agent-image.test.ts -- what the build ships beside a function that opens a sandbox: the digest a base snapshot is keyed on stands through a change to the runner alone, and moves with one to the Dockerfile.
 */

import assert from "node:assert/strict";
import {
  AGENT_IMAGE_BASE_FILE,
  AGENT_IMAGE_FILE,
  AGENT_RUNNER_FILE,
} from "@repo/service/agents/coder-host/agent-image";
import { test } from "vitest";
import { shippedBesideFunctions } from "../scripts/agent-image";

/** The files shipped for a context of the Dockerfile and the runner given, each read as text by its name. */
function shipped(dockerfile: string, runner: string): ReadonlyMap<string, string> {
  const context = [
    { name: "Dockerfile", contents: Buffer.from(dockerfile) },
    { name: AGENT_RUNNER_FILE, contents: Buffer.from(runner) },
  ];
  return new Map(
    shippedBesideFunctions(context).map((file) => [
      file.name,
      Buffer.from(file.contents).toString("utf8"),
    ]),
  );
}

test("a runner's change moves the image but not the base's digest, and a Dockerfile's change moves both", () => {
  const before = shipped("FROM node:24", "// runner one");
  const runnerMoved = shipped("FROM node:24", "// runner two");
  const dockerfileMoved = shipped("FROM node:26", "// runner one");

  assert.notEqual(runnerMoved.get(AGENT_IMAGE_FILE), before.get(AGENT_IMAGE_FILE));
  assert.equal(runnerMoved.get(AGENT_IMAGE_BASE_FILE), before.get(AGENT_IMAGE_BASE_FILE));
  assert.equal(runnerMoved.get(AGENT_RUNNER_FILE), "// runner two");
  assert.notEqual(dockerfileMoved.get(AGENT_IMAGE_BASE_FILE), before.get(AGENT_IMAGE_BASE_FILE));
});
