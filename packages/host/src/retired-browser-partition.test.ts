import assert from "node:assert/strict";
import fs from "node:fs";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  clearRetiredBrowserPartition,
  type RetiredBrowserPartition,
} from "./retired-browser-partition.js";

/**
 * The retired local Browser tab's data cleared once on the first launch
 * after it went: Electron's partition faked at the process boundary as
 * Electron behaves, opening it making its directory and each clear emptying
 * what it names, over a real file system in a directory the test made.
 */

/** Electron's `persist:browser` partition under `stateRoot`, as a launch opens it. */
function electronPartition(stateRoot: string, options: { failing?: boolean } = {}) {
  const directory = `${stateRoot}/Partitions/browser`;
  let opened = 0;
  const open = (): RetiredBrowserPartition => {
    opened += 1;
    // Opening a persistent partition makes its directory, as Electron does.
    fs.mkdirSync(directory, { recursive: true });
    return {
      clearStorageData: async () => {
        if (options.failing === true) throw new Error("the session refused");
        fs.rmSync(`${directory}/Cookies`, { force: true });
      },
      clearCache: async () => fs.rmSync(`${directory}/Cache`, { recursive: true, force: true }),
    };
  };
  return { directory, open, opened: () => opened };
}

/** The partition the retired tab left: its cookie jar and its cache. */
const leftBehind = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(`${directory}/Cache`, { recursive: true });
    yield* fileSystem.writeFileString(`${directory}/Cookies`, "session=signed-in");
  });

it.effect(
  "the first launch clears the retired tab's cookies and cache, and a later launch leaves the partition be",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stateRoot = yield* temporaryDirectoryScoped("luke-retired-browser-");
      const partition = electronPartition(stateRoot);
      yield* leftBehind(partition.directory);
      const reports: string[] = [];
      const launch = clearRetiredBrowserPartition({
        stateRoot,
        openPartition: partition.open,
        report: (message) => reports.push(message),
      });

      yield* launch;
      assert.deepEqual(yield* fileSystem.readDirectory(partition.directory), []);

      // A page left there since would be the next build's, so the next launch touches nothing.
      yield* leftBehind(partition.directory);
      yield* launch;
      assert.deepEqual((yield* fileSystem.readDirectory(partition.directory)).sort(), [
        "Cache",
        "Cookies",
      ]);
      assert.equal(partition.opened(), 1);
      assert.deepEqual(reports, []);
    }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);

it.effect("a Mac that never opened the Browser tab is never given its partition", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateRoot = yield* temporaryDirectoryScoped("luke-retired-browser-");
    const partition = electronPartition(stateRoot);
    const launch = clearRetiredBrowserPartition({
      stateRoot,
      openPartition: partition.open,
      report: () => undefined,
    });

    yield* launch;
    yield* launch;

    assert.equal(yield* fileSystem.exists(path.join(stateRoot, "Partitions")), false);
  }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);

it.effect("a clear that fails is reported, and the next launch clears it", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateRoot = yield* temporaryDirectoryScoped("luke-retired-browser-");
    const failing = electronPartition(stateRoot, { failing: true });
    yield* leftBehind(failing.directory);
    const reports: string[] = [];

    yield* clearRetiredBrowserPartition({
      stateRoot,
      openPartition: failing.open,
      report: (message) => reports.push(message),
    });
    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? "", /could not be cleared/u);
    assert.ok(yield* fileSystem.exists(`${failing.directory}/Cookies`));

    yield* clearRetiredBrowserPartition({
      stateRoot,
      openPartition: electronPartition(stateRoot).open,
      report: (message) => reports.push(message),
    });
    assert.deepEqual(yield* fileSystem.readDirectory(failing.directory), []);
    assert.equal(reports.length, 1);
  }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);
