import assert from "node:assert/strict";
import test from "node:test";
import {
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeDiagnostics,
} from "@sidecar/realtime";
import { VOICE_SOURCE } from "#shared/wire/settings";
import {
  HOSTED_VOICE_UNAVAILABLE_NOTE,
  hostedVoiceUnavailableNote,
  microphoneAccessRow,
  VOICE_SOURCE_DETAIL,
  VOICE_SOURCE_LABEL,
  voiceAttentionNote,
  voiceSourceLabel,
} from "./microphone-access";

/** A hosted diagnostics report with only what a test wants to vary. */
function diagnostics(overrides: Partial<RealtimeDiagnostics>): RealtimeDiagnostics {
  return {
    apiKeyConfigured: false,
    hosted: true,
    fixtureMode: false,
    model: REALTIME_DEFAULTS.MODEL,
    voice: REALTIME_DEFAULTS.VOICE,
    speed: REALTIME_DEFAULTS.SPEED,
    endpoint: "https://tryluke.dev/api/voice/mint",
    lastOutcome: REALTIME_MINT_OUTCOME.NOT_ATTEMPTED,
    ...overrides,
  };
}

test("access is offered only where it can be used", () => {
  const offered = microphoneAccessRow({
    voiceAvailable: true,

    status: "not-determined",
  });
  assert.equal(offered.offerAccess, true);
  // The button is the whole answer, so the row says nothing beside it.
  assert.equal(offered.detail, undefined);

  // The macOS prompt is where someone agrees to their voice reaching OpenAI.
  // Raising it for a feature that cannot run asks for that consent under a
  // premise that is not true, and leaves the permission granted for a use that
  // never happens.
  const unavailable = microphoneAccessRow({
    voiceAvailable: false,

    status: "not-determined",
  });
  assert.equal(unavailable.offerAccess, false);
  // The panel never draws this row while voice is off — the Voice page holds
  // the key row alone then — so there is nothing for it to say.
  assert.equal(unavailable.detail, undefined);
});

test("a permission already granted is not a microphone in use", () => {
  assert.equal(microphoneAccessRow({ voiceAvailable: true, status: "granted" }).ready, true);
  // Granted before the key went away. Luke still cannot talk, so the row must
  // not report itself ready to listen.
  assert.equal(microphoneAccessRow({ voiceAvailable: false, status: "granted" }).ready, false);
});

test("only a state the developer must act on, or cannot, says anything", () => {
  // A granted microphone is already drawn as granted, and the state before
  // macOS has been asked carries the Allow button instead. What is left is the
  // one state with somewhere to go and the two with nowhere.
  const speaking = ["denied", "restricted", "unknown"] as const;
  const silent = ["granted", "not-determined"] as const;
  const details = new Set<string>();
  for (const status of speaking) {
    const row = microphoneAccessRow({ voiceAvailable: true, status });
    assert.ok(row.detail, `${status} says why`);
    details.add(row.detail);
  }
  assert.equal(details.size, speaking.length, "no two states read the same");
  for (const status of silent) {
    assert.equal(microphoneAccessRow({ voiceAvailable: true, status }).detail, undefined, status);
  }
  // Only the state someone can answer offers anything to press.
  for (const status of [...speaking, ...silent]) {
    const row = microphoneAccessRow({ voiceAvailable: true, status });
    assert.equal(row.offerAccess, status === "not-determined");
  }
});

test("System Settings is offered only where macOS has an answer to change", () => {
  // Granted or refused, the system holds a decision and that is the one place
  // it can be changed — including while Luke is withholding a grant that,
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // as far as macOS is concerned, it still has.
  for (const status of ["granted", "denied"] as const) {
    const row = microphoneAccessRow({ voiceAvailable: true, status });
    assert.equal(row.offerSystemSettings, true, `${status} is worth a trip`);
  }
  assert.equal(
    microphoneAccessRow({ voiceAvailable: true, status: "granted" }).offerSystemSettings,
    true,
  );

  // Never asked, so there is nothing there yet to look at.
  assert.equal(
    microphoneAccessRow({ voiceAvailable: true, status: "not-determined" }).offerSystemSettings,
    false,
  );
  // And nothing about a microphone Luke has no use for.
  assert.equal(
    microphoneAccessRow({ voiceAvailable: false, status: "granted" }).offerSystemSettings,
    false,
  );
});

test("the Voice row's mark stands while either half of voice is missing", () => {
  // The key first: without one the microphone is not worth asking for, so the
  // mark names the key even while the permission is also ungranted.
  const keyless = voiceAttentionNote({ voiceAvailable: false, status: "not-determined" });
  assert.ok(keyless);
  assert.match(keyless, /OpenAI key/);
  assert.equal(
    voiceAttentionNote({ voiceAvailable: false, status: "granted" }),
    keyless,
    "a granted microphone does not quiet a missing key",
  );

  // Key connected: every state but granted is a microphone Luke cannot open.
  for (const status of ["not-determined", "denied", "restricted", "unknown"] as const) {
    const note = voiceAttentionNote({ voiceAvailable: true, status });
    assert.ok(note, `${status} still needs a hand`);
    assert.match(note, /microphone/);
  }

  // Both halves met is the one quiet state.
  assert.equal(voiceAttentionNote({ voiceAvailable: true, status: "granted" }), undefined);
});

test("the mark and the row agree on what ready means", () => {
  // The mark is drawn exactly while the row would not report itself ready:
  // one judgement, read twice, so the front page and the Voice page never
  // disagree about whether voice still needs a hand.
  for (const voiceAvailable of [true, false]) {
    for (const status of [
      "not-determined",
      "granted",
      "denied",
      "restricted",
      "unknown",
    ] as const) {
      const row = microphoneAccessRow({ voiceAvailable, status });
      const note = voiceAttentionNote({ voiceAvailable, status });
      assert.equal(note === undefined, row.ready, `${voiceAvailable}/${status}`);
    }
  }
});

test("the emergency ceiling is surfaced only as temporary unavailability", () => {
  assert.equal(
    hostedVoiceUnavailableNote(
      diagnostics({
        lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED,
        quota: { used: 5_001, limit: 5_000, remaining: 0, resetsAt: 1_800_003_600_000 },
      }),
    ),
    HOSTED_VOICE_UNAVAILABLE_NOTE,
  );
  assert.doesNotMatch(HOSTED_VOICE_UNAVAILABLE_NOTE, /quota|limit|left|reset|allowance/i);
  assert.equal(hostedVoiceUnavailableNote(undefined), undefined);
  assert.equal(
    hostedVoiceUnavailableNote(diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.NO_API_KEY })),
    undefined,
  );
});

test("the toggle names both sources and explains each one", () => {
  for (const source of [VOICE_SOURCE.ACCOUNT, VOICE_SOURCE.KEY]) {
    assert.ok(VOICE_SOURCE_LABEL[source].length > 0, source);
    assert.ok(VOICE_SOURCE_DETAIL[source].length > 0, source);
    assert.equal(voiceSourceLabel(source), VOICE_SOURCE_LABEL[source]);
  }
  assert.doesNotMatch(Object.values(VOICE_SOURCE_DETAIL).join(" "), /daily|limit|allowance|quota/i);
});
