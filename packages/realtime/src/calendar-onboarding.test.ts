import assert from "node:assert/strict";
import test from "node:test";
import { isRecord, isWireString } from "@sidecar/wire";
import {
  ARRIVAL_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  calendarOnboardingSpeechEvents,
  isCalendarOnboardingSpeech,
} from "./realtime-protocol.js";

test("the beat is one marker item and one tool-free response, fixed by the build", () => {
  const events = calendarOnboardingSpeechEvents();
  assert.equal(events.length, 2);
  const [item, response] = events;
  assert.ok(item && response);
  // No observed value exists to travel: the item is the bare marker.
  assert.ok(JSON.stringify(item).includes("[calendar note]"));
  const responseBody = response.response;
  assert.ok(isRecord(responseBody));
  assert.equal(responseBody.tool_choice, "none");
  const instructions = responseBody.instructions;
  assert.ok(isWireString(instructions));
  assert.ok(instructions.includes("never titles or attendees"));
});

test("the guard tells the onboarding beat from the arrival's", () => {
  assert.equal(
    isCalendarOnboardingSpeech({ kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: 1 }),
    true,
  );
  assert.equal(isCalendarOnboardingSpeech({ kind: ARRIVAL_SPEECH_KIND, decidedAt: 1 }), false);
});
