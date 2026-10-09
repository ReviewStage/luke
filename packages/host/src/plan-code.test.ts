import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { CODE_UNREADABLE, type PlanCode } from "@sidecar/hosted/planning-view";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { Effect, FileSystem, Layer } from "effect";
import { PLAN_CODE, planCode } from "./plan-code.js";

const nodeFiles = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/** A plan folder holding `files`, by path relative to it. */
function folderWith(files: Readonly<Record<string, string>>) {
  return Effect.gen(function* () {
    const folder = yield* temporaryDirectoryScoped("luke-plan-code-");
    const fs = yield* FileSystem.FileSystem;
    for (const [path, text] of Object.entries(files)) {
      const at = `${folder}/${path}`;
      yield* Effect.orDie(fs.makeDirectory(at.slice(0, at.lastIndexOf("/")), { recursive: true }));
      yield* Effect.orDie(fs.writeFileString(at, text));
    }
    return folder;
  });
}

/** The drawn lines as the text they read, run by run. */
function textOf(code: PlanCode): string[] {
  return (code.lines ?? []).map((line) => line.map((token) => token.text).join(""));
}

const INVITE = [
  'import { db } from "./db.js";',
  "",
  "export async function acceptInvite(token: string) {",
  "  const invite = await db.invites.find(token);",
  "  return invite;",
  "}",
].join("\n");

it.effect(
  "a file of the plan's folder is drawn whole, coloured, with the lines pointed at kept",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const folder = yield* folderWith({ "src/invite.ts": INVITE });
        const ref = { path: "src/invite.ts", startLine: 3, endLine: 4 };

        const code = yield* planCode(folder, ref);

        assert.equal(code.unreadable, undefined);
        assert.deepEqual(code.ref, ref);
        assert.equal(code.firstLine, 1);
        assert.equal(code.lineCount, 6);
        assert.deepEqual(textOf(code), INVITE.split("\n"));
        const keyword = code.lines?.[2]?.find((token) => token.text.includes("export"));
        assert.ok(keyword?.color, "a keyword is drawn in a colour of its own");
        assert.ok(keyword.lightColor, "and in a colour of its own in the light appearance");
        assert.notEqual(keyword.lightColor, keyword.color);
      }),
    ).pipe(Effect.provide(nodeFiles)),
);

it.effect("a long file is drawn as a window around the lines pointed at", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index + 1}`);
      const folder = yield* folderWith({ "notes.txt": lines.join("\n") });

      const code = yield* planCode(folder, { path: "notes.txt", startLine: 1_000, endLine: 1_001 });

      const drawn = textOf(code);
      assert.equal(drawn.length, PLAN_CODE.WINDOW_LINES);
      assert.equal(code.lineCount, 2_000);
      const first = code.firstLine ?? 0;
      assert.equal(drawn[0], `line ${first}`);
      assert.ok(first < 1_000 && first + PLAN_CODE.WINDOW_LINES - 1 > 1_001);
    }),
  ).pipe(Effect.provide(nodeFiles)),
);

it.effect("a path that leaves the folder, through `..` or a link, draws nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const outside = yield* folderWith({ "secret.txt": "hunter2" });
      const folder = yield* folderWith({ "src/invite.ts": INVITE });
      const fs = yield* FileSystem.FileSystem;
      yield* Effect.orDie(fs.symlink(`${outside}/secret.txt`, `${folder}/linked.txt`));

      for (const path of [
        `../${outside.split("/").at(-1)}/secret.txt`,
        "linked.txt",
        `${outside}/secret.txt`,
      ]) {
        const code = yield* planCode(folder, { path });
        assert.equal(code.unreadable, CODE_UNREADABLE.REFUSED, path);
        assert.equal(code.lines, undefined);
      }
    }),
  ).pipe(Effect.provide(nodeFiles)),
);

it.effect("a .env file is never drawn, wherever it sits", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const folder = yield* folderWith({
        ".env": "KEY=sk_live_x",
        "app/.env.local": "KEY=sk_live_y",
      });

      for (const path of [".env", "app/.env.local"]) {
        const code = yield* planCode(folder, { path });
        assert.equal(code.unreadable, CODE_UNREADABLE.REFUSED, path);
      }
    }),
  ).pipe(Effect.provide(nodeFiles)),
);

it.effect("a file that is missing, binary, or too large says so, and no folder says that", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const folder = yield* folderWith({
        "image.bin": "PNG\u0000\u0001",
        "big.txt": "x".repeat(PLAN_CODE.MAX_FILE_BYTES + 1),
      });

      const unreadable = (path: string, at: string | undefined) =>
        Effect.map(planCode(at, { path }), (code) => code.unreadable);

      assert.equal(yield* unreadable("gone.ts", folder), CODE_UNREADABLE.MISSING);
      assert.equal(yield* unreadable("image.bin", folder), CODE_UNREADABLE.TOO_LARGE);
      assert.equal(yield* unreadable("big.txt", folder), CODE_UNREADABLE.TOO_LARGE);
      assert.equal(yield* unreadable("gone.ts", undefined), CODE_UNREADABLE.NO_FOLDER);
    }),
  ).pipe(Effect.provide(nodeFiles)),
);
