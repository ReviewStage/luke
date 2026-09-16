import assert from "node:assert/strict";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import {
  BOOTSTRAP_BOUNDS,
  BRAIN_TURN_TRIGGER,
  CURATED_FILE_BUDGET,
  tooLargeRefusal,
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
} from "../server/core";
import { hostedTurnPolicy } from "../server/hosted/brain-host/tools";
import {
  hostedPrompt,
  hostedWorkspaceAccess,
  seedHostedWorkspace,
} from "../server/hosted/brain-host/workspace";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The hosted workspace tools' reach as the model meets it, over the real
 * migrations on PGlite: USER.md and MEMORY.md are the curated core, each
 * under its own 4,000-character budget, and every other file and a dated
 * note stand under the 20,000-character per-file bound. A write past a
 * file's own bound is refused with the bound named in the reason and leaves
 * the row as it was, so the file the prompt reads is the file that exists; a
 * row that somehow holds more than its bound is read and composed cut at
 * that bound, and the prompt says so. Synthetic accounts throughout.
 */

const NOW = 1_800_000_000_000;

/**
 * The dated-note half: an append names today's note by the clock the host
 * handed it, grows the note under the account's lock, and refuses past the
 * note's own bound, the bound named, without touching the note; the listing
 * is newest first, bounded, and counts characters without reading a word
 * back. Synthetic fixtures: no real note anywhere.
 */

/** 2026-09-15 at noon UTC; the day's note is `memory/2026-09-15.md`, which `NOTE_PATH` names. */
const NOON = Date.UTC(2026, 8, 15, 12);

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const USER_BUDGET = CURATED_FILE_BUDGET[WORKSPACE_FILE.USER];
const MEMORY_BUDGET = CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY];
const PER_FILE = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;

const NOTE_PATH = "memory/2026-09-15.md";

/** The access the tools hold for one account, over the test database's own client. */
function accessFor(userId: string, now: () => number = () => NOW) {
  return database.run(
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      return hostedWorkspaceAccess(client, database.store, userId, now);
    }),
  );
}

test("a curated file is refused past its own budget with the budget named, and the row stands as it was", async () => {
  const userId = await database.createUser();
  await database.run(seedHostedWorkspace(database.store, userId, NOW));
  const access = await accessFor(userId);
  const seeded = await database.run(access.read(WORKSPACE_FILE.MEMORY));
  assert.equal(seeded.ok, true);

  const refused = await database.run(
    access.write(WORKSPACE_FILE.MEMORY, "m".repeat(MEMORY_BUDGET + 1)),
  );
  assert.deepEqual(refused, { ok: false, reason: tooLargeRefusal(MEMORY_BUDGET) });
  assert.match(refused.ok ? "" : refused.reason, /4000 characters/u);
  assert.ok(!refused.ok && refused.reason.startsWith(WORKSPACE_FILE_REFUSAL.TOO_LARGE));
  assert.deepEqual(await database.run(access.read(WORKSPACE_FILE.MEMORY)), seeded);

  const written = await database.run(access.write(WORKSPACE_FILE.USER, "u".repeat(USER_BUDGET)));
  assert.deepEqual(written, { ok: true, chars: USER_BUDGET });
  assert.deepEqual(await database.run(access.read(WORKSPACE_FILE.USER)), {
    ok: true,
    content: "u".repeat(USER_BUDGET),
  });
});

test("an instruction file and a dated note stand under the per-file bound, not the curated budget", async () => {
  const userId = await database.createUser();
  const access = await accessFor(userId);

  const agents = await database.run(
    access.write(WORKSPACE_FILE.AGENTS, "a".repeat(USER_BUDGET + 1)),
  );
  assert.deepEqual(agents, { ok: true, chars: USER_BUDGET + 1 });
  const note = await database.run(access.write(NOTE_PATH, "n".repeat(MEMORY_BUDGET + 1)));
  assert.deepEqual(note, { ok: true, chars: MEMORY_BUDGET + 1 });

  const tooLarge = await database.run(
    access.write(WORKSPACE_FILE.AGENTS, "a".repeat(PER_FILE + 1)),
  );
  assert.deepEqual(tooLarge, { ok: false, reason: tooLargeRefusal(PER_FILE) });
  assert.match(tooLarge.ok ? "" : tooLarge.reason, /20000 characters/u);
  assert.deepEqual(await database.run(access.read(WORKSPACE_FILE.AGENTS)), {
    ok: true,
    content: "a".repeat(USER_BUDGET + 1),
  });
});

test("a row past its file's bound is read cut at that bound, and the prompt composes it cut and says so", async () => {
  const userId = await database.createUser();
  await database.run(seedHostedWorkspace(database.store, userId, NOW));
  await database.run(
    database.store.workspace.write(userId, WORKSPACE_FILE.USER, "u".repeat(USER_BUDGET + 250), NOW),
  );
  await database.run(
    database.store.workspace.write(
      userId,
      WORKSPACE_FILE.AGENTS,
      "a".repeat(USER_BUDGET + 250),
      NOW,
    ),
  );
  const access = await accessFor(userId);

  assert.deepEqual(await database.run(access.read(WORKSPACE_FILE.USER)), {
    ok: true,
    content: "u".repeat(USER_BUDGET),
  });
  assert.deepEqual(await database.run(access.read(WORKSPACE_FILE.AGENTS)), {
    ok: true,
    content: "a".repeat(USER_BUDGET + 250),
  });

  const built = await database.run(
    hostedPrompt(database.store, userId, { policy: hostedTurnPolicy(BRAIN_TURN_TRIGGER.ASK) }),
  );
  assert.ok(
    built.text.includes(`- USER.md: ${USER_BUDGET} of ${USER_BUDGET + 250} characters shown`),
  );
  assert.ok(!built.text.includes("u".repeat(USER_BUDGET + 1)));
  assert.ok(built.text.includes("a".repeat(USER_BUDGET + 250)));
});

test("an append creates today's note by the host's clock, grows it after a blank line, and the next day's entry opens the next day's note", async () => {
  const userId = await database.createUser();
  let now = NOON;
  const access = await accessFor(userId, () => now);

  assert.deepEqual(await database.run(access.append("- decided: notch")), {
    ok: true,
    path: NOTE_PATH,
    chars: "- decided: notch".length,
  });
  assert.deepEqual(await database.run(access.append("- tests green")), {
    ok: true,
    path: NOTE_PATH,
    chars: "- decided: notch\n\n- tests green".length,
  });
  assert.deepEqual(await database.run(access.read(NOTE_PATH)), {
    ok: true,
    content: "- decided: notch\n\n- tests green",
  });
  now = NOON + 24 * 60 * 60 * 1000;
  assert.deepEqual(await database.run(access.append("- next day")), {
    ok: true,
    path: "memory/2026-09-16.md",
    chars: "- next day".length,
  });
  assert.deepEqual(await database.run(access.listNotes(60)), [
    { path: "memory/2026-09-16.md", chars: "- next day".length },
    { path: NOTE_PATH, chars: "- decided: notch\n\n- tests green".length },
  ]);
  assert.deepEqual(await database.run(access.listNotes(1)), [
    { path: "memory/2026-09-16.md", chars: "- next day".length },
  ]);
  // A bootstrap file is no dated note, whatever the listing's bound.
  await database.run(access.write("MEMORY.md", "# MEMORY.md"));
  assert.equal((await database.run(access.listNotes(60))).length, 2);
});

test("an entry that would grow the note past the note's own bound is refused with the bound named and the note stands as it was", async () => {
  const userId = await database.createUser();
  const access = await accessFor(userId, () => NOON);
  const nearlyFull = "x".repeat(PER_FILE - 10);
  assert.equal((await database.run(access.append(nearlyFull))).ok, true);
  assert.deepEqual(await database.run(access.append("- ten chars or more")), {
    ok: false,
    reason: tooLargeRefusal(PER_FILE),
  });
  assert.deepEqual(await database.run(access.listNotes(60)), [
    { path: NOTE_PATH, chars: nearlyFull.length },
  ]);
  // An entry that fits exactly lands: the bound is inclusive.
  const fitting = "y".repeat(8);
  assert.deepEqual(await database.run(access.append(fitting)), {
    ok: true,
    path: NOTE_PATH,
    chars: PER_FILE,
  });
  // An account that never appended lists nothing, and a first entry past the bound creates no note.
  const other = await database.createUser();
  const otherAccess = await accessFor(other, () => NOON);
  const oversize = "z".repeat(PER_FILE + 1);
  assert.equal((await database.run(otherAccess.append(oversize))).ok, false);
  assert.deepEqual(await database.run(otherAccess.listNotes(60)), []);
  assert.deepEqual(await database.run(otherAccess.read(NOTE_PATH)), {
    ok: false,
    reason: WORKSPACE_FILE_REFUSAL.NOT_FOUND,
  });
});

test("appends in flight together for one account all land, none losing another's entry", async () => {
  const userId = await database.createUser();
  const access = await accessFor(userId, () => NOON);
  const entries = ["- a", "- b", "- c", "- d", "- e", "- f", "- g", "- h"];
  await Promise.all(entries.map((entry) => database.run(access.append(entry))));
  const read = await database.run(access.read(NOTE_PATH));
  assert.ok(read.ok);
  for (const entry of entries) assert.ok(read.content.includes(entry), entry);
  assert.equal(read.content.split("\n\n").length, entries.length);
});
