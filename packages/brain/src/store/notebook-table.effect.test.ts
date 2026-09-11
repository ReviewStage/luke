import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import { MEMORY_ORIGIN, parseNotebook } from "@sidecar/memory";
import { WORKSPACE_FILE } from "@sidecar/runtime";
import { Effect } from "effect";
import {
  forgetNotebookEntryEffect,
  listNotebookEntriesEffect,
  migrateFactsIntoNotebookEffect,
  NOTEBOOK_REFUSAL,
  rememberNotebookEntryEffect,
} from "./notebook-table.js";
import { NOW, overStore } from "./testing.js";

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-notebook-"));
}

function userFile(root: string): string {
  return fs.readFileSync(path.join(root, WORKSPACE_FILE.USER), "utf8");
}

describe("the notebook over the client", () => {
  it.effect(
    "remember writes a line under the heading and an entry beside it; forget removes both",
    () =>
      overStore(
        Effect.gen(function* () {
          const root = workspace();
          assert.deepEqual(yield* listNotebookEntriesEffect(root, NOW), []);
          const first = yield* rememberNotebookEntryEffect(
            root,
            { id: "e1", words: "prefers  tabs " },
            NOW,
          );
          assert.equal(first.ok, true);
          assert.deepEqual(
            first.entries.map((entry) => [entry.id, entry.words, entry.origin]),
            [["e1", "prefers tabs", MEMORY_ORIGIN.AGENT]],
          );

          const duplicate = yield* rememberNotebookEntryEffect(
            root,
            { id: "e2", words: "prefers tabs" },
            NOW,
          );
          assert.equal(duplicate.ok, true);
          assert.equal(duplicate.entries.length, 1, "the same words add nothing");

          const replaced = yield* rememberNotebookEntryEffect(
            root,
            { id: "e3", words: "prefers spaces", replaces: "e1" },
            NOW + 1,
          );
          assert.deepEqual(
            replaced.entries.map((entry) => entry.words),
            ["prefers spaces"],
          );
          assert.equal(parseNotebook(userFile(root)).entries.length, 1);

          const unknown = yield* rememberNotebookEntryEffect(
            root,
            { id: "e4", words: "x", replaces: "nope" },
            NOW,
          );
          assert.equal(unknown.ok, false);
          assert.equal(unknown.reason, NOTEBOOK_REFUSAL.UNKNOWN_ID);
          assert.equal(
            (yield* rememberNotebookEntryEffect(root, { id: "e5", words: "   " }, NOW)).reason,
            NOTEBOOK_REFUSAL.EMPTY,
          );

          const forgotten = yield* forgetNotebookEntryEffect(root, "e3", NOW + 2);
          assert.equal(forgotten.ok, true);
          assert.deepEqual(forgotten.entries, []);
          assert.equal(parseNotebook(userFile(root)).entries.length, 0);
          assert.equal((yield* forgetNotebookEntryEffect(root, "e3", NOW)).ok, false);
        }),
      ),
  );

  it.effect("a file write that fails rolls the rows back and leaves the file as it was", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        yield* rememberNotebookEntryEffect(root, { id: "e1", words: "likes espresso" }, NOW);
        const before = userFile(root);
        fs.mkdirSync(`${path.join(root, WORKSPACE_FILE.USER)}.${process.pid}.tmp`);

        const failed = yield* Effect.exit(
          rememberNotebookEntryEffect(root, { id: "e2", words: "new" }, NOW + 1),
        );
        const failedForget = yield* Effect.exit(forgetNotebookEntryEffect(root, "e1", NOW + 2));

        assert.equal(failed._tag, "Failure");
        assert.equal(failedForget._tag, "Failure");
        assert.equal(userFile(root), before);
        assert.deepEqual(
          (yield* listNotebookEntriesEffect(root, NOW + 3)).map((entry) => entry.id),
          ["e1"],
        );
      }),
    ),
  );

  it.effect("the list is bounded at 32 unless an entry is replaced", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        for (let i = 0; i < 32; i += 1) {
          assert.equal(
            (yield* rememberNotebookEntryEffect(root, { id: `e${i}`, words: `fact ${i}` }, NOW)).ok,
            true,
          );
        }
        const full = yield* rememberNotebookEntryEffect(
          root,
          { id: "e32", words: "one more" },
          NOW,
        );
        assert.equal(full.ok, false);
        assert.equal(full.reason, NOTEBOOK_REFUSAL.FULL);
        assert.equal(
          (yield* rememberNotebookEntryEffect(
            root,
            { id: "e33", words: "one more", replaces: "e0" },
            NOW,
          )).ok,
          true,
        );
      }),
    ),
  );

  it.effect("an edit made by hand is folded in before the next write rather than overwritten", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        yield* rememberNotebookEntryEffect(root, { id: "e1", words: "likes espresso" }, NOW);
        const file = path.join(root, WORKSPACE_FILE.USER);
        fs.writeFileSync(
          file,
          `${userFile(root).replace("- likes espresso", "- likes cortado")}- ships on tuesdays\n`,
        );
        const entries = yield* listNotebookEntriesEffect(root, NOW + 5);
        assert.deepEqual(
          entries.map((entry) => [entry.words, entry.origin]),
          [
            ["likes cortado", MEMORY_ORIGIN.USER],
            ["ships on tuesdays", MEMORY_ORIGIN.USER],
          ],
        );
        const remembered = yield* rememberNotebookEntryEffect(
          root,
          { id: "e9", words: "new thing" },
          NOW + 6,
        );
        assert.deepEqual(
          parseNotebook(userFile(root)).entries.map((entry) => entry.words),
          ["likes cortado", "ships on tuesdays", "new thing"],
        );
        assert.equal(remembered.entries.length, 3);
      }),
    ),
  );

  it.effect("stable facts from the old table migrate into USER.md under their own ids, once", () =>
    overStore(
      Effect.gen(function* () {
        const root = workspace();
        const sql = yield* Client.SqlClient;
        yield* sql`INSERT INTO personal_facts (id, ordinal, words)
                   VALUES (${"fact-a"}, ${0}, ${"prefers short replies"})`;
        yield* sql`INSERT INTO personal_facts (id, ordinal, words)
                   VALUES (${"fact-b"}, ${1}, ${"works in the evening"})`;

        assert.equal(yield* migrateFactsIntoNotebookEffect(root, NOW), 2);
        const entries = yield* listNotebookEntriesEffect(root, NOW);
        assert.deepEqual(
          entries.map((entry) => [entry.id, entry.words, entry.origin, entry.migratedFactId]),
          [
            ["fact-a", "prefers short replies", MEMORY_ORIGIN.MIGRATED_FACT, "fact-a"],
            ["fact-b", "works in the evening", MEMORY_ORIGIN.MIGRATED_FACT, "fact-b"],
          ],
        );
        const left = yield* sql`SELECT COUNT(*) AS count FROM personal_facts`;
        assert.equal(left[0]?.count, 0);
        assert.equal(
          yield* migrateFactsIntoNotebookEffect(root, NOW),
          0,
          "a second open finds nothing to move",
        );
        assert.equal(
          (yield* forgetNotebookEntryEffect(root, "fact-a", NOW)).ok,
          true,
          "the old id still answers",
        );
      }),
    ),
  );
});
