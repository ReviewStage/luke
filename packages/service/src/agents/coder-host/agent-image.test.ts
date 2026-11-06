/**
 * agent-image.test.ts -- the image's reference read from beside a function's entry, and a build that left none there.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { temporaryDirectory } from "@repo/wire/testing";
import { Effect, Exit } from "effect";
import { AGENT_IMAGE_FILE, AgentImage, agentImageFromDirectory } from "./agent-image.js";

const referenceIn = (directory: string) =>
  Effect.flatMap(AgentImage, (image) => image.reference).pipe(
    Effect.provide(agentImageFromDirectory(directory)),
    Effect.exit,
  );

it.effect("the reference is read from the directory the function's entry stands in", (t) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => temporaryDirectory(t, "agent-image-"));
    writeFileSync(join(directory, AGENT_IMAGE_FILE), "agent-image:0123abcd\n");

    const read = yield* referenceIn(directory);

    assert.ok(Exit.isSuccess(read));
    assert.equal(read.value, "agent-image:0123abcd");
  }),
);

it.effect("a directory the build left no reference in fails the read", (t) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => temporaryDirectory(t, "agent-image-"));

    const read = yield* referenceIn(directory);

    assert.ok(Exit.isFailure(read));
  }),
);
