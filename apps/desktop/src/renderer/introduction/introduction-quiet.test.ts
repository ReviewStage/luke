import assert from "node:assert/strict";
import test from "node:test";
import { TRANSCRIPT_SPEAKER, UTTERANCE_GAP_MS, UTTERANCE_SETTLE_MARGIN_MS } from "@sidecar/live";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";
import { LiveCaptions } from "#renderer/voice/live-captions";
import { lukeCaption, lukeOutputQuiet } from "./introduction-quiet";

const START = 1_800_000_000_000;

function ledgerRows() {
  let now = START;
  let rows: readonly LiveCaptionRow[] = [];
  const captions = new LiveCaptions({
    onRows: (next) => {
      rows = next;
    },
    now: () => now,
  });
  return {
    captions,
    rows: () => rows,
    advance: (ms: number) => {
      now += ms;
      captions.tick();
    },
  };
}

test("nothing said is not quiet, and a greeting still arriving is not quiet", () => {
  const ledger = ledgerRows();
  assert.equal(lukeOutputQuiet(ledger.rows(), false), false);
  ledger.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, "Hi! I'm", 0, 600);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), false);
  ledger.advance(UTTERANCE_GAP_MS);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), false);
});

test("quiet is the gap plus the margin after the last fragment, on the arrival clock", () => {
  const ledger = ledgerRows();
  ledger.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, "Hi! I'm Luke.", 0, 900);
  ledger.advance(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS - 1);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), false);
  ledger.advance(1);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), true);
});

test("a late fragment reopens the wait, and the remote track speaking holds it", () => {
  const ledger = ledgerRows();
  ledger.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, "These are", 0, 500);
  ledger.advance(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), true);
  ledger.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, " your agents.", 500, 1_100);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), false);
  ledger.advance(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.equal(lukeOutputQuiet(ledger.rows(), true), false);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), true);
});

test("the developer's rows settle nothing of Luke's, and are read apart", () => {
  const ledger = ledgerRows();
  ledger.captions.append(TRANSCRIPT_SPEAKER.USER, "Hello there", 0, 800);
  assert.equal(lukeOutputQuiet(ledger.rows(), false), false);
  assert.equal(lukeCaption(ledger.rows()), undefined);
  ledger.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, "Hi!", 1_000, 1_300);
  assert.equal(lukeCaption(ledger.rows()), "Hi!");
});
