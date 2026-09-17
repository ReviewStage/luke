import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { Effect, Layer, type Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { removeRetiredStore } from "./retired-store.js";

const withRoot = <A>(
  run: (root: string) => Effect.Effect<A, never, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.scoped(Effect.flatMap(temporaryDirectoryScoped("luke-retired-store-"), run)).pipe(
    Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
  );

it.effect(
  "a launch removes the retired database, its two SQLite companions, and the archives, and leaves the workspace beside them",
  () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const agentRoot = path.join(root, "agents", "main");
        fs.mkdirSync(path.join(agentRoot, "archives"), { recursive: true });
        fs.mkdirSync(path.join(agentRoot, "workspace"), { recursive: true });
        for (const name of ["agent.sqlite", "agent.sqlite-wal", "agent.sqlite-shm"]) {
          fs.writeFileSync(path.join(agentRoot, name), "old");
        }
        fs.writeFileSync(path.join(agentRoot, "archives", "main.jsonl.deleted.1.zst"), "old");
        fs.writeFileSync(path.join(agentRoot, "workspace", "USER.md"), "# USER.md\n");
        const reports: string[] = [];

        yield* removeRetiredStore({ agentRoot, report: (message) => reports.push(message) });

        assert.deepEqual(fs.readdirSync(agentRoot).sort(), ["workspace"]);
        assert.equal(
          fs.readFileSync(path.join(agentRoot, "workspace", "USER.md"), "utf8"),
          "# USER.md\n",
        );
        assert.equal(reports.length, 0);
      }),
    ),
);

it.effect(
  "an agent directory with nothing retired in it, or none at all, is nothing to do and nothing to report",
  () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const reports: string[] = [];
        yield* removeRetiredStore({
          agentRoot: path.join(root, "agents", "main"),
          report: (message) => reports.push(message),
        });
        assert.equal(reports.length, 0);
        const bare = path.join(root, "agents", "other");
        fs.mkdirSync(path.join(bare, "workspace"), { recursive: true });
        yield* removeRetiredStore({ agentRoot: bare, report: (message) => reports.push(message) });
        assert.deepEqual(fs.readdirSync(bare), ["workspace"]);
        assert.equal(reports.length, 0);
      }),
    ),
);

it.effect(
  "an entry that cannot be removed is reported by its path and left, and the others are still removed",
  () =>
    Effect.gen(function* () {
      const agentRoot = path.join("/state", "agents", "main");
      const removed: string[] = [];
      const reports: string[] = [];
      const busy = FileSystem.layerNoop({
        remove: (target) =>
          path.basename(target) === "agent.sqlite-wal"
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "Busy",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: target,
                  description: "EBUSY: resource busy",
                }),
              )
            : Effect.sync(() => {
                removed.push(target);
              }),
      });

      yield* removeRetiredStore({ agentRoot, report: (message) => reports.push(message) }).pipe(
        Effect.provide(Layer.merge(busy, NodePath.layer)),
      );

      assert.deepEqual(removed, [
        path.join(agentRoot, "agent.sqlite"),
        path.join(agentRoot, "agent.sqlite-shm"),
        path.join(agentRoot, "archives"),
      ]);
      assert.equal(reports.length, 1);
      assert.ok(
        reports[0]?.startsWith(
          `The retired conversation store could not be removed at ${path.join(agentRoot, "agent.sqlite-wal")}: `,
        ),
      );
      assert.ok(reports[0]?.includes("EBUSY: resource busy"));
    }),
);
