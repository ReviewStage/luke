import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import { localAgentCodex, localCodexSignedIn } from "./local-agent-codex.js";

const NODE = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

/** A stand-in for Codex's app-server: it answers the read as the account given, once it has read the three lines. */
function fakeCodex(account: string): string {
  return [
    "#!/bin/sh",
    "read -r _ && read -r _ && read -r _",
    `printf '%s\\n' '{"id":2,"result":{"account":${account},"requiresOpenaiAuth":true}}'`,
  ].join("\n");
}

describe("localAgentCodex", () => {
  it.effect(
    "keeps nothing of an archive whose SHA-256 is not the pin's, and answers no binary",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const root = yield* temporaryDirectoryScoped("luke-codex-");

        const found = yield* localAgentCodex(root, undefined).pipe(
          Effect.provide(fakeHttpClientLayer(() => new Response("not the pinned archive"))),
        );

        assert.isTrue(Option.isNone(found));
        assert.deepStrictEqual(yield* fileSystem.readDirectory(root), []);
      }).pipe(Effect.provide(NODE)),
  );
});

describe("localCodexSignedIn", () => {
  it.effect("answers whether Codex's account/read names an account", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* temporaryDirectoryScoped("luke-codex-");
      const asked = (account: string) =>
        Effect.gen(function* () {
          const codex = `${root}/codex-${account.length}`;
          yield* fileSystem.writeFileString(codex, fakeCodex(account), { mode: 0o755 });
          return yield* localCodexSignedIn(codex, { PATH: "/usr/bin:/bin" });
        });

      assert.deepStrictEqual(
        yield* asked('{"type":"chatgpt","email":null,"planType":"plus"}'),
        Option.some(true),
      );
      assert.deepStrictEqual(yield* asked("null"), Option.some(false));
    }).pipe(Effect.provide(NODE)),
  );
});
