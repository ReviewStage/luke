import assert from "node:assert/strict";
import type { WireValue } from "@sidecar/wire";
import { test } from "vitest";
import { ONE_ACT_OF_EACH_KIND } from "../../testing/acts";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS, type ActKind, isActOutcome, parsedAct } from "./acts";

const KINDS: readonly ActKind[] = Object.values(ACT_KIND);

/** A value no kind's payload takes: not absent, not a record, not a text a field would hold. */
const SOMETHING_NO_PAYLOAD_IS = [1, 2, 3];

test("every kind has one row, and that row says all three things", () => {
  assert.deepEqual(Object.keys(ACT).sort(), [...KINDS].sort());
  for (const kind of KINDS) {
    const declared = ACT[kind];
    // The row says three things and nothing else, its parser really parses,
    // and its refusal is a sentence. What each guard admits is its own test.
    assert.deepEqual(Object.keys(declared).sort(), ["payload", "refusal", "result"], kind);
    assert.equal(declared.payload.read(SOMETHING_NO_PAYLOAD_IS).ok, false, kind);
  }
  // A kind's name is what a channel carries, so no two kinds may share one.
  assert.equal(new Set(KINDS).size, KINDS.length);
});

test("one act of every kind is admitted, and read back as it was sent", () => {
  for (const kind of KINDS) {
    const sent = ONE_ACT_OF_EACH_KIND[kind];
    assert.deepEqual(parsedAct(sent), sent, kind);
  }
});

test("an envelope that is not one act of a named kind is refused whole", () => {
  assert.equal(parsedAct(undefined), undefined);
  assert.equal(parsedAct("session.open"), undefined);
  assert.equal(parsedAct({}), undefined);
  assert.equal(parsedAct({ kind: "session.reopen" }), undefined);
  // A key beside the two the envelope has is a shape this build does not know.
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_QUIT, sender: "panel" }), undefined);
  // A payload sent to a kind that takes none, and a kind that takes one sent none.
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_QUIT, payload: { now: true } }), undefined);
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT }), undefined);
  // A payload its own schema refuses is refused here.
  assert.equal(parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: 3 } }), undefined);
  assert.equal(
    parsedAct({ kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "x", extra: 1 } }),
    undefined,
  );
});

test("the live session acts carry the peer's offer verbatim, a transport state the peer connection names, and one boolean", () => {
  const offer = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
  const create = parsedAct({ kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION, payload: { sdp: offer } });
  assert.deepEqual(create, { kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION, payload: { sdp: offer } });
  assert.equal(
    parsedAct({ kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION, payload: { sdp: "" } }),
    undefined,
  );
  assert.equal(parsedAct({ kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION }), undefined);
  const transport = (state: WireValue) =>
    parsedAct({ kind: ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT, payload: { state } });
  for (const state of ["connecting", "connected", "disconnected", "failed", "closed"]) {
    assert.ok(transport(state), state);
  }
  assert.equal(transport("new"), undefined);
  assert.equal(transport(1), undefined);
  const activity = (idle: WireValue) =>
    parsedAct({ kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY, payload: { idle } });
  assert.ok(activity(true));
  assert.ok(activity(false));
  assert.equal(activity("yes"), undefined);
  assert.equal(parsedAct({ kind: ACT_KIND.VOICE_END_LIVE_SESSION, payload: {} }), undefined);
  assert.deepEqual(parsedAct({ kind: ACT_KIND.VOICE_STOP_SPEAKING }), {
    kind: ACT_KIND.VOICE_STOP_SPEAKING,
  });
  assert.equal(parsedAct({ kind: ACT_KIND.VOICE_STOP_SPEAKING, payload: {} }), undefined);
});

test("a voice command is one of the three commands and carries nothing else", () => {
  for (const command of ["stop-speaking", "end-call", "request-microphone-access"]) {
    assert.ok(parsedAct({ kind: ACT_KIND.VOICE_COMMAND, payload: { command } }));
  }
  // Nothing typed is a command to the voice window: Luke is voice only.
  assert.equal(
    parsedAct({ kind: ACT_KIND.VOICE_COMMAND, payload: { command: "ask-text" } }),
    undefined,
  );
  assert.equal(
    parsedAct({ kind: ACT_KIND.VOICE_COMMAND, payload: { command: "stop-speaking", words: "x" } }),
    undefined,
  );
});

test("a settings write carries a value its own field admits, parsed for the row", () => {
  const update = (field: WireValue, value: WireValue) =>
    parsedAct({ kind: ACT_KIND.SETTING_UPDATE, payload: { field, value } });
  assert.ok(update("openAtLogin", true));
  assert.equal(update("openAtLogin", "yes"), undefined);
  assert.equal(update("notASetting", true), undefined);
  // A keyed field has its own kind; the plain write refuses it.
  assert.equal(update("workspaceProjectDefaults", "luke"), undefined);
  // The value the row is handed is the one the field's schema admitted, so a
  // guard that normalizes is the only reading of it there is.
  const parsed = parsedAct({
    kind: ACT_KIND.SETTING_UPDATE,
    payload: { field: "voiceHotkey", value: "  Alt+Space  " },
  });
  assert.ok(parsed && "payload" in parsed);
  assert.deepEqual(parsed.payload, { field: "voiceHotkey", value: "Alt+Space" });
  const entry = (field: WireValue, key: WireValue, value: WireValue) =>
    parsedAct({ kind: ACT_KIND.SETTING_UPDATE_ENTRY, payload: { field, key, value } });
  assert.ok(entry("workspaceProjectDefaults", "conductor", "luke"));
  // A keyed entry cleared is the key with no value at all.
  assert.ok(
    parsedAct({
      kind: ACT_KIND.SETTING_UPDATE_ENTRY,
      payload: { field: "workspaceProjectDefaults", key: "conductor" },
    }),
  );
  assert.equal(entry("openAtLogin", "conductor", "luke"), undefined);
  assert.equal(entry("workspaceProjectDefaults", "nowhere", "luke"), undefined);
});

test("an outcome is one of the three answers and nothing else", () => {
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }), true);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not now." }), true);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.DONE, value: null }), true);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.DONE, value: { mode: "compact" } }), true);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.DONE }), true);
  // A refusal is a sentence, and an outcome carries nothing beside its own two fields.
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.REFUSED }), false);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.REFUSED, reason: 3 }), false);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT, reason: "x" }), false);
  assert.equal(isActOutcome({ status: ACT_OUTCOME_STATUS.DONE, value: 1, reason: "x" }), false);
  assert.equal(isActOutcome({ status: "thrown", reason: "x" }), false);
  assert.equal(isActOutcome(undefined), false);
});

test("an answer's guard is the kind's own, so a shape another kind would take is refused", () => {
  assert.equal(
    ACT[ACT_KIND.VOICE_CREATE_LIVE_SESSION].result({ sessionId: "sess_1", sdpAnswer: "v=0\r\n" }),
    true,
  );
  assert.equal(ACT[ACT_KIND.VOICE_CREATE_LIVE_SESSION].result(undefined), true);
  assert.equal(ACT[ACT_KIND.VOICE_CREATE_LIVE_SESSION].result({ sessionId: "sess_1" }), false);
  assert.equal(ACT[ACT_KIND.PLANNING_SELECT].result(true), true);
  assert.equal(ACT[ACT_KIND.PLANNING_SELECT].result("opened"), false);
});
