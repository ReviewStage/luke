import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { fixtureToken, runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import { COMMAND_GONE, vercelSandboxApi } from "./vercel-sandbox-api.js";

/**
 * A detached command's exit as Luke reads it, over a fake of Vercel Sandbox's
 * REST API that answers as Vercel does: a plain read names no exit until a
 * read that waits for the command has seen it end.
 *
 * Synthetic team, project, sessions, and tokens throughout.
 */

const SESSION = "sbs_fixture";

/** The API over a fresh fake, and a detached command started in it. */
const started = Effect.gen(function* () {
  const fake = runnerSandboxApi();
  const api = yield* vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(fake.layer));
  const commandId = yield* api.start(SESSION, {
    command: "node",
    args: ["runner.js"],
    sudo: false,
  });
  const command = fake.commands.find((each) => each.id === commandId);
  assert.ok(command !== undefined);
  return { fake, api, command };
});

it.effect("a command that exited reads as exited, though a plain read names no exit", () =>
  Effect.gen(function* () {
    const { fake, api, command } = yield* started;
    command.exitCode = 0;
    const plain = yield* Effect.promise(() =>
      fake
        .respond(
          `https://vercel.com/api/v2/sandboxes/sessions/${SESSION}/cmd/${command.id}?teamId=team_fixture`,
          { method: "GET" },
        )
        .then((response) => response.json()),
    );

    const exit = yield* api.commandExit(SESSION, command.id);

    assert.equal(plain.command.exitCode, null);
    assert.equal(exit, 0);
  }),
);

it.effect("a command whose read outwaits the wait still runs", () =>
  Effect.gen(function* () {
    const { fake, api, command } = yield* started;
    fake.waits.hold = true;

    const reading = yield* Effect.forkChild(api.commandExit(SESSION, command.id));
    yield* TestClock.adjust("2 seconds");

    assert.equal(yield* Fiber.join(reading), null);
  }),
);

it.effect("a command Vercel no longer knows is gone", () =>
  Effect.gen(function* () {
    const { api } = yield* started;

    assert.equal(yield* api.commandExit(SESSION, "cmd_unknown"), COMMAND_GONE);
  }),
);

it.effect("a command read Vercel refused is unavailable", () =>
  Effect.gen(function* () {
    const { fake, api, command } = yield* started;
    fake.failCommandReads.remaining = 1;

    const read = yield* Effect.flip(api.commandExit(SESSION, command.id));

    assert.equal(read.status, 503);
  }),
);
