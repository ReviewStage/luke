import assert from "node:assert/strict";
import { test } from "vitest";
import {
  renderAskContext,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  UTTERANCE_GAP_MS,
} from "./transcript.js";

/** A ledger minting ids a test can read back: `row-1`, `row-2`, in the order the rows opened. */
function ledgerWithCountedIds(): TranscriptLedger {
  let minted = 0;
  return new TranscriptLedger({
    mintRowId: () => {
      minted += 1;
      return `row-${minted}`;
    },
  });
}

function user(text: string, startMs: number, endMs: number) {
  return { speaker: TRANSCRIPT_SPEAKER.USER, text, startMs, endMs };
}

function assistant(text: string, startMs: number, endMs: number) {
  return { speaker: TRANSCRIPT_SPEAKER.ASSISTANT, text, startMs, endMs };
}

test("fragments close together are one utterance, concatenated exactly as received", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(user("What", 1_000, 1_200));
  ledger.append(user(" needs", 1_200, 1_500));
  ledger.append(user("  me?", 1_600, 1_900));

  const utterances = ledger.utterances(TRANSCRIPT_SPEAKER.USER);
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0]?.text, "What needs  me?");
  assert.equal(utterances[0]?.startMs, 1_000);
  assert.equal(utterances[0]?.endMs, 1_900);
});

test("a gap past the threshold starts a new utterance under a freshly minted row id", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(user("First.", 0, 500));
  const secondStartMs = 500 + UTTERANCE_GAP_MS + 1;
  ledger.append(user("Second.", secondStartMs, secondStartMs + 1_000));

  const rows = ledger.captionLines();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.rowId),
    ["row-1", "row-2"],
  );
});

test("a row id is the factory's word and nothing of the fragment's: two ledgers over the same words mint what they are handed", () => {
  const first = new TranscriptLedger({ mintRowId: () => "a" });
  const second = new TranscriptLedger({ mintRowId: () => "b" });
  assert.equal(first.append(user("Hello", 0, 400))?.rowId, "a");
  assert.equal(second.append(user("Hello", 0, 400))?.rowId, "b");
  assert.equal(first.row("a")?.text, "Hello");
  assert.equal(first.row("b"), undefined);
});

test("a gap of exactly the threshold still joins", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(user("A", 0, 500));
  const secondStartMs = 500 + UTTERANCE_GAP_MS;
  ledger.append(user("B", secondStartMs, secondStartMs + 1_000));

  const utterances = ledger.utterances(TRANSCRIPT_SPEAKER.USER);
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0]?.text, "AB");
});

test("the two speakers group independently and may overlap", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(assistant("The tests passed", 0, 1_500));
  ledger.append(user("mm-hmm", 800, 1_100));
  ledger.append(assistant(" on checkout.", 1_500, 2_200));

  const rows = ledger.captionLines();
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.rowId, row.speaker]),
    [
      ["row-1", TRANSCRIPT_SPEAKER.ASSISTANT],
      ["row-2", TRANSCRIPT_SPEAKER.USER],
    ],
  );
  assert.equal(rows[0]?.text, "The tests passed on checkout.");
});

test("a late fragment revises the earlier row it belongs to, and the row keeps its place", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(user("Hello", 0, 400));
  ledger.append(user("Second thought.", 10_000, 11_000));
  const revised = ledger.append(user(" there", 400, 700));

  assert.equal(revised?.rowId, "row-1");
  const rows = ledger.captionLines();
  assert.deepEqual(
    rows.map((row) => row.rowId),
    ["row-1", "row-2"],
  );
  assert.equal(rows[0]?.text, "Hello there");
  assert.equal(rows[0]?.endMs, 700);
});

test("a fragment ending before it starts is refused and records nothing", () => {
  const ledger = ledgerWithCountedIds();

  assert.equal(ledger.append(user("x", 500, 400)), undefined);
  assert.equal(ledger.append(user("x", Number.NaN, 400)), undefined);
  assert.deepEqual(ledger.captionLines(), []);
  assert.equal(ledger.lastActivityMs(), undefined);
});

test("last activity is the latest end any fragment reached", () => {
  const ledger = ledgerWithCountedIds();
  assert.equal(ledger.lastActivityMs(), undefined);
  ledger.append(assistant("a", 0, 900));
  ledger.append(user("b", 200, 600));

  assert.equal(ledger.lastActivityMs(), 900);
});

test("utterances since an instant are those still ending after it, ordered by start", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(user("old", 0, 500));
  ledger.append(assistant("reply", 2_000, 3_000));
  // A pause well past the gap, so "newer" is its own utterance and not "old" grown.
  ledger.append(user("newer", 6_000, 6_500));

  const since = ledger.utterances(undefined, { sinceMs: 2_500 });
  assert.deepEqual(
    since.map((utterance) => [utterance.speaker, utterance.text]),
    [
      [TRANSCRIPT_SPEAKER.ASSISTANT, "reply"],
      [TRANSCRIPT_SPEAKER.USER, "newer"],
    ],
  );
});

test("the ask context is both speakers since the offset with the developer's latest as the ask", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(user("Anything waiting?", 0, 1_000));
  ledger.append(assistant("Let me look.", 1_200, 2_000));
  // A pause well past the gap, so the second ask is its own utterance and not the first grown.
  ledger.append(user("Actually, only Codex.", 7_000, 8_500));
  ledger.append(assistant("Sure.", 8_600, 9_000));

  const context = ledger.askContext(1_100);
  assert.deepEqual(
    context.turns.map((turn) => turn.rowId),
    ["row-2", "row-3", "row-4"],
  );
  assert.equal(context.ask?.rowId, "row-3");
  assert.equal(context.ask?.text, "Actually, only Codex.");
  assert.deepEqual(renderAskContext(context).split("\n"), [
    "Assistant: Let me look.",
    "Developer: Actually, only Codex.",
    "Assistant: Sure.",
  ]);
});

test("a span with no developer utterance yet has no ask", () => {
  const ledger = ledgerWithCountedIds();
  ledger.append(assistant("Anything else?", 0, 800));

  const context = ledger.askContext(0);
  assert.equal(context.turns.length, 1);
  assert.equal(context.ask, undefined);
});
