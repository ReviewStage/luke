import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_DEFAULTS, REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/core";
import {
  currentQuota,
  fresherQuota,
  hostedVoiceNote,
  hostedVoiceSpentNote,
  microphoneAccessRow,
  quotaResetsInWords,
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

test("the fresher of two quota readings is decided from the readings themselves", () => {
  const DAY_END = 1_800_003_600_000;
  const older = { used: 3, limit: 50, remaining: 47, resetsAt: DAY_END };
  const newerSameDay = { used: 10, limit: 50, remaining: 40, resetsAt: DAY_END };
  const nextDay = { used: 0, limit: 50, remaining: 50, resetsAt: DAY_END + 86_400_000 };

  // Within one day the smaller remainder is the newer fact; across days the
  // later reset wins — yesterday's spent counter must not outrank a fresh day.
  assert.equal(fresherQuota(older, newerSameDay), newerSameDay);
  assert.equal(fresherQuota(newerSameDay, older), newerSameDay);
  assert.equal(fresherQuota(newerSameDay, nextDay), nextDay);
  assert.equal(fresherQuota(undefined, older), older);
  assert.equal(fresherQuota(older, undefined), older);
  assert.equal(fresherQuota(undefined, undefined), undefined);
});

test("the reset is worded at the coarseness a daily counter earns", () => {
  const now = 1_800_000_000_000;
  assert.equal(quotaResetsInWords(now + 30_000, now), "in under a minute");
  assert.equal(quotaResetsInWords(now + 25 * 60_000, now), "in about 25 minutes");
  assert.equal(quotaResetsInWords(now + 70 * 60_000, now), "in about an hour");
  assert.equal(quotaResetsInWords(now + 7 * 3_600_000, now), "in about 7 hours");
});

test("the spent sentence says when voice returns, at whatever precision is in hand", () => {
  assert.equal(
    hostedVoiceSpentNote("in about 7 hours"),
    "Voice is used up — back in about 7 hours.",
  );
  assert.equal(hostedVoiceSpentNote(), "Voice is used up — back at midnight UTC.");
});

test("the numberless note stays short, and withholds the key from a machine that cannot store one", () => {
  // Before any numbers are in hand, the note promises the allowance and
  // offers the key row directly below it.
  assert.equal(
    hostedVoiceNote(undefined),
    "Voice and session review are included with your account. Your own OpenAI key below lifts the limits.",
  );

  // Only the minter's last outcome can speak here — a spent allowance is a
  // state with its own return, not an error.
  const spent = hostedVoiceNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED }),
  );
  assert.match(spent, /used up — back at midnight UTC/);

  const locked = hostedVoiceNote(undefined, { offersKey: false });
  assert.doesNotMatch(locked, /OpenAI key/);
});

test("a reading past its own reset is no reading, and a stale spent outcome goes quiet", () => {
  const now = 1_800_000_000_000;
  const running = { used: 50, limit: 50, remaining: 0, resetsAt: now + 3_600_000 };
  const expired = { used: 50, limit: 50, remaining: 0, resetsAt: now - 1 };

  assert.equal(currentQuota(running, now), running);
  assert.equal(currentQuota(expired, now), undefined);
  assert.equal(currentQuota(undefined, now), undefined);

  // Yesterday's refusal, dated by its own expired quota, describes an
  // allowance that no longer exists — the fresh day promises numbers again.
  const rolled = hostedVoiceNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED, quota: expired }),
    { now },
  );
  assert.doesNotMatch(rolled, /used up/);
  assert.match(rolled, /included with your account/);

  // Still inside its day, the refusal stands.
  const standing = hostedVoiceNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED, quota: running }),
    { now },
  );
  assert.match(standing, /used up/);
});
