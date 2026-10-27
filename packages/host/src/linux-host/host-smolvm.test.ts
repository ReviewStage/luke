/**
 * host-smolvm.test.ts -- a host's daemon asking its `smolvm` for its version before it follows anything: the pinned release lets it start, and another release, a failed run, or a `smolvm` that is not there each give the line it refuses to start with, which names what was found and what to run.
 *
 * The `smolvm` is a scripted spawner, and nothing is run.
 */

import { describe, expect, it } from "@effect/vitest";
import { SMOLVM_LINUX_PIN } from "@luke/agent-runner/pins";
import { Effect, Option } from "effect";
import { type Script, scriptedSpawner } from "../testing/scripted-spawner.js";
import { hostSmolvmRefusal } from "./host-smolvm.js";

const SMOLVM = "/opt/luke-smolvm/smolvm";

/** What the daemon says of a `smolvm` that answers as the script given, or that is not there where none is. */
const refusalOf = (script: Script | undefined) => {
  const spawner = scriptedSpawner((program, args) =>
    program === SMOLVM && args.join(" ") === "--version" ? script : undefined,
  );
  return hostSmolvmRefusal(SMOLVM).pipe(Effect.provide(spawner.layer));
};

describe("a host's check of its smolvm", () => {
  it.effect("lets the daemon start on the pinned release", () =>
    Effect.gen(function* () {
      const refusal = yield* refusalOf({
        stdout: `smolvm ${SMOLVM_LINUX_PIN.VERSION}\n`,
        exitCode: 0,
      });
      expect(Option.isNone(refusal)).toBe(true);
    }),
  );

  for (const [name, script, found] of [
    ["another release", { stdout: "smolvm 1.32.2\n", exitCode: 0 }, 'answers "smolvm 1.32.2"'],
    ["a failed run", { stdout: "", exitCode: 1 }, "could not run"],
    ["no smolvm at the path", undefined, "could not run"],
  ] as const) {
    it.effect(`refuses to start on ${name}, saying what was found and what to run`, () =>
      Effect.gen(function* () {
        const refusal = yield* refusalOf(script);
        const line = Option.getOrThrow(refusal);
        expect(line).toContain(found);
        expect(line).toContain(SMOLVM);
        expect(line).toContain(SMOLVM_LINUX_PIN.VERSION);
        expect(line).toContain("install command again");
      }),
    );
  }
});
