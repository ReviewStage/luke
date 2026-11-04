/**
 * local-agent-box.test.ts -- an agent's folders as a host makes them on a real temporary folder: settings it wrote itself are kept.
 */
import { NodeFileSystem } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import { agentFoldersMade } from "./local-agent-box.js";

/** What an agent wrote into its own `.npmrc`, a registry of its project's. */
const OWN_NPMRC = "registry=https://npm.example.test/\n";

describe("an agent's folders made on the box", () => {
  it.effect("keep the .npmrc the agent wrote", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* temporaryDirectoryScoped("agent-box-");
      const home = `${root}/agent/home`;
      yield* fileSystem.makeDirectory(home, { recursive: true });
      yield* fileSystem.writeFileString(`${home}/.npmrc`, OWN_NPMRC);

      yield* agentFoldersMade(`${root}/agent`, {
        stateRoot: `${root}/state`,
        platform: DEVICE_PLATFORM.LINUX,
      });

      expect(yield* fileSystem.readFileString(`${home}/.npmrc`)).toBe(OWN_NPMRC);
    }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer)),
  );
});
