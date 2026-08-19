import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { CLI_FAILURE, CliCommandError } from "../../src/cli-session-adapter";
import {
  CliRunFailure,
  CliRunService,
  cliRun,
  fromCliCommandError,
} from "../../src/effect/cli-run";

const RUN_OPTIONS = {
  timeoutMs: 1_000,
  maximumOutputBytes: 4_096,
} as const;

test("cliRun returns stdout and exit code from the service", async () => {
  const layer = Layer.succeed(CliRunService, async () => ({ exitCode: 0, stdout: '{"items":[]}' }));
  const result = await Effect.runPromise(
    cliRun("codex", ["cloud", "tasks", "list"], RUN_OPTIONS).pipe(Effect.provide(layer)),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"items":[]}');
});

test("cliRun maps unavailable CLI errors to CliRunFailure", async () => {
  const layer = Layer.succeed(CliRunService, async () => {
    throw new CliCommandError(CLI_FAILURE.UNAVAILABLE, "codex could not be run");
  });
  const exit = await Effect.runPromiseExit(
    cliRun("codex", ["login", "status"], RUN_OPTIONS).pipe(Effect.provide(layer)),
  );
  assert(Exit.isFailure(exit));
  const failure = Cause.failureOption(exit.cause);
  assert(failure._tag === "Some");
  const error = failure.value;
  assert(error instanceof CliRunFailure);
  assert.equal(error.failure, CLI_FAILURE.UNAVAILABLE);
});

test("fromCliCommandError preserves CliFailure semantics", () => {
  const mapped = fromCliCommandError(
    new CliCommandError(CLI_FAILURE.TRANSIENT, "codex could not be run"),
  );
  assert.equal(mapped.failure, CLI_FAILURE.TRANSIENT);
  assert.equal(mapped.message, "codex could not be run");
});
