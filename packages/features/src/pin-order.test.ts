import assert from "node:assert/strict";
import { Schema as EffectSchema } from "effect";
import { describe, it } from "vitest";
import {
  inPinOrder,
  isPinPosition,
  PIN_POSITION_BOUNDS,
  type PinPlace,
  pinPositionSchema,
  pinPositionsForMove,
} from "./pin-order.js";

interface Pin extends PinPlace {
  readonly name: string;
}

const place = (pin: Pin): PinPlace => pin;

const names = (pins: readonly Pin[]) => pins.map((pin) => pin.name);

/** The pins with the positions a move answered written in, drawn again: what the section shows once they land. */
function afterMove(pins: readonly Pin[], from: number, to: number): Pin[] {
  const order = inPinOrder(pins, place);
  const positions = pinPositionsForMove(order, from, to, place);
  return inPinOrder(
    order.map((pin) => {
      const position = positions.get(pin);
      return position === undefined ? pin : { ...pin, position };
    }),
    place,
  );
}

describe("inPinOrder", () => {
  it("draws pins with no position newest pinned first, as the section always has", () => {
    const pins = [
      { name: "old", at: 1 },
      { name: "new", at: 3 },
      { name: "middle", at: 2 },
    ];
    assert.deepEqual(names(inPinOrder(pins, place)), ["new", "middle", "old"]);
  });

  it("draws positioned pins by plain code-unit order, upper case before lower", () => {
    const pins = [
      { name: "lower", at: 1, position: "a0" },
      { name: "upper", at: 2, position: "Zz" },
      { name: "later", at: 3, position: "a1" },
    ];
    assert.deepEqual(names(inPinOrder(pins, place)), ["upper", "lower", "later"]);
  });

  it("puts a pin made since the last drag on top of the positioned ones", () => {
    const pins = [
      { name: "first", at: 1, position: "a0" },
      { name: "second", at: 2, position: "a1" },
      { name: "fresh", at: 9 },
    ];
    assert.deepEqual(names(inPinOrder(pins, place)), ["fresh", "first", "second"]);
  });

  it("places a pin by its time where its position is not one the order can read", () => {
    const pins = [
      { name: "kept", at: 2, position: "a0" },
      { name: "garbled", at: 5, position: "not a key" },
    ];
    assert.deepEqual(names(inPinOrder(pins, place)), ["garbled", "kept"]);
  });
});

describe("pinPositionsForMove", () => {
  it("writes only the dropped pin's position where its new neighbours hold theirs", () => {
    const pins = [
      { name: "a", at: 1, position: "a0" },
      { name: "b", at: 2, position: "a1" },
      { name: "c", at: 3, position: "a2" },
    ];
    const order = inPinOrder(pins, place);
    const positions = pinPositionsForMove(order, 2, 0, place);
    assert.deepEqual(
      [...positions.keys()].map((pin) => pin.name),
      ["c"],
    );
    assert.deepEqual(names(afterMove(pins, 2, 0)), ["c", "a", "b"]);
  });

  it("gives every pin a position on the first drag, in the order drawn after the drop", () => {
    const pins = [
      { name: "old", at: 1 },
      { name: "middle", at: 2 },
      { name: "new", at: 3 },
    ];
    const moved = afterMove(pins, 0, 2);
    assert.deepEqual(names(moved), ["middle", "old", "new"]);
    assert.ok(moved.every((pin) => pin.position !== undefined));
  });

  it("keeps a drop where it was let go when a fresh pin stands beside positioned ones", () => {
    const pins = [
      { name: "first", at: 1, position: "a0" },
      { name: "second", at: 2, position: "a1" },
      { name: "fresh", at: 9 },
    ];
    assert.deepEqual(names(afterMove(pins, 0, 2)), ["first", "second", "fresh"]);
    assert.deepEqual(names(afterMove(pins, 2, 1)), ["fresh", "second", "first"]);
  });

  it("separates two pins that share a position, as two Macs pinning at once can leave them", () => {
    const pins = [
      { name: "one", at: 2, position: "a0" },
      { name: "two", at: 1, position: "a0" },
      { name: "three", at: 0, position: "a1" },
    ];
    assert.deepEqual(names(afterMove(pins, 2, 1)), ["one", "three", "two"]);
  });

  it("writes nothing for a drop where the pin already stood", () => {
    const pins = [
      { name: "a", at: 1, position: "a0" },
      { name: "b", at: 2, position: "a1" },
    ];
    assert.equal(pinPositionsForMove(inPinOrder(pins, place), 1, 1, place).size, 0);
  });

  it("holds every key within the bound however often a pin is dropped into the same gap", () => {
    let pins: Pin[] = [
      { name: "a", at: 1, position: "a0" },
      { name: "b", at: 2, position: "a1" },
      { name: "c", at: 3, position: "a2" },
    ];
    for (let drop = 0; drop < 400; drop += 1) pins = afterMove(pins, drop % 2 === 0 ? 2 : 1, 1);
    assert.ok(pins.every((pin) => (pin.position?.length ?? 0) <= PIN_POSITION_BOUNDS.MAX_CHARS));
    assert.equal(new Set(pins.map((pin) => pin.position)).size, pins.length);
  });
});

describe("pinPositionSchema", () => {
  it("takes a key the order minted and refuses one it could not place", () => {
    const decode = EffectSchema.decodeUnknownExit(pinPositionSchema);
    assert.equal(decode("a0V")._tag, "Success");
    assert.equal(decode("")._tag, "Failure");
    assert.equal(decode("a0 ")._tag, "Failure");
    assert.equal(isPinPosition("a".repeat(PIN_POSITION_BOUNDS.MAX_CHARS + 1)), false);
  });
});
