/**
 * agent-image.test.ts -- the image's reference read from beside a function's entry, and a build that left none there.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@repo/wire/testing";
import { Effect, Exit } from "effect";
import { test } from "vitest";
import { AGENT_IMAGE_FILE, AgentImage, agentImageFromDirectory } from "./agent-image.js";

const referenceIn = (directory: string) =>
  Effect.runPromiseExit(
    Effect.flatMap(AgentImage, (image) => image.reference).pipe(
      Effect.provide(agentImageFromDirectory(directory)),
    ),
  );

test("the reference is read from the directory the function's entry stands in", async (t) => {
  const directory = await temporaryDirectory(t, "agent-image-");
  writeFileSync(join(directory, AGENT_IMAGE_FILE), "agent-image:0123abcd\n");

  const read = await referenceIn(directory);

  assert.ok(Exit.isSuccess(read));
  assert.equal(read.value, "agent-image:0123abcd");
});

test("a directory the build left no reference in fails the read", async (t) => {
  const directory = await temporaryDirectory(t, "agent-image-");

  const read = await referenceIn(directory);

  assert.ok(Exit.isFailure(read));
});
