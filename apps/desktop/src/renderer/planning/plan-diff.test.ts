import assert from "node:assert/strict";
import { test } from "vitest";
import { diffHunks, type Hunk, heldWords, MOVE_HALF } from "./plan-diff";

/** The old words with every change made, from the last so the earlier offsets still hold. */
function applied(old: string, hunks: readonly Hunk[]): string {
  return [...hunks]
    .reverse()
    .reduce((words, hunk) => words.slice(0, hunk.from) + hunk.insert + words.slice(hunk.to), old);
}

const CHANGES: ReadonlyArray<readonly [string, string]> = [
  ["", "- Only an admin can invite."],
  ["- Only an admin can invite.", ""],
  ["- Only an admin can invite.", "- Any member can invite."],
  ["- Only an admin can invite.\n- By email.", "- By email.\n- Only an admin can invite."],
  ["_Unanswered_", "- Members invite by email.\n- Links expire in a week."],
  ["- One\n- Two\n- Three", "- One\n- Three"],
  ["Only an adm", "Only an admin can invite."],
  ["Invite by email, then accept.", "Invite by link or email, then accept within a week."],
];

test("every change made turns the old words into the newer ones", () => {
  for (const [old, next] of CHANGES) assert.equal(applied(old, diffHunks(old, next)), next);
  assert.deepEqual(diffHunks("- Same words.", "- Same words."), []);
});

test("one changed word touches that word alone, and only the letters that differ", () => {
  const old = "- Only an admin can invite.\n- Invites go by email.";
  assert.deepEqual(diffHunks(old, old.replace("admin", "owner")), [
    { from: old.indexOf("admin"), to: old.indexOf("admin") + "admin".length, insert: "owner" },
  ]);
  // A word typed partway carries on rather than being erased and typed again.
  assert.deepEqual(diffHunks("Only an adm", "Only an admin"), [
    { from: "Only an adm".length, to: "Only an adm".length, insert: "in" },
  ]);
});

test("a lone shared word between two changes is one change, but a shared line break keeps them apart", () => {
  const old = "Only an admin may invite.";
  const hunks = diffHunks(old, "Only a member may send.");
  assert.equal(hunks.length, 2);
  assert.equal(old.slice(hunks[0]?.from, hunks[0]?.to), "an admin");
  const lines = diffHunks("- Old one\n- Old two", "- New one\n- New two");
  assert.equal(lines.length, 2);
});

test("a line that moved unchanged is one cut and one paste", () => {
  const old = "- Only an admin can invite.\n- Invites go by email.\n- Links expire in a week.";
  const next = "- Invites go by email.\n- Links expire in a week.\n- Only an admin can invite.";
  const hunks = diffHunks(old, next);
  const cut = hunks.find((hunk) => hunk.move === MOVE_HALF.CUT);
  const paste = hunks.find((hunk) => hunk.move === MOVE_HALF.PASTE);
  assert.equal(old.slice(cut?.from, cut?.to).trim(), "- Only an admin can invite.");
  assert.equal(paste?.insert.trim(), "- Only an admin can invite.");
  assert.equal(hunks.length, 2);
});

test("a field still streaming is followed while it grows, and held as shown while it rewrites", () => {
  const shown = "### Problem\n\n- Only an admin can invite.";
  // Carrying on from everything shown: followed.
  const grown = `${shown}\n- Invites go by`;
  assert.equal(heldWords(shown, grown), grown);
  // Re-emitting what is shown, not past it yet: nothing to do.
  assert.equal(heldWords(shown, "### Problem\n\n- Only an ad"), shown);
  // A rewrite cut off partway: held until the whole change can be read.
  assert.equal(heldWords(shown, "### Problem\n\n- Only an owner"), shown);
  // A placeholder is never held: the first streamed words replace it.
  assert.equal(
    heldWords("### Problem\n\n_Unanswered_", "### Problem\n\n- Members"),
    "### Problem\n\n- Members",
  );
});
