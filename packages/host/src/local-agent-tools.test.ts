import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { MacToolPin } from "@luke/agent-runner/pins";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { localAgentTool } from "./local-agent-tools.js";

const NODE = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** A release of the test's own: `tool-1.0/bin/tool` and a file beside it no member names, gzipped, pinned by its own size and digest, signed by no team. */
const release = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const scratch = yield* temporaryDirectoryScoped("luke-tool-release-");
  yield* fileSystem.makeDirectory(`${scratch}/tool-1.0/bin`, { recursive: true });
  yield* fileSystem.writeFileString(`${scratch}/tool-1.0/bin/tool`, "#!/bin/sh\necho tool\n", {
    mode: 0o755,
  });
  yield* fileSystem.writeFileString(`${scratch}/tool-1.0/unpinned.txt`, "left in the archive");
  execFileSync("tar", ["-czf", `${scratch}/tool.tgz`, "-C", scratch, "tool-1.0"]);
  const archive = readFileSync(`${scratch}/tool.tgz`);
  const pin: MacToolPin = {
    NAME: "tool",
    VERSION: "1.0",
    ARCHIVE: "https://releases.test/tool-1.0.tgz",
    SHA256: createHash("sha256").update(archive).digest("hex"),
    BYTES: archive.length,
    ROOT: "tool-1.0",
    MEMBERS: ["bin/tool"],
    BINARY: "bin/tool",
  };
  return { archive, pin };
});

describe("localAgentTool", () => {
  it.effect(
    "keeps the pinned members of an archive that matches its pin, and answers the kept build after without fetching again",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* temporaryDirectoryScoped("luke-tools-");
        const { archive, pin } = yield* release;

        const fetched = yield* localAgentTool(root, pin, undefined).pipe(
          Effect.provide(fakeHttpClientLayer(() => new Response(archive))),
        );
        const again = yield* localAgentTool(root, pin, undefined).pipe(
          Effect.provide(fakeHttpClientLayer(() => new Response("never asked", { status: 500 }))),
        );

        const kept = `${root}/agent-tools/tool/1.0`;
        assert.deepStrictEqual(fetched, Option.some(`${kept}/bin/tool`));
        assert.deepStrictEqual(again, fetched);
        assert.strictEqual(
          yield* fileSystem.readFileString(`${kept}/bin/tool`),
          "#!/bin/sh\necho tool\n",
        );
        assert.isFalse(yield* fileSystem.exists(`${kept}/unpinned.txt`));
      }).pipe(Effect.scoped, Effect.provide(NODE)),
  );

  it.effect(
    "keeps nothing of an archive whose SHA-256 is not the pin's, and answers no binary",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* temporaryDirectoryScoped("luke-tools-");
        const { archive, pin } = yield* release;
        const tampered = Uint8Array.from(archive);
        tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;

        const found = yield* localAgentTool(root, pin, undefined).pipe(
          Effect.provide(fakeHttpClientLayer(() => new Response(tampered))),
        );

        assert.isTrue(Option.isNone(found));
        assert.deepStrictEqual(yield* fileSystem.readDirectory(root), []);
      }).pipe(Effect.scoped, Effect.provide(NODE)),
  );
});
