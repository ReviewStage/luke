import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { removeRetiredStore } from "./retired-store.js";

it.effect(
  "a launch removes the retired store from the agent's directory under the state root and leaves the workspace beside it",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateRoot = yield* temporaryDirectoryScoped("luke-retired-store-");
      const agentRoot = path.join(stateRoot, "agents", "main");
      yield* fileSystem.makeDirectory(path.join(agentRoot, "archives"), { recursive: true });
      yield* fileSystem.makeDirectory(path.join(agentRoot, "workspace"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(agentRoot, "agent.sqlite"), "");
      yield* fileSystem.writeFileString(path.join(agentRoot, "agent.sqlite-wal"), "");
      const reports: string[] = [];

      yield* removeRetiredStore({ stateRoot, report: (message) => reports.push(message) });

      assert.deepEqual(yield* fileSystem.readDirectory(agentRoot), ["workspace"]);
      assert.deepEqual(reports, []);
    }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);
