import assert from "node:assert/strict";
import test from "node:test";
import type { SpeechVoicesAnswer } from "#shared/contracts";
import { SPEECH_VOICES_STATE, speechVoicesView } from "./speech-voices";

const ADA = { id: "v1", name: "Ada" };
const BEE = { id: "v2", name: "Bee" };

function answer(overrides: Partial<SpeechVoicesAnswer> = {}): SpeechVoicesAnswer {
  return { voices: [ADA, BEE], ...overrides };
}

test("says where a key goes before it offers anything to choose", () => {
  const view = speechVoicesView({
    connected: false,
    loading: false,
    answer: answer(),
    selected: ADA.id,
  });
  assert.equal(view.state, SPEECH_VOICES_STATE.DISCONNECTED);
  assert.deepEqual(view.voices, []);
  assert.match(view.note ?? "", /ElevenLabs key/);
});

test("a refresh under way is a refresh, whatever the last answer said", () => {
  const view = speechVoicesView({
    connected: true,
    loading: true,
    answer: answer({
      voices: [],
      explanation: "refused",
    }),
    selected: undefined,
  });
  assert.equal(view.state, SPEECH_VOICES_STATE.LOADING);
  assert.equal(view.note, undefined);

  // Nothing read yet reads the same way: the page waits rather than drawing an
  // empty account that has never been asked.
  assert.equal(
    speechVoicesView({ connected: true, loading: false, answer: undefined, selected: undefined })
      .state,
    SPEECH_VOICES_STATE.LOADING,
  );
});

test("a failed read draws its own sentence and no list", () => {
  const view = speechVoicesView({
    connected: true,
    loading: false,
    answer: {
      voices: [],
      explanation: "ElevenLabs refused the key.",
    },
    selected: ADA.id,
  });
  assert.equal(view.state, SPEECH_VOICES_STATE.FAILED);
  assert.deepEqual(view.voices, []);
  assert.equal(view.note, "ElevenLabs refused the key.");
  assert.equal(view.selectionMissing, false);
});

test("an account with no personal voices is sent to make one", () => {
  const view = speechVoicesView({
    connected: true,
    loading: false,
    answer: answer({ voices: [] }),
    selected: undefined,
  });
  assert.equal(view.state, SPEECH_VOICES_STATE.EMPTY);
  assert.match(view.note ?? "", /Instant Voice Clone/);
});

test("offers what the account holds, and says nothing extra while the choice stands", () => {
  const view = speechVoicesView({
    connected: true,
    loading: false,
    answer: answer(),
    selected: BEE.id,
  });
  assert.equal(view.state, SPEECH_VOICES_STATE.READY);
  assert.deepEqual(view.voices, [ADA, BEE]);
  assert.equal(view.selectionMissing, false);
  assert.equal(view.note, undefined);
});

test("a chosen voice gone from the account is said rather than swapped", () => {
  const view = speechVoicesView({
    connected: true,
    loading: false,
    answer: answer({ voices: [BEE] }),
    selected: ADA.id,
  });
  assert.equal(view.state, SPEECH_VOICES_STATE.READY);
  assert.equal(view.selectionMissing, true);
  assert.match(view.note ?? "", /no longer in this account/);
  // The list is still the account's own: the developer picks the replacement.
  assert.deepEqual(view.voices, [BEE]);
});

test("nothing chosen yet is not a missing choice", () => {
  const view = speechVoicesView({
    connected: true,
    loading: false,
    answer: answer(),
    selected: undefined,
  });
  assert.equal(view.selectionMissing, false);
});
