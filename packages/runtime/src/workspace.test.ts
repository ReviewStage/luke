import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LUKE_PERSONA } from "@sidecar/guide";
import {
  BOOTSTRAP_FILE_ORDER,
  boundBootstrapFiles,
  dailyNoteName,
  readBootstrapFiles,
  readWorkspaceFile,
  recentDailyNotes,
  seedWorkspace,
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
  workspaceFilePath,
  writeWorkspaceFile,
} from "./workspace.js";

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "luke-workspace-"));
}

const NOW = Date.UTC(2026, 8, 8, 12);

test("seeding writes every missing file once and never overwrites an edit or a later build's absence", async () => {
  const directory = await temporaryDirectory();
  const first = await seedWorkspace(directory);
  assert.deepEqual([...first.seeded].sort(), Object.values(WORKSPACE_FILE).sort());
  const soul = await fs.readFile(path.join(directory, WORKSPACE_FILE.SOUL), "utf8");
  assert.ok(soul.includes(LUKE_PERSONA));

  await fs.writeFile(path.join(directory, WORKSPACE_FILE.SOUL), "# SOUL.md\n\nMy own Luke.\n");
  await fs.rm(path.join(directory, WORKSPACE_FILE.BOOTSTRAP));
  const second = await seedWorkspace(directory);
  assert.deepEqual(second.seeded, [WORKSPACE_FILE.BOOTSTRAP]);
  assert.equal(
    await fs.readFile(path.join(directory, WORKSPACE_FILE.SOUL), "utf8"),
    "# SOUL.md\n\nMy own Luke.\n",
  );
  const third = await seedWorkspace(directory);
  assert.deepEqual(third.seeded, []);
});

test("bootstrap files are bounded per file and in total, in order, with what the bounds did recorded", () => {
  const files = boundBootstrapFiles(
    [
      { name: WORKSPACE_FILE.AGENTS, path: "a", content: "a".repeat(30) },
      { name: WORKSPACE_FILE.SOUL, path: "s", content: "s".repeat(10) },
      { name: WORKSPACE_FILE.IDENTITY, path: "i", content: undefined },
      { name: WORKSPACE_FILE.USER, path: "u", content: "u".repeat(20) },
      { name: WORKSPACE_FILE.MEMORY, path: "m", content: "m".repeat(5) },
    ],
    { maximumCharsPerFile: 20, maximumTotalChars: 35 },
  );
  assert.deepEqual(
    files.map((file) => [file.name, file.content.length, file.truncated, file.missing]),
    [
      [WORKSPACE_FILE.AGENTS, 20, true, false],
      [WORKSPACE_FILE.SOUL, 10, false, false],
      [WORKSPACE_FILE.IDENTITY, 0, false, true],
      [WORKSPACE_FILE.USER, 5, true, false],
      [WORKSPACE_FILE.MEMORY, 0, true, false],
    ],
  );
  assert.equal(files[0]?.originalChars, 30);
  assert.equal(files[3]?.originalChars, 20);
});

test("reading a seeded workspace answers the files in bootstrap order, the absent one marked missing", async () => {
  const directory = await temporaryDirectory();
  await seedWorkspace(directory);
  await fs.rm(path.join(directory, WORKSPACE_FILE.BOOTSTRAP));
  const files = await readBootstrapFiles(directory);
  assert.deepEqual(
    files.map((file) => file.name),
    [...BOOTSTRAP_FILE_ORDER],
  );
  assert.ok(files.every((file) => file.name === WORKSPACE_FILE.BOOTSTRAP || !file.missing));
  assert.ok(files.find((file) => file.name === WORKSPACE_FILE.BOOTSTRAP)?.missing);
});

test("the workspace tools reach the workspace and nothing else", async () => {
  const directory = await temporaryDirectory();
  await seedWorkspace(directory);
  assert.equal(workspaceFilePath(directory, "../settings.json"), undefined);
  assert.equal(workspaceFilePath(directory, "memory/../SOUL.md"), undefined);
  assert.equal(workspaceFilePath(directory, "memory/notes.md"), undefined);
  assert.equal(workspaceFilePath(directory, "/etc/passwd"), undefined);
  assert.equal(
    workspaceFilePath(directory, `memory/${dailyNoteName(NOW)}`),
    path.join(directory, "memory", "2026-09-08.md"),
  );
  assert.equal(
    workspaceFilePath(directory, "memory/2026-09-08-standup.md"),
    path.join(directory, "memory", "2026-09-08-standup.md"),
  );

  const outside = await readWorkspaceFile(directory, "../settings.json");
  assert.deepEqual(outside, { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE });
  const tooLarge = await writeWorkspaceFile(directory, WORKSPACE_FILE.MEMORY, "x".repeat(21_000));
  assert.deepEqual(tooLarge, { ok: false, reason: WORKSPACE_FILE_REFUSAL.TOO_LARGE });
  const written = await writeWorkspaceFile(
    directory,
    WORKSPACE_FILE.MEMORY,
    "# MEMORY.md\n\n- one\n",
  );
  assert.deepEqual(written, { ok: true, chars: 19 });
  const read = await readWorkspaceFile(directory, WORKSPACE_FILE.MEMORY);
  assert.deepEqual(read, { ok: true, content: "# MEMORY.md\n\n- one\n" });
  const missing = await readWorkspaceFile(directory, "memory/2020-01-01.md");
  assert.deepEqual(missing, { ok: false, reason: WORKSPACE_FILE_REFUSAL.NOT_FOUND });
});

test("recent daily notes are today's and yesterday's alone, slugged variants included", async () => {
  const directory = await temporaryDirectory();
  await seedWorkspace(directory);
  for (const [name, content] of [
    ["2026-09-08.md", "today"],
    ["2026-09-08-standup.md", "standup"],
    ["2026-09-07.md", "yesterday"],
    ["2026-09-01.md", "old"],
    ["notes.md", "not a note"],
  ]) {
    await fs.writeFile(path.join(directory, "memory", name ?? ""), content ?? "");
  }
  const notes = await recentDailyNotes(directory, NOW);
  assert.deepEqual(
    notes.map((note) => [note.name, note.content]),
    [
      ["2026-09-07.md", "yesterday"],
      ["2026-09-08-standup.md", "standup"],
      ["2026-09-08.md", "today"],
    ],
  );
});
