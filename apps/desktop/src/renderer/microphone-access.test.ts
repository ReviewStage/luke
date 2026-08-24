import assert from "node:assert/strict";
import test from "node:test";
import {
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeDiagnostics,
} from "@sidecar/realtime";
import { VOICE_SOURCE } from "#shared/wire/settings";
import {
  currentQuota,
  fresherQuota,
  HOSTED_METER_LABEL,
  hostedVoiceReading,
  hostedVoiceSpentNote,
  microphoneAccessRow,
  QUOTA_LEVEL,
  quotaLevel,
  quotaResetsWhen,
  VOICE_SOURCE_DETAIL,
  VOICE_SOURCE_LABEL,
  voiceAttentionNote,
  voiceQuotaSpentNote,
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
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // as today, and the counters turn over at midnight UTC — somebody else's
  // clock, and never the reader's.
  const nextDay = new Date(now);
  nextDay.setDate(nextDay.getDate() + 1);
  assert.equal(quotaResetsWhen(nextDay.getTime(), now), `tomorrow at ${clock(nextDay.getTime())}`);
});

test("the spent sentence says when voice returns, on the reader's own clock", () => {
  assert.match(hostedVoiceSpentNote("at 5:00 PM"), /Back at 5:00 PM/);
  // With no reading in hand, the day boundary every counter shares.
  assert.match(hostedVoiceSpentNote(), /Back at midnight UTC/);
  // Plain sentences, because the note also lands where a reply would have —
  // under the ask field — where dash-spliced prose reads as an error code.
  assert.doesNotMatch(hostedVoiceSpentNote("at 5:00 PM"), /—/);
});

test("one reading serves every spent-day surface, and only a hosted day has one", () => {
  const now = 1_800_000_000_000;
  const usage = { used: 49, limit: 50, remaining: 1, resetsAt: now + 3_600_000 };
  const minted = { used: 50, limit: 50, remaining: 0, resetsAt: now + 3_600_000 };

  // The mint's fresher reading wins over a usage read held from earlier.
  assert.equal(hostedVoiceReading({ hosted: true, usage, minted, now }), minted);
  // Voice on a key has no meter, whatever readings are still lying around.
  assert.equal(hostedVoiceReading({ hosted: false, usage, minted, now }), undefined);
  // A reading past its own reset is no reading: the fresh day answers for itself.
  assert.equal(
    hostedVoiceReading({ hosted: true, usage: undefined, minted, now: minted.resetsAt + 1 }),
    undefined,
  );
  assert.equal(
    hostedVoiceReading({ hosted: true, usage: undefined, minted: undefined, now }),
    undefined,
  );
});

test("the moment-of-use note speaks only while a spent allowance is what is missing", () => {
  const now = 1_800_000_000_000;
  const running = { used: 50, limit: 50, remaining: 0, resetsAt: now + 3_600_000 };

  // A spent day inside its own window says when voice returns, on the quota
  // the refusal itself carried.
  const spent = voiceQuotaSpentNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED, quota: running }),
    now,
  );
  assert.ok(spent);
  assert.match(spent, /voice is spent/);
  assert.match(spent, /Back at/);

  // A refusal that carried no reading still says spent, with the shared
  // day boundary standing in for the missing clock.
  const unread = voiceQuotaSpentNote(
    diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED }),
    now,
  );
  assert.ok(unread);
  assert.match(unread, /midnight UTC/);

  // Any other outcome is not a spent allowance, and yesterday's refusal is
  // no longer one either — the fresh day has an allowance again.
  assert.equal(voiceQuotaSpentNote(undefined, now), undefined);
  assert.equal(
    voiceQuotaSpentNote(diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.NO_API_KEY }), now),
    undefined,
  );
  const expired = { used: 50, limit: 50, remaining: 0, resetsAt: now - 1 };
  assert.equal(
    voiceQuotaSpentNote(
      diagnostics({ lastOutcome: REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED, quota: expired }),
      now,
    ),
    undefined,
  );
});

test("the toggle names both sources and explains each one", () => {
  for (const source of [VOICE_SOURCE.ACCOUNT, VOICE_SOURCE.KEY]) {
    assert.ok(VOICE_SOURCE_LABEL[source].length > 0, source);
    assert.ok(VOICE_SOURCE_DETAIL[source].length > 0, source);
    assert.equal(voiceSourceLabel(source), VOICE_SOURCE_LABEL[source]);
  }
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

test("a reading past its own reset is no reading", () => {
  const now = 1_800_000_000_000;
  const running = { used: 50, limit: 50, remaining: 0, resetsAt: now + 3_600_000 };
  const expired = { used: 50, limit: 50, remaining: 0, resetsAt: now - 1 };

  // A spent yesterday must not draw itself over a fresh day's allowance.
  assert.equal(currentQuota(running, now), running);
  assert.equal(currentQuota(expired, now), undefined);
  assert.equal(currentQuota(undefined, now), undefined);
});

test("the meters name what the key is spent on, in the developer's terms", () => {
  // The service's own words for these are "realtime" and "responses", which
  // say nothing to someone deciding whether to spend the rest of a day's
  // allowance on talking or on having sessions read.
  assert.match(HOSTED_METER_LABEL.VOICE, /talking/i);
  assert.match(HOSTED_METER_LABEL.REVIEWS, /sessions/i);
});
