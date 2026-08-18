import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_DEFAULTS, REALTIME_MINT_OUTCOME, type RealtimeDiagnostics } from "@sidecar/core";
import {
  currentQuota,
  fresherQuota,
  hostedVoiceNote,
  hostedVoiceSpentNote,
  microphoneAccessRow,
  QUOTA_LEVEL,
  quotaLevel,
  quotaResetsWhen,
  VOICE_SOURCE_DETAIL,
  VOICE_SOURCE_LABEL,
  VOICE_SOURCE_PRICE,
  voiceAttentionNote,
  voiceSourceLabel,
} from "../src/renderer/microphone-access";
import { VOICE_SOURCE } from "../src/shared/contracts";

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

test("the reset is worded on the reader's own clock, and says tomorrow when it is", () => {
  const now = 1_800_000_000_000;
  const clock = (at: number) =>
    new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  // Inside the same local day, the hour alone is unambiguous.
  const soon = now + 60_000;
  assert.equal(quotaResetsWhen(soon, now), `at ${clock(soon)}`);

  // A reset landing on the next local date has to say so: a bare time reads
  // as today, and the counters turn over at midnight UTC — somebody else's
  // clock, and never the reader's.
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  assert.equal(quotaResetsWhen(nextDay.getTime(), now), `tomorrow at ${clock(nextDay.getTime())}`);
});

test("the spent sentence answers whether Luke is broken before it says when voice returns", () => {
  const spent = hostedVoiceSpentNote("at 5:00 PM");
  // The return, on the reader's own clock…
  assert.match(spent, /back at 5:00 PM/);
  // …and the reassurance the question is actually about: observation is local
  // and unmetered, so the rows keep moving whatever the talking has cost.
  assert.match(spent, /keeps watching your sessions/);
  // With no reading in hand, the day boundary every counter shares.
  assert.match(hostedVoiceSpentNote(), /back at midnight UTC/);
});

test("the numberless note stays short, and withholds the key from a machine that cannot store one", () => {
  // Before any numbers are in hand, the note promises the allowance — free,
  // and daily — and nothing else.
  assert.equal(
    hostedVoiceNote(undefined),
    "Talking and session checks are included free with your account, up to a daily amount.",
  );

  // What a key of the developer's own would change is the toggle's to say,
  // drawn directly above with the price on its face. A sentence here repeating
  // it would be the panel selling one half of a choice it is already showing
  // whole.
  assert.doesNotMatch(hostedVoiceNote(undefined), /OpenAI/);

  // Only the minter's last outcome can speak here — a spent allowance is a
  // state with its own return, not an error.
  const spent = hostedVoiceNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED }),
  );
  assert.match(spent, /used today's free voice — back at midnight UTC/);
});

test("the toggle names both sources and what each one costs", () => {
  // Each half carries its own name, its own price, and one line saying what
  // running on it is like. A half missing any of the three is a choice made
  // blind — and the dropdown beneath does not repeat them, so the toggle is
  // where the whole comparison has to live.
  for (const source of [VOICE_SOURCE.ACCOUNT, VOICE_SOURCE.KEY]) {
    assert.ok(VOICE_SOURCE_LABEL[source].length > 0, source);
    assert.ok(VOICE_SOURCE_PRICE[source].length > 0, source);
    assert.ok(VOICE_SOURCE_DETAIL[source].length > 0, source);
    // The spoken name folds the price in, because a control read aloud as
    // "your OpenAI key" alone withholds the one fact worth knowing first.
    assert.match(voiceSourceLabel(source), /\(free\)|\(you pay\)/);
  }

  // Free is free and the key is not: the two prices must never read the same.
  assert.notEqual(VOICE_SOURCE_PRICE[VOICE_SOURCE.ACCOUNT], VOICE_SOURCE_PRICE[VOICE_SOURCE.KEY]);
});

test("a meter warns while there is still something left to spend differently", () => {
  const day = { limit: 50, resetsAt: 1_800_003_600_000 };
  const at = (remaining: number) => ({ ...day, remaining, used: day.limit - remaining });

  // Running, most of the day.
  assert.equal(quotaLevel(at(50)), QUOTA_LEVEL.RUNNING);
  assert.equal(quotaLevel(at(11)), QUOTA_LEVEL.RUNNING);
  // The last fifth is the warning, and it arrives with ten calls still in
  // hand — a ceiling nobody saw coming is the thing a meter exists to stop.
  assert.equal(quotaLevel(at(10)), QUOTA_LEVEL.LOW);
  assert.equal(quotaLevel(at(1)), QUOTA_LEVEL.LOW);
  assert.equal(quotaLevel(at(0)), QUOTA_LEVEL.SPENT);

  // One fraction, both meters: the review ceiling is ten times the voice one,
  // and warns at the same stretch of its own day rather than at a count
  // copied from the other.
  const reviews = { limit: 500, resetsAt: day.resetsAt };
  assert.equal(quotaLevel({ ...reviews, remaining: 101, used: 399 }), QUOTA_LEVEL.RUNNING);
  assert.equal(quotaLevel({ ...reviews, remaining: 100, used: 400 }), QUOTA_LEVEL.LOW);

  // A meter with no ceiling has nothing to say, which is not the same as
  // having nothing left: it must not sit there warning about nothing.
  assert.equal(
    quotaLevel({ limit: 0, remaining: 3, used: 0, resetsAt: day.resetsAt }),
    QUOTA_LEVEL.RUNNING,
  );
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
  assert.doesNotMatch(rolled, /used today's free voice/);
  assert.match(rolled, /included free with your account/);

  // Still inside its day, the refusal stands.
  const standing = hostedVoiceNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED, quota: running }),
    { now },
  );
  assert.match(standing, /used today's free voice/);
});
