import assert from "node:assert/strict";
import { SCHEMA_REFUSAL, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Either } from "effect";
import { test } from "vitest";
import {
  decodeTurnEventFrame,
  encodeTurnEventFrame,
  TURN_END,
  TURN_EVENT_KIND,
  TURN_EVENT_STREAM,
  TURN_SLOW_STEP,
  type TurnEvent,
  turnEventCursorSchema,
  turnEventSchema,
} from "./turn-events-wire.js";

const TURN = "1a000000-0000-4000-8000-000000000003";

const EVENTS: readonly TurnEvent[] = [
  { turnId: TURN, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.TRANSCRIPT_READ },
  { turnId: TURN, seq: 2, kind: TURN_EVENT_KIND.ACTIONS_SETTLED },
  { turnId: TURN, seq: 3, kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence: "Two agents finished." },
  { turnId: TURN, seq: 4, kind: TURN_EVENT_KIND.ENDED, end: TURN_END.COMPLETED },
];

test("every kind of event reads back as itself", () => {
  for (const event of EVENTS) {
    assert.deepEqual(
      readEither(turnEventSchema)(unparsedWire(JSON.parse(JSON.stringify(event)))),
      Either.right(event),
    );
  }
});

test("a frame carries the event's number as its id and decodes to the same event", () => {
  for (const event of EVENTS) {
    const frame = encodeTurnEventFrame(event);
    assert.equal(frame.endsWith(TURN_EVENT_STREAM.FRAME_END), true);
    assert.deepEqual(decodeTurnEventFrame(frame), event);
  }
});

test("a heartbeat, a frame whose id disagrees with its event, and an unreadable frame decode to nothing", () => {
  assert.equal(decodeTurnEventFrame(TURN_EVENT_STREAM.HEARTBEAT_FRAME), undefined);
  const [first] = EVENTS;
  assert.ok(first);
  const frame = encodeTurnEventFrame(first).replace(`id: ${first.seq}`, `id: ${first.seq + 1}`);
  assert.equal(decodeTurnEventFrame(frame), undefined);
  assert.equal(decodeTurnEventFrame("data: not json\n\n"), undefined);
  assert.equal(decodeTurnEventFrame('data: {"kind":"other"}\n\n'), undefined);
});

test("an event outside the vocabulary is refused: an unnumbered one, a step kind no build names, an empty sentence, a turn id that is no uuid", () => {
  const refused = (value: WireBoundaryInput) =>
    Either.isLeft(readEither(turnEventSchema)(unparsedWire(value)));
  assert.equal(refused({ turnId: TURN, kind: TURN_EVENT_KIND.ACTIONS_SETTLED }), true);
  assert.equal(refused({ turnId: TURN, seq: 0, kind: TURN_EVENT_KIND.ACTIONS_SETTLED }), true);
  assert.equal(
    refused({ turnId: TURN, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: "coffee" }),
    true,
  );
  assert.equal(
    refused({ turnId: TURN, seq: 1, kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence: "" }),
    true,
  );
  assert.equal(refused({ turnId: "turn-1", seq: 1, kind: TURN_EVENT_KIND.ACTIONS_SETTLED }), true);
});

test("the cursor is a whole number from zero", () => {
  assert.deepEqual(readEither(turnEventCursorSchema)(unparsedWire(0)), Either.right(0));
  assert.deepEqual(readEither(turnEventCursorSchema)(unparsedWire(12)), Either.right(12));
  assert.equal(Either.isLeft(readEither(turnEventCursorSchema)(unparsedWire(-1))), true);
  const negative = readEither(turnEventCursorSchema)(unparsedWire(-1));
  assert.ok(Either.isLeft(negative));
  assert.equal(negative.left.refusal, SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(negative.left.path, []);
  assert.equal(Either.isLeft(readEither(turnEventCursorSchema)(unparsedWire(1.5))), true);
});
