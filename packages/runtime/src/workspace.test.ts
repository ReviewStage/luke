import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  appendedDailyNote,
  BOOTSTRAP_BOUNDS,
  BOOTSTRAP_FILE_ORDER,
  boundBootstrapFiles,
  CURATED_FILE_BUDGET,
  dailyNoteName,
  dailyNotePath,
  isDailyNotePath,
  readBootstrapFiles,
  readWorkspaceFile,
  recentDailyNotes,
  seedWorkspace,
  tooLargeRefusal,
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
  type WorkspaceFile,
  type WorkspaceSeeds,
  workspaceFileBound,
  workspaceFilePath,
  writeWorkspaceFile,
} from "./workspace.js";

/** Seeds for these tests alone: the runtime knows the files, never their words. */
const testSeed = (name: WorkspaceFile) => `# ${name}\n\nseeded for the test\n`;
const TEST_SEEDS: WorkspaceSeeds = {
  [WORKSPACE_FILE.AGENTS]: testSeed(WORKSPACE_FILE.AGENTS),
  [WORKSPACE_FILE.IDENTITY]: testSeed(WORKSPACE_FILE.IDENTITY),
  [WORKSPACE_FILE.USER]: testSeed(WORKSPACE_FILE.USER),
  [WORKSPACE_FILE.MEMORY]: testSeed(WORKSPACE_FILE.MEMORY),
  [WORKSPACE_FILE.BOOTSTRAP]: testSeed(WORKSPACE_FILE.BOOTSTRAP),
};

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "luke-workspace-"));
}

const NOW = Date.UTC(2026, 8, 8, 12);

test("seeding writes every missing file once and never overwrites an edit or a later build's absence", async () => {
  const directory = await temporaryDirectory();
  const first = await seedWorkspace(directory, TEST_SEEDS);
  assert.deepEqual([...first.seeded].sort(), Object.values(WORKSPACE_FILE).sort());
  const agents = await fs.readFile(path.join(directory, WORKSPACE_FILE.AGENTS), "utf8");
  assert.equal(agents, TEST_SEEDS[WORKSPACE_FILE.AGENTS]);

  await fs.writeFile(path.join(directory, WORKSPACE_FILE.AGENTS), "# AGENTS.md\n\nMy own Luke.\n");
  await fs.rm(path.join(directory, WORKSPACE_FILE.BOOTSTRAP));
  const second = await seedWorkspace(directory, TEST_SEEDS);
  assert.deepEqual(second.seeded, [WORKSPACE_FILE.BOOTSTRAP]);
  assert.equal(
    await fs.readFile(path.join(directory, WORKSPACE_FILE.AGENTS), "utf8"),
    "# AGENTS.md\n\nMy own Luke.\n",
  );
  const third = await seedWorkspace(directory, TEST_SEEDS);
  assert.deepEqual(third.seeded, []);
});

test("each file's own bound is the curated budget for USER.md and MEMORY.md and the per-file bound for the rest", () => {
  assert.equal(workspaceFileBound(WORKSPACE_FILE.USER), CURATED_FILE_BUDGET[WORKSPACE_FILE.USER]);
  assert.equal(
    workspaceFileBound(WORKSPACE_FILE.MEMORY),
    CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY],
  );
  assert.equal(CURATED_FILE_BUDGET[WORKSPACE_FILE.USER], 4_000);
  assert.equal(CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY], 4_000);
  for (const name of [
    WORKSPACE_FILE.AGENTS,
    WORKSPACE_FILE.IDENTITY,
    WORKSPACE_FILE.BOOTSTRAP,
    `memory/${dailyNoteName(NOW)}`,
  ]) {
    assert.equal(workspaceFileBound(name), BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE);
  }
});

test("bootstrap files are bounded per file and in total, in order, with what the bounds did recorded", () => {
  const perFile = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
  const files = boundBootstrapFiles([
    { name: WORKSPACE_FILE.AGENTS, path: "a", content: "a".repeat(perFile + 10_000) },
    { name: WORKSPACE_FILE.IDENTITY, path: "i", content: "i".repeat(10_000) },
    { name: WORKSPACE_FILE.BOOTSTRAP, path: "b", content: undefined },
    { name: WORKSPACE_FILE.USER, path: "u", content: "u".repeat(perFile) },
    { name: WORKSPACE_FILE.MEMORY, path: "m", content: "m".repeat(15_000) },
  ]);
  assert.deepEqual(
    files.map((file) => [file.name, file.content.length, file.truncated, file.missing]),
    [
      [WORKSPACE_FILE.AGENTS, perFile, true, false],
      [WORKSPACE_FILE.IDENTITY, 10_000, false, false],
      [WORKSPACE_FILE.BOOTSTRAP, 0, false, true],
      [WORKSPACE_FILE.USER, CURATED_FILE_BUDGET[WORKSPACE_FILE.USER], true, false],
      [WORKSPACE_FILE.MEMORY, CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY], true, false],
    ],
  );
  assert.equal(files[0]?.originalChars, perFile + 10_000);
  assert.equal(files[3]?.originalChars, perFile);
  assert.equal(files[4]?.originalChars, 15_000);
});

test("the running total still cuts a curated file below its own budget, and one within both bounds is uncut", () => {
  const perFile = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
  const budget = CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY];
  const leftForMemory = BOOTSTRAP_BOUNDS.MAXIMUM_TOTAL_CHARS - perFile - perFile - perFile + 1_000;
  assert.ok(leftForMemory < budget);
  const files = boundBootstrapFiles([
    { name: WORKSPACE_FILE.AGENTS, path: "a", content: "a".repeat(perFile) },
    { name: WORKSPACE_FILE.IDENTITY, path: "i", content: "i".repeat(perFile) },
    { name: WORKSPACE_FILE.USER, path: "u", content: "u".repeat(budget) },
    { name: WORKSPACE_FILE.BOOTSTRAP, path: "b", content: "b".repeat(perFile - budget - 1_000) },
    { name: WORKSPACE_FILE.MEMORY, path: "m", content: "m".repeat(budget) },
  ]);
  assert.deepEqual(
    files.map((file) => [file.name, file.content.length, file.truncated]),
    [
      [WORKSPACE_FILE.AGENTS, perFile, false],
      [WORKSPACE_FILE.IDENTITY, perFile, false],
      [WORKSPACE_FILE.USER, budget, false],
      [WORKSPACE_FILE.BOOTSTRAP, perFile - budget - 1_000, false],
      [WORKSPACE_FILE.MEMORY, leftForMemory, true],
    ],
  );
  assert.equal(files[4]?.originalChars, budget);
});

test("reading a seeded workspace answers the files in bootstrap order, the absent one marked missing", async () => {
  const directory = await temporaryDirectory();
  await seedWorkspace(directory, TEST_SEEDS);
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
  await seedWorkspace(directory, TEST_SEEDS);
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
  const tooLarge = await writeWorkspaceFile(directory, WORKSPACE_FILE.AGENTS, "x".repeat(21_000));
  assert.deepEqual(tooLarge, {
    ok: false,
    reason: tooLargeRefusal(BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE),
  });
  assert.match(tooLarge.ok ? "" : tooLarge.reason, /20000 characters/u);
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

test("a curated file is refused past its own budget, never cut, and read back at that budget", async () => {
  const directory = await temporaryDirectory();
  await seedWorkspace(directory, TEST_SEEDS);
  const budget = CURATED_FILE_BUDGET[WORKSPACE_FILE.USER];
  const before = await fs.readFile(path.join(directory, WORKSPACE_FILE.USER), "utf8");

  const refused = await writeWorkspaceFile(directory, WORKSPACE_FILE.USER, "u".repeat(budget + 1));
  assert.deepEqual(refused, { ok: false, reason: tooLargeRefusal(budget) });
  assert.match(refused.ok ? "" : refused.reason, /4000 characters/u);
  assert.equal(await fs.readFile(path.join(directory, WORKSPACE_FILE.USER), "utf8"), before);

  const written = await writeWorkspaceFile(directory, WORKSPACE_FILE.USER, "u".repeat(budget));
  assert.deepEqual(written, { ok: true, chars: budget });
  const agents = await writeWorkspaceFile(directory, WORKSPACE_FILE.AGENTS, "a".repeat(budget + 1));
  assert.deepEqual(agents, { ok: true, chars: budget + 1 });

  await fs.writeFile(path.join(directory, WORKSPACE_FILE.MEMORY), "m".repeat(budget + 500));
  const read = await readWorkspaceFile(directory, WORKSPACE_FILE.MEMORY);
  assert.deepEqual(read, { ok: true, content: "m".repeat(budget) });
  const wide = await readWorkspaceFile(directory, WORKSPACE_FILE.AGENTS);
  assert.deepEqual(wide, { ok: true, content: "a".repeat(budget + 1) });
});

test("today's note is named by the instant's UTC day, a dated note is told from every other name, and an appended entry lands after a blank line", () => {
  assert.equal(dailyNotePath(NOW), "memory/2026-09-08.md");
  // A minute before midnight UTC is still the day's note; the next minute is the next day's.
  assert.equal(dailyNotePath(Date.UTC(2026, 8, 8, 23, 59)), "memory/2026-09-08.md");
  assert.equal(dailyNotePath(Date.UTC(2026, 8, 9, 0, 0)), "memory/2026-09-09.md");
  assert.equal(isDailyNotePath("memory/2026-09-08.md"), true);
  assert.equal(isDailyNotePath("memory/2026-09-08-standup.md"), true);
  assert.equal(isDailyNotePath(WORKSPACE_FILE.MEMORY), false);
  assert.equal(isDailyNotePath("memory/notes.md"), false);
  assert.equal(isDailyNotePath("2026-09-08.md"), false);
  assert.equal(isDailyNotePath("memory/../MEMORY.md"), false);

  assert.equal(appendedDailyNote(undefined, "- one"), "- one");
  assert.equal(appendedDailyNote("", "- one"), "- one");
  assert.equal(appendedDailyNote("  \n\n", "- one"), "- one");
  assert.equal(appendedDailyNote("- one", "- two"), "- one\n\n- two");
  assert.equal(appendedDailyNote("- one\n", "- two"), "- one\n\n- two");
  assert.equal(appendedDailyNote("- one\n\n\n", "- two"), "- one\n\n- two");
  // What stood is kept to the character: only the trailing whitespace goes.
  assert.equal(appendedDailyNote("# Day\n\n- one", "- two"), "# Day\n\n- one\n\n- two");
});

test("recent daily notes are today's and yesterday's alone, slugged variants included", async () => {
  const directory = await temporaryDirectory();
  await seedWorkspace(directory, TEST_SEEDS);
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
