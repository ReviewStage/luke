import assert from "node:assert/strict";
import { test } from "vitest";
import { renderAskContext, TRANSCRIPT_SPEAKER, TranscriptLedger } from "./transcript.js";

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
