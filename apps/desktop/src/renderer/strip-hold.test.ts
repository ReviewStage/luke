import assert from "node:assert/strict";
import { test } from "vitest";
import { CAPTION_TONE, pointOverStrip, type SpokenStripContent, stripHoldNext } from "./strip-hold";

const WORDS: SpokenStripContent = {
  texts: ["Bootstrap the desktop shell is finished."],
  tone: CAPTION_TONE.WORDS,
};

test("content leaves on its own terms while nobody is over it", () => {
  // The hold exists for a pointer already resting on the strip; without one,
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // the words keep dying with the reply exactly as they always did.
  assert.equal(stripHoldNext({ hovered: false, drawn: WORDS, held: undefined }), undefined);
  assert.equal(stripHoldNext({ hovered: false, drawn: undefined, held: WORDS }), undefined);
});

test("a hovered strip holds exactly what it was showing", () => {
  // Live content refreshes the hold while it lasts...
  assert.equal(stripHoldNext({ hovered: true, drawn: WORDS, held: undefined }), WORDS);
  // ...and the reply ending under the pointer leaves the snapshot standing.
  assert.equal(stripHoldNext({ hovered: true, drawn: undefined, held: WORDS }), WORDS);
});

test("a hover that began after the dismissal resurrects nothing", () => {
  // The hold can only finish being read: a pointer arriving over an empty
  // strip finds nothing, however recently something was there.
  assert.equal(stripHoldNext({ hovered: true, drawn: undefined, held: undefined }), undefined);
});

test("a new reply's content replaces whatever was held", () => {
  const older: SpokenStripContent = { texts: ["An older reply."], tone: CAPTION_TONE.WORDS };
  assert.equal(stripHoldNext({ hovered: true, drawn: WORDS, held: older }), WORDS);
});

test("an unchanged sentence keeps the hold's identity", () => {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The caller stores the hold as state and the live content's identity
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // churns per render: a rebuilt-but-equal snapshot returning as a new object
  // would re-render an unchanged strip every frame the pointer rests on it.
  const rebuilt: SpokenStripContent = { ...WORDS, texts: [...WORDS.texts] };
  assert.equal(stripHoldNext({ hovered: true, drawn: rebuilt, held: WORDS }), WORDS);
});

test("a hold keeps every stacked segment, and a new segment arriving refreshes it whole", () => {
  const three: SpokenStripContent = {
    texts: ["Looking now.", "Two agents are waiting.", "Nothing else has moved."],
    tone: CAPTION_TONE.WORDS,
  };
  // The snapshot is the whole stack, however many segments it holds...
  assert.equal(stripHoldNext({ hovered: true, drawn: three, held: undefined }), three);
  assert.equal(stripHoldNext({ hovered: true, drawn: undefined, held: three }), three);
  // ...and the same three rebuilt keep the hold's identity, while a fourth
  // segment arriving under the pointer is new content and replaces it.
  const rebuilt: SpokenStripContent = { ...three, texts: [...three.texts] };
  assert.equal(stripHoldNext({ hovered: true, drawn: rebuilt, held: three }), three);
  const four: SpokenStripContent = { ...three, texts: [...three.texts, "Say the word."] };
  assert.equal(stripHoldNext({ hovered: true, drawn: four, held: three }), four);
  // A settled segment's transcript landing late changes one line of the
  // stack, and that too is new content rather than the held frame.
  const corrected: SpokenStripContent = {
    ...three,
    texts: ["Looking now, corrected.", ...three.texts.slice(1)],
  };
  assert.equal(stripHoldNext({ hovered: true, drawn: corrected, held: three }), corrected);
});

test("a tone change is a content change", () => {
  // The same words in a different tone are drawn differently, so a held
  // snapshot must not keep its identity across one.
  const notice: SpokenStripContent = { ...WORDS, tone: CAPTION_TONE.NOTICE };
  assert.equal(stripHoldNext({ hovered: true, drawn: notice, held: WORDS }), notice);
});

test("the caption counts only to its visible height, and an absent box never matches", () => {
  // The element's box runs to the reserved maximum and the clip ends it at
  // the words, so the remainder is desktop: resting there holds nothing.
  const caption = { box: { left: 0, top: 0, right: 100, bottom: 70 }, visibleHeight: 28 };
  assert.equal(pointOverStrip({ x: 50, y: 20, caption }), true);
  assert.equal(pointOverStrip({ x: 50, y: 40, caption }), false);
  // An undrawn element still has a box; the caller withholds it, and a strip
  // offering none can never read as hovered.
  assert.equal(pointOverStrip({ x: 50, y: 20, caption: undefined }), false);
});
