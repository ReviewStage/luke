import assert from "node:assert/strict";
import test from "node:test";
import { REPLY_KIND, type ReplyKind } from "@sidecar/voice/orchestrator";
import { CAPTION_SEGMENT_LIMIT, CaptionStrip } from "./captions";

interface Drawn {
  texts: readonly string[] | undefined;
  kind: ReplyKind | undefined;
}

interface Ended {
  texts: readonly string[];
  kind: ReplyKind | undefined;
  runId: string | undefined;
}

interface Harness {
  strip: CaptionStrip;
  drawn: Drawn[];
  ended: Ended[];
}

function harness(): Harness {
  const drawn: Drawn[] = [];
  const ended: Ended[] = [];
  return {
    strip: new CaptionStrip({
      onCaption: (texts, kind) => drawn.push({ texts, kind }),
      onReplyEnded: (texts, kind, runId) => ended.push({ texts, kind, runId }),
    }),
    drawn,
    ended,
  };
}

function latest(drawn: readonly Drawn[]): Drawn | undefined {
  return drawn.at(-1);
}

test("the words grow as they arrive, and each piece redraws", () => {
  const context = harness();
  context.strip.append("item-1", "Two agents ");
  context.strip.append("item-1", "are waiting.");

  assert.deepEqual(
    context.drawn.map((entry) => entry.texts),
    [["Two agents "], ["Two agents are waiting."]],
  );
});

test("the item's own final transcript supersedes the deltas that approximated it", () => {
  const context = harness();
  context.strip.append("item-1", "Two agents are waitin");
  context.strip.settle("item-1", "Two agents are waiting.");

  assert.deepEqual(latest(context.drawn)?.texts, ["Two agents are waiting."]);
});

test("a second item stacks as its own segment instead of running onto the first", () => {
  const context = harness();
  context.strip.append("item-1", "Looking now.");
  context.strip.append("item-2", "Two agents are waiting.");

  assert.deepEqual(latest(context.drawn)?.texts, ["Looking now.", "Two agents are waiting."]);
});

test("an item's transcript lands on its own segment after the turn has moved past it", () => {
  const context = harness();
  context.strip.append("item-1", "Looking no");
  context.strip.append("item-2", "Two agents are waiting.");

  // The first item settles late, while the second is already streaming under
  // it: its words belong to its own segment, not to whichever is newest.
  context.strip.settle("item-1", "Looking now.");

  assert.deepEqual(latest(context.drawn)?.texts, ["Looking now.", "Two agents are waiting."]);
});

test("only the newest segments stay up", () => {
  const context = harness();
  for (const index of [1, 2, 3, 4]) context.strip.append(`item-${index}`, `Sentence ${index}.`);

  assert.equal(latest(context.drawn)?.texts?.length, CAPTION_SEGMENT_LIMIT);
  assert.deepEqual(latest(context.drawn)?.texts, ["Sentence 3.", "Sentence 4."]);
});

test("a transcript whose item holds no segment writes nothing", () => {
  const context = harness();
  context.strip.append("item-1", "Two agents are waiting.");
  const drawnBefore = context.drawn.length;

  // A cancelled reply's straggler: the server had produced it before the
  // interrupt landed, and its segment is long gone.
  context.strip.settle("item-gone", "Words nobody heard.");

  assert.equal(context.drawn.length, drawnBefore);
});

test("a transcript that says what the words already say redraws nothing", () => {
  const context = harness();
  context.strip.append("item-1", "Two agents are waiting.");
  const drawnBefore = context.drawn.length;

  context.strip.settle("item-1", "Two agents are waiting.");

  assert.equal(context.drawn.length, drawnBefore);
});

test("ending hands the words over once, then empties", () => {
  const context = harness();
  context.strip.mark(REPLY_KIND.BRIEFING);
  context.strip.append("item-1", "Two agents are waiting.");

  context.strip.end();
  context.strip.end();

  assert.deepEqual(context.ended, [
    { texts: ["Two agents are waiting."], kind: REPLY_KIND.BRIEFING, runId: undefined },
  ]);
  assert.deepEqual(latest(context.drawn), { texts: undefined, kind: undefined });
});

test("the kind and the run are the reply's, and leave with it", () => {
  const context = harness();
  context.strip.mark(REPLY_KIND.REPLY, "run-7");
  assert.equal(context.strip.kinded, true);
  assert.deepEqual(latest(context.drawn), { texts: undefined, kind: REPLY_KIND.REPLY });

  context.strip.end();

  assert.equal(context.strip.kinded, false);
  assert.deepEqual(context.ended, [{ texts: [], kind: REPLY_KIND.REPLY, runId: "run-7" }]);
});

test("a reply that said nothing and named no run hands nothing over", () => {
  const context = harness();
  context.strip.end();

  assert.deepEqual(context.ended, []);
  assert.deepEqual(context.drawn, []);
});

test("discarding empties without admitting anything to History", () => {
  const context = harness();
  context.strip.mark(REPLY_KIND.BRIEFING, "run-7");
  context.strip.append("item-1", "A briefing nobody heard.");

  context.strip.discard();

  assert.deepEqual(context.ended, []);
  assert.deepEqual(latest(context.drawn), { texts: undefined, kind: undefined });
  assert.equal(context.strip.kinded, false);
});
