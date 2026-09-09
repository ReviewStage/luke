import assert from "node:assert/strict";
import test from "node:test";
import type { WireRecord } from "@sidecar/wire";
import { ToolFollowUp } from "./tool-follow-up";

/** The turn a follow-up is being answered into, as the call would hold it. */
class Harness {
  followUps = 0;
  epoch = 1;
  connected = true;
  readonly tools = new ToolFollowUp({
    epoch: () => this.epoch,
    connected: () => this.connected,
    openFollowUp: () => {
      this.followUps += 1;
    },
  });
}

/** The raw finished output item the SDK's call ids are learned from. */
function functionCallItem(responseId: string, callId: string): WireRecord {
  return {
    type: "response.output_item.done",
    response_id: responseId,
    item: { type: "function_call", call_id: callId },
  };
}

/** One reply arming one call, answered as far as the wire. */
function armOneCall(context: Harness, callId = "call-1"): void {
  context.tools.opened("resp-1");
  context.tools.observe(functionCallItem("resp-1", callId));
  context.tools.done({ responseId: "resp-1", callIds: [callId], fresh: true });
}

test("a reply the developer already talked over resumes nothing", () => {
  const context = new Harness();
  context.tools.opened("resp-1");

  assert.equal(
    context.tools.done({ responseId: "resp-2", callIds: ["call-1"], fresh: false }),
    false,
  );
  assert.equal(context.tools.holds, false);
});

test("a reply the server named nothing resumes nothing", () => {
  const context = new Harness();

  assert.equal(
    context.tools.done({ responseId: undefined, callIds: ["call-1"], fresh: true }),
    false,
  );
});

test("the turn holds while a follow-up is owed", () => {
  const context = new Harness();
  armOneCall(context);

  assert.equal(context.tools.holds, true);
});

test("the follow-up opens once every call's output has reached the wire", () => {
  const context = new Harness();
  context.tools.opened("resp-1");
  for (const callId of ["call-1", "call-2"]) {
    context.tools.observe(functionCallItem("resp-1", callId));
  }
  context.tools.done({ responseId: "resp-1", callIds: ["call-1", "call-2"], fresh: true });

  context.tools.outputSent("call-1");
  assert.equal(context.followUps, 0, "one answer is not every answer");

  context.tools.outputSent("call-2");
  assert.equal(context.followUps, 1);
  assert.equal(context.tools.holds, false);
});

test("the follow-up opens once, however often it is asked for", () => {
  const context = new Harness();
  armOneCall(context);

  context.tools.outputSent("call-1");
  context.tools.startIfReady();
  context.tools.startIfReady();

  assert.equal(context.followUps, 1);
});

test("a turn the developer took back opens no follow-up", () => {
  const context = new Harness();
  armOneCall(context);

  // The press bumps the epoch: the answer being written belongs to a turn
  // nobody is in, and Luke must not speak it over a live microphone.
  context.epoch += 1;
  context.tools.outputSent("call-1");

  assert.equal(context.followUps, 0);
});

test("a call with no connection left opens no follow-up", () => {
  const context = new Harness();
  armOneCall(context);

  context.connected = false;
  context.tools.outputSent("call-1");

  assert.equal(context.followUps, 0);
});

test("the call the turn armed is the turn's to answer", () => {
  const context = new Harness();
  armOneCall(context);

  assert.equal(context.tools.current("call-1"), true);
});

test("a call the turn never armed is refused", () => {
  const context = new Harness();
  armOneCall(context);

  assert.equal(context.tools.current("call-unknown"), false);
});

test("a superseded reply's late call is not the current turn's", () => {
  const context = new Harness();
  armOneCall(context, "call-old");

  // The developer talked over it, and the reply that replaced it was
  // confirmed: the old call's response is no longer the one standing.
  context.epoch += 1;
  context.tools.opened("resp-2");

  assert.equal(context.tools.current("call-old"), false);
});

test("a call answered out of the turn that asked is refused", () => {
  const context = new Harness();
  armOneCall(context);

  context.epoch += 1;

  assert.equal(context.tools.current("call-1"), false);
});

test("only a finished function call teaches the batch a call id", () => {
  const context = new Harness();
  context.tools.opened("resp-1");

  context.tools.observe({ type: "response.output_item.added", response_id: "resp-1" });
  context.tools.observe({
    type: "response.output_item.done",
    response_id: "resp-1",
    item: { type: "message" },
  });
  context.tools.observe({
    type: "response.output_item.done",
    item: { type: "function_call", call_id: "call-1" },
  });

  assert.equal(context.tools.current("call-1"), false);
});

test("the calls the parser never carried are still answered", () => {
  const context = new Harness();
  context.tools.opened("resp-1");
  // The parsed `response.done` names the calls; the raw item is what the
  // SDK's own bridge answers by, and both reach the same batch.
  context.tools.observe(functionCallItem("resp-1", "call-1"));
  context.tools.done({ responseId: "resp-1", callIds: [], fresh: true });

  context.tools.outputSent("call-1");

  assert.equal(context.followUps, 1);
});

test("a turn boundary spends whatever the last turn left owed", () => {
  const context = new Harness();
  armOneCall(context);

  context.tools.reset();

  assert.equal(context.tools.holds, false);
  assert.equal(context.tools.current("call-1"), false);
  context.tools.outputSent("call-1");
  assert.equal(context.followUps, 0);
});
