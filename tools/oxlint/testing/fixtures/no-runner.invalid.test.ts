import { Effect, ManagedRuntime } from "effect";
import { expect, it } from "vitest";

it("runs the effect itself", async () => {
  expect(await Effect.runPromise(Effect.succeed(1))).toBe(1);
  expect(Effect.runSync(Effect.succeed(2))).toBe(2);
  const runtime = ManagedRuntime.make(Effect.succeed(undefined));
  expect(runtime).toBeDefined();
});
