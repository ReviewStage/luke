import assert from "node:assert/strict";
import test from "node:test";
import { pointOverStrip, type SpokenStripContent, stripHoldNext } from "../src/renderer/strip-hold";

const WORDS: SpokenStripContent = {
  texts: ["Bootstrap the desktop shell is finished."],
  isError: false,
  chips: true,
};

test("content leaves on its own terms while nobody is over it", () => {
  // The hold exists for a pointer already resting on the strip; without one,
  // the words and chips keep dying with the reply exactly as they always did.
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
  const older: SpokenStripContent = { texts: ["An older reply."], isError: false, chips: false };
  assert.equal(stripHoldNext({ hovered: true, drawn: WORDS, held: older }), WORDS);
});

test("an unchanged sentence keeps the hold's identity", () => {
  // The caller stores the hold as state and the live content's identity
  // churns per render: a rebuilt-but-equal snapshot returning as a new object
  // would re-render an unchanged strip every frame the pointer rests on it.
  const rebuilt: SpokenStripContent = { ...WORDS, texts: [...(WORDS.texts ?? [])] };
  assert.equal(stripHoldNext({ hovered: true, drawn: rebuilt, held: WORDS }), WORDS);
  const chipless: SpokenStripContent = { texts: undefined, isError: false, chips: true };
  assert.equal(stripHoldNext({ hovered: true, drawn: { ...chipless }, held: chipless }), chipless);
});

test("the caption counts only to its visible height", () => {
  // The element's box runs to the reserved maximum and the clip ends it at
  // the words, so the remainder is desktop: resting there holds nothing.
  const caption = { box: { left: 0, top: 0, right: 100, bottom: 70 }, visibleHeight: 28 };
  assert.equal(pointOverStrip({ x: 50, y: 20, caption, band: undefined }), true);
  assert.equal(pointOverStrip({ x: 50, y: 40, caption, band: undefined }), false);
});

test("the band counts whole, and absent boxes never match", () => {
  const band = { left: 0, top: 30, right: 100, bottom: 60 };
  assert.equal(pointOverStrip({ x: 50, y: 45, caption: undefined, band }), true);
  assert.equal(pointOverStrip({ x: 50, y: 65, caption: undefined, band }), false);
  // An undrawn element still has a box; the caller withholds it, and a strip
  // offering neither can never read as hovered.
  assert.equal(pointOverStrip({ x: 50, y: 45, caption: undefined, band: undefined }), false);
});
