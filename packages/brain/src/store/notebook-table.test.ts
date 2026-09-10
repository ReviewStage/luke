import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MEMORY_ORIGIN, parseNotebook } from "@sidecar/memory";
import { WORKSPACE_FILE } from "@sidecar/runtime";
import {
  forgetNotebookEntry,
  listNotebookEntries,
  migrateFactsIntoNotebook,
  NOTEBOOK_REFUSAL,
  rememberNotebookEntry,
} from "./notebook-table.js";
import { NOW, openTestDatabase } from "./testing.js";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-notebook-"));
}

function userFile(root: string): string {
  return fs.readFileSync(path.join(root, WORKSPACE_FILE.USER), "utf8");
}

test("remember writes a line under the heading and an entry beside it; forget removes both", () => {
  const database = openTestDatabase();
  const root = workspace();
  assert.deepEqual(listNotebookEntries(database, root, NOW), []);
  const first = rememberNotebookEntry(database, root, { id: "e1", words: "prefers  tabs " }, NOW);
  assert.equal(first.ok, true);
  assert.deepEqual(
    first.entries.map((entry) => [entry.id, entry.words, entry.origin]),
    [["e1", "prefers tabs", MEMORY_ORIGIN.AGENT]],
  );

  const duplicate = rememberNotebookEntry(database, root, { id: "e2", words: "prefers tabs" }, NOW);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.entries.length, 1, "the same words add nothing");

  const replaced = rememberNotebookEntry(
    database,
    root,
    { id: "e3", words: "prefers spaces", replaces: "e1" },
    NOW + 1,
  );
  assert.deepEqual(
    replaced.entries.map((entry) => entry.words),
    ["prefers spaces"],
  );
  assert.equal(parseNotebook(userFile(root)).entries.length, 1);

  const unknown = rememberNotebookEntry(
    database,
    root,
    { id: "e4", words: "x", replaces: "nope" },
    NOW,
  );
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, NOTEBOOK_REFUSAL.UNKNOWN_ID);
  assert.equal(
    rememberNotebookEntry(database, root, { id: "e5", words: "   " }, NOW).reason,
    NOTEBOOK_REFUSAL.EMPTY,
  );

  const forgotten = forgetNotebookEntry(database, root, "e3", NOW + 2);
  assert.equal(forgotten.ok, true);
  assert.deepEqual(forgotten.entries, []);
  assert.equal(parseNotebook(userFile(root)).entries.length, 0);
  assert.equal(forgetNotebookEntry(database, root, "e3", NOW).ok, false);
});

test("a file write that fails rolls the rows back and leaves the file as it was", () => {
  const database = openTestDatabase();
  const root = workspace();
  rememberNotebookEntry(database, root, { id: "e1", words: "likes espresso" }, NOW);
  const before = userFile(root);
  fs.mkdirSync(`${path.join(root, WORKSPACE_FILE.USER)}.${process.pid}.tmp`);
  assert.throws(() => rememberNotebookEntry(database, root, { id: "e2", words: "new" }, NOW + 1));
  assert.throws(() => forgetNotebookEntry(database, root, "e1", NOW + 2));
  assert.equal(userFile(root), before);
  assert.deepEqual(
    listNotebookEntries(database, root, NOW + 3).map((entry) => entry.id),
    ["e1"],
  );
});

test("the list is bounded at 32 unless an entry is replaced", () => {
  const database = openTestDatabase();
  const root = workspace();
  for (let i = 0; i < 32; i += 1) {
    assert.equal(
      rememberNotebookEntry(database, root, { id: `e${i}`, words: `fact ${i}` }, NOW).ok,
      true,
    );
  }
  const full = rememberNotebookEntry(database, root, { id: "e32", words: "one more" }, NOW);
  assert.equal(full.ok, false);
  assert.equal(full.reason, NOTEBOOK_REFUSAL.FULL);
  assert.equal(
    rememberNotebookEntry(database, root, { id: "e33", words: "one more", replaces: "e0" }, NOW).ok,
    true,
  );
});

test("an edit made by hand is folded in before the next write rather than overwritten", () => {
  const database = openTestDatabase();
  const root = workspace();
  rememberNotebookEntry(database, root, { id: "e1", words: "likes espresso" }, NOW);
  const file = path.join(root, WORKSPACE_FILE.USER);
  fs.writeFileSync(
    file,
    `${userFile(root).replace("- likes espresso", "- likes cortado")}- ships on tuesdays\n`,
  );
  const entries = listNotebookEntries(database, root, NOW + 5);
  assert.deepEqual(
    entries.map((entry) => [entry.words, entry.origin]),
    [
      ["likes cortado", MEMORY_ORIGIN.USER],
      ["ships on tuesdays", MEMORY_ORIGIN.USER],
    ],
  );
  const remembered = rememberNotebookEntry(
    database,
    root,
    { id: "e9", words: "new thing" },
    NOW + 6,
  );
  assert.deepEqual(
    parseNotebook(userFile(root)).entries.map((entry) => entry.words),
    ["likes cortado", "ships on tuesdays", "new thing"],
  );
  assert.equal(remembered.entries.length, 3);
});

test("stable facts from the old table migrate into USER.md under their own ids, once", () => {
  const database = openTestDatabase();
  const root = workspace();
  const insert = database.prepare(
    "INSERT INTO personal_facts (id, ordinal, words) VALUES (?, ?, ?)",
  );
  insert.run("fact-a", 0, "prefers short replies");
  insert.run("fact-b", 1, "works in the evening");
  assert.equal(migrateFactsIntoNotebook(database, root, NOW), 2);
  const entries = listNotebookEntries(database, root, NOW);
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.words, entry.origin, entry.migratedFactId]),
    [
      ["fact-a", "prefers short replies", MEMORY_ORIGIN.MIGRATED_FACT, "fact-a"],
      ["fact-b", "works in the evening", MEMORY_ORIGIN.MIGRATED_FACT, "fact-b"],
    ],
  );
  // SAFETY: COUNT(*) is one integer column named `count`.
  const left = database.prepare("SELECT COUNT(*) AS count FROM personal_facts").get() as {
    count: number;
  };
  assert.equal(left.count, 0);
  assert.equal(
    migrateFactsIntoNotebook(database, root, NOW),
    0,
    "a second open finds nothing to move",
  );
  assert.equal(
    forgetNotebookEntry(database, root, "fact-a", NOW).ok,
    true,
    "the old id still answers",
  );
});
