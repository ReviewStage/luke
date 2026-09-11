import assert from "node:assert/strict";
import { maximumTypedAskLength } from "@sidecar/session";
import type { WireValue } from "@sidecar/wire";
import { test } from "vitest";
import { ONE_ACT_OF_EACH_KIND } from "../../testing/acts";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS, type ActKind, isActOutcome, parsedAct } from "./acts";

const IDENTITY = { providerId: "claude-code", providerSessionId: "session-a" };

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

test("a session act names one session by the identity its provider reported", () => {
  const open = (identity: WireValue) =>
    parsedAct({ kind: ACT_KIND.SESSION_OPEN, payload: { identity } });
  assert.ok(open(IDENTITY));
  assert.equal(open({ providerId: "claude-code" }), undefined);
  assert.equal(open({ providerId: "nope", providerSessionId: "session-a" }), undefined);
  assert.equal(open({ ...IDENTITY, providerSessionId: "" }), undefined);
  assert.equal(open("session-a"), undefined);
  // An app id outside the four this build opens is refused.
  assert.ok(
    parsedAct({
      kind: ACT_KIND.SESSION_OPEN_APPLICATION,
      payload: { identity: IDENTITY, applicationId: "chatgpt" },
    }),
  );
  assert.equal(
    parsedAct({
      kind: ACT_KIND.SESSION_OPEN_APPLICATION,
      payload: { identity: IDENTITY, applicationId: "terminal" },
    }),
    undefined,
  );
});

test("a row's write names one observed session and carries its words or its control id", () => {
  const send = (payload: WireValue) => parsedAct({ kind: ACT_KIND.SESSION_SEND_MESSAGE, payload });
  assert.ok(send({ identity: IDENTITY, text: "please add a test" }));
  // The message is the developer's own words, refused where no bound could
  // admit them: nothing at all, or past the message bound the host applies.
  assert.equal(send({ identity: IDENTITY, text: "   " }), undefined);
  assert.equal(
    send({ identity: IDENTITY, text: "x".repeat(maximumTypedAskLength + 1) }),
    undefined,
  );
  assert.equal(send({ identity: IDENTITY }), undefined);
  assert.equal(
    send({ identity: { providerId: "nope", providerSessionId: "s" }, text: "hi" }),
    undefined,
  );
  // A route or an address never rides the act: the host reads the session's
  // own route back out of its roster.
  assert.equal(send({ identity: IDENTITY, text: "hi", link: "https://example.test" }), undefined);

  const press = (payload: WireValue) =>
    parsedAct({ kind: ACT_KIND.SESSION_EXECUTE_CONTROL, payload });
  assert.ok(press({ identity: IDENTITY, controlId: "cancel-run" }));
  // The id is admitted as the roster spelled it, so a padded or empty one
  // names no advertised control.
  assert.equal(press({ identity: IDENTITY, controlId: "" }), undefined);
  assert.equal(press({ identity: IDENTITY, controlId: 7 }), undefined);
  assert.equal(press({ identity: IDENTITY }), undefined);
  assert.equal(
    press({ identity: IDENTITY, controlId: "cancel-run", control: { id: "archive" } }),
    undefined,
  );
});

test("a brain ask is one submission with an id, bounded words, and an origin", () => {
  const submit = (submission: WireValue) =>
    parsedAct({ kind: ACT_KIND.BRAIN_SUBMIT_ASK, payload: { submission } });
  const submission = { submissionId: "sub-1", question: "what needs me?", origin: "typed" };
  assert.ok(submit(submission));
  assert.ok(submit({ ...submission, origin: "spoken" }));
  assert.ok(submit({ ...submission, question: "x".repeat(maximumTypedAskLength) }));
  assert.equal(
    submit({ ...submission, question: "x".repeat(maximumTypedAskLength + 1) }),
    undefined,
  );
  assert.equal(submit({ ...submission, submissionId: "" }), undefined);
  assert.equal(submit({ ...submission, origin: "dreamt" }), undefined);
  assert.equal(submit("what needs me?"), undefined);
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
  for (const command of ["stop-speaking", "request-microphone-access", "clear-conversation"]) {
    assert.ok(parsedAct({ kind: ACT_KIND.VOICE_COMMAND, payload: { command } }));
  }
  // A typed ask is a brain submission, not a command to the voice window.
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
  assert.equal(ACT[ACT_KIND.SUPERSET_DISCONNECT].result({ status: "accepted" }), true);
  assert.equal(ACT[ACT_KIND.SUPERSET_DISCONNECT].result({ status: "rejected" }), false);
  assert.equal(
    ACT[ACT_KIND.BRAIN_SUBMIT_ASK].result({ outcome: "accepted", runId: "run-1", acceptedAt: 1 }),
    true,
  );
  assert.equal(
    ACT[ACT_KIND.BRAIN_SUBMIT_ASK].result({ outcome: "rejected", reason: "tired" }),
    false,
  );
  assert.equal(
    ACT[ACT_KIND.VOICE_CREATE_LIVE_SESSION].result({ sessionId: "sess_1", sdpAnswer: "v=0\r\n" }),
    true,
  );
  assert.equal(ACT[ACT_KIND.VOICE_CREATE_LIVE_SESSION].result(undefined), true);
  assert.equal(ACT[ACT_KIND.VOICE_CREATE_LIVE_SESSION].result({ sessionId: "sess_1" }), false);
  assert.equal(ACT[ACT_KIND.BRAIN_CANCEL_ASK].result(undefined), true);
  assert.equal(ACT[ACT_KIND.BRAIN_CANCEL_ASK].result({ runId: "run-1" }), false);
  assert.equal(ACT[ACT_KIND.VOICE_COMMAND].result("accepted"), true);
  assert.equal(ACT[ACT_KIND.VOICE_COMMAND].result("sent"), false);
});
