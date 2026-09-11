import assert from "node:assert/strict";
import { TRANSCRIPT_SPEAKER, UTTERANCE_GAP_MS, UTTERANCE_SETTLE_MARGIN_MS } from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";
import { test } from "vitest";
import { LiveCaptions } from "./live-captions";

function fixture() {
  let now = 10_000;
  const reports: (readonly LiveCaptionRow[])[] = [];
  const captions = new LiveCaptions({ onRows: (rows) => reports.push(rows), now: () => now });
  return {
    captions,
    reports,
    latest: () => reports[reports.length - 1] ?? [],
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("fragments group into one row per utterance, verbatim and in arrival order, with the row id stable", () => {
  const f = fixture();
  f.captions.append(TRANSCRIPT_SPEAKER.USER, "what ", 0, 400);
  f.captions.append(TRANSCRIPT_SPEAKER.USER, "needs me", 400, 900);
  assert.equal(f.latest().length, 1);
  assert.equal(f.latest()[0]?.rowId, 1);
  assert.equal(f.latest()[0]?.entry.kind, CONVERSATION_ENTRY_KIND.SPOKEN_ASK);
  assert.equal(f.latest()[0]?.entry.words, "what needs me");
  assert.equal(f.latest()[0]?.settled, false);
  // A gap wider than the utterance gap opens a new row rather than growing the first.
  f.captions.append(TRANSCRIPT_SPEAKER.USER, "and then?", 900 + UTTERANCE_GAP_MS + 1, 3_000);
  assert.deepEqual(
    f.latest().map((row) => row.rowId),
    [1, 2],
  );
});

test("both speakers draw at once, each as their own kind, and overlap does not merge them", () => {
  const f = fixture();
  f.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, "Two sessions", 0, 800);
  f.captions.append(TRANSCRIPT_SPEAKER.USER, "wait", 500, 700);
  f.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, " finished.", 800, 1_200);
  assert.deepEqual(
    f.latest().map((row) => [row.rowId, row.entry.kind, row.entry.words]),
    [
      [1, CONVERSATION_ENTRY_KIND.REPLY, "Two sessions finished."],
      [2, CONVERSATION_ENTRY_KIND.SPOKEN_ASK, "wait"],
    ],
  );
});

test("a row settles once no fragment has joined it for the gap plus the margin, on this window's clock", () => {
  const f = fixture();
  f.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, "Two sessions", 0, 800);
  f.advance(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS - 1);
  f.captions.tick();
  assert.equal(f.latest()[0]?.settled, false);
  // A late fragment re-arms the row.
  f.captions.append(TRANSCRIPT_SPEAKER.ASSISTANT, " finished.", 800, 1_200);
  f.advance(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS - 1);
  f.captions.tick();
  assert.equal(f.latest()[0]?.settled, false);
  f.advance(1);
  f.captions.tick();
  assert.equal(f.latest()[0]?.settled, true);
  assert.equal(f.latest()[0]?.entry.words, "Two sessions finished.");
});

test("a fragment that ends before it starts, or says nothing, draws no row", () => {
  const f = fixture();
  f.captions.append(TRANSCRIPT_SPEAKER.USER, "late", 900, 400);
  assert.equal(f.reports.length, 0);
  f.captions.append(TRANSCRIPT_SPEAKER.USER, "   ", 0, 100);
  assert.equal(f.latest().length, 0);
});
