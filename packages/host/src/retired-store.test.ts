import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { test } from "vitest";
import { RETIRED_STORE_ENTRIES, removeRetiredStore } from "./retired-store.js";

const removeFromDisk = (target: string) => fs.promises.rm(target, { recursive: true, force: true });

test("a launch removes the retired database, its two SQLite companions, and the archives, and leaves the workspace beside them", async (t) => {
  const root = await temporaryDirectory(t, "luke-retired-store-");
  const agentRoot = path.join(root, "agents", "main");
  fs.mkdirSync(path.join(agentRoot, "archives"), { recursive: true });
  fs.mkdirSync(path.join(agentRoot, "workspace"), { recursive: true });
  for (const name of ["agent.sqlite", "agent.sqlite-wal", "agent.sqlite-shm"]) {
    fs.writeFileSync(path.join(agentRoot, name), "old");
  }
  fs.writeFileSync(path.join(agentRoot, "archives", "main.jsonl.deleted.1.zst"), "old");
  fs.writeFileSync(path.join(agentRoot, "workspace", "USER.md"), "# USER.md\n");
  const reports: string[] = [];

  await removeRetiredStore({
    agentRoot,
    remove: removeFromDisk,
    report: (message) => reports.push(message),
  });

  assert.deepEqual(fs.readdirSync(agentRoot).sort(), ["workspace"]);
  assert.equal(
    fs.readFileSync(path.join(agentRoot, "workspace", "USER.md"), "utf8"),
    "# USER.md\n",
  );
  assert.equal(reports.length, 0);
  assert.deepEqual(RETIRED_STORE_ENTRIES, [
    "agent.sqlite",
    "agent.sqlite-wal",
    "agent.sqlite-shm",
    "archives",
  ]);
});

test("an agent directory with nothing retired in it, or none at all, is nothing to do and nothing to report", async (t) => {
  const root = await temporaryDirectory(t, "luke-retired-store-");
  const reports: string[] = [];
  await removeRetiredStore({
    agentRoot: path.join(root, "agents", "main"),
    remove: removeFromDisk,
    report: (message) => reports.push(message),
  });
  assert.equal(reports.length, 0);
  const bare = path.join(root, "agents", "other");
  fs.mkdirSync(path.join(bare, "workspace"), { recursive: true });
  await removeRetiredStore({
    agentRoot: bare,
    remove: removeFromDisk,
    report: (message) => reports.push(message),
  });
  assert.deepEqual(fs.readdirSync(bare), ["workspace"]);
  assert.equal(reports.length, 0);
});

test("an entry that cannot be removed is reported by its path and left, and the others are still removed", async () => {
  const agentRoot = path.join("/state", "agents", "main");
  const removed: string[] = [];
  const reports: string[] = [];

  await removeRetiredStore({
    agentRoot,
    remove: async (target) => {
      if (path.basename(target) === "agent.sqlite-wal") throw new Error("EBUSY: resource busy");
      removed.push(target);
    },
    report: (message) => reports.push(message),
  });

  assert.deepEqual(removed, [
    path.join(agentRoot, "agent.sqlite"),
    path.join(agentRoot, "agent.sqlite-shm"),
    path.join(agentRoot, "archives"),
  ]);
  assert.deepEqual(reports, [
    `The retired conversation store could not be removed at ${path.join(agentRoot, "agent.sqlite-wal")}: EBUSY: resource busy`,
  ]);
});
