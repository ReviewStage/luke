import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect } from "effect";
import { accountStore } from "./token-store.js";

const ORIGIN = "https://preview.example.test";

const ACCOUNT = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  id: "user-1",
  email: "ada@example.test",
} as const;

/** The permission bits of a file or folder, as `ls -l` reads them. */
const modeOf = (file: string) =>
  Effect.promise(() => stat(file)).pipe(Effect.map((stats) => stats.mode & 0o777));

// Note that the regression this catches is a write that drops the mode, leaving a refresh token
// readable by every account on the machine.
it.effect("keeps the sign-in in a file only its owner can read, under XDG_CONFIG_HOME", () =>
  Effect.gen(function* () {
    const config = yield* temporaryDirectoryScoped("vespin-cli-");
    const store = yield* accountStore(ORIGIN, {
      platform: "linux",
      environment: { XDG_CONFIG_HOME: config, HOME: "/nowhere" },
    });
    yield* store.write(ACCOUNT);

    const file = path.join(config, "vespin", "credentials.json");
    assert.equal(yield* modeOf(file), 0o600);
    assert.equal(yield* modeOf(path.dirname(file)), 0o700);
    assert.deepEqual(yield* store.read, ACCOUNT);

    yield* store.clear;
    assert.equal(yield* store.read, undefined);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
