import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_DEFAULTS, REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/core";
import {
  hostedVoiceNote,
  microphoneAccessRow,
  voiceAttentionNote,
} from "../src/renderer/microphone-access";

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
  assert.match(offered.detail, /talk key/);

  // The macOS prompt is where someone agrees to their voice reaching OpenAI.
  // Raising it for a feature that cannot run asks for that consent under a
  // premise that is not true, and leaves the permission granted for a use that
  // never happens.
  const unavailable = microphoneAccessRow({
    voiceAvailable: false,

    status: "not-determined",
  });
  assert.equal(unavailable.offerAccess, false);
  assert.ok(!unavailable.detail.includes("macOS will ask"));
  // The panel never draws this row while voice is off — the Voice page holds
  // the key row alone then — so the detail only has to stay honest, and it
  // names no other setting.
  assert.ok(!unavailable.detail.includes("OpenAI"));
});

test("a permission already granted is not a microphone in use", () => {
  assert.equal(microphoneAccessRow({ voiceAvailable: true, status: "granted" }).ready, true);
  // Granted before the key went away. Luke still cannot talk, so the row must
  // not report itself ready to listen.
  assert.equal(microphoneAccessRow({ voiceAvailable: false, status: "granted" }).ready, false);
});

test("every permission state says something of its own", () => {
  const states = ["not-determined", "granted", "denied", "restricted", "unknown"] as const;
  const details = new Set<string>();
  for (const status of states) {
    const row = microphoneAccessRow({ voiceAvailable: true, status });
    details.add(row.detail);
    // Only the two states someone can act on offer anything to press.
    assert.equal(row.offerAccess, status === "not-determined");
  }
  assert.equal(details.size, states.length, "no two states read the same");
});

test("System Settings is offered only where macOS has an answer to change", () => {
  // Granted or refused, the system holds a decision and that is the one place
  // it can be changed — including while Luke is withholding a grant that,
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

test("the usage read words both meters, and a spent voice reads the same from either source", () => {
  const usage = {
    voice: { used: 3, limit: 50, remaining: 47, resetsAt: 1_800_003_600_000 },
    attention: { used: 37, limit: 500, remaining: 463, resetsAt: 1_800_003_600_000 },
  };
  const counted = hostedVoiceNote(undefined, usage);
  assert.match(counted, /47 of 50 calls and 463 of 500 session reviews left today/);

  // The usage read outranks the quota a mint carried: it is fresher and it
  // counts the reviews the mint's own diagnostics never see.
  const both = hostedVoiceNote(
    diagnostics({ quota: { used: 10, limit: 50, remaining: 40, resetsAt: 1_800_003_600_000 } }),
    usage,
  );
  assert.match(both, /47 of 50 calls/);

  const spentByUsage = hostedVoiceNote(undefined, {
    ...usage,
    voice: { used: 50, limit: 50, remaining: 0, resetsAt: 1_800_003_600_000 },
  });
  assert.match(spentByUsage, /used up — it returns at midnight UTC/);

  // Yesterday's refusal must not outrank today's full allowance: the minter's
  // last outcome survives midnight, the fresh read decides.
  const rolledOver = hostedVoiceNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED }),
    usage,
  );
  assert.match(rolledOver, /47 of 50 calls/);
  assert.doesNotMatch(rolledOver, /used up/);

  // A machine that cannot store a key is not sent to go connect one.
  const locked = hostedVoiceNote(undefined, usage, { offersKey: false });
  assert.doesNotMatch(locked, /OpenAI key/);
  assert.match(locked, /left today\.$/);
});

test("the hosted note says whose allowance voice runs on, and what remains once known", () => {
  // Before any mint has answered, the note promises only the allowance.
  assert.match(
    hostedVoiceNote(undefined),
    /included with your Luke account, under a daily allowance/,
  );
  assert.match(hostedVoiceNote(undefined), /your own OpenAI key lifts the allowance/i);

  const counted = hostedVoiceNote(
    diagnostics({
      lastOutcome: REALTIME_MINT_OUTCOME.SUCCEEDED,
      quota: { used: 3, limit: 50, remaining: 47, resetsAt: 1_800_003_600_000 },
    }),
  );
  assert.match(counted, /47 of 50 calls left today/);

  // A spent allowance is a state with its own return time, not an error.
  const spent = hostedVoiceNote(
    diagnostics({
      lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED,
      quota: { used: 51, limit: 50, remaining: 0, resetsAt: 1_800_003_600_000 },
    }),
  );
  assert.match(spent, /used up — it returns at midnight UTC/);
  assert.doesNotMatch(spent, /left today/);
});
