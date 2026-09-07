import assert from "node:assert/strict";
import test from "node:test";
import type {
  BriefingSpeech,
  ProactiveSpeechTurn,
  RealtimeStatus,
  ScheduledTimer,
} from "@sidecar/realtime";
import {
  BRIEFING_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  isBriefingSpeech,
  REALTIME_STATUS,
} from "@sidecar/realtime";
import { SPEECH_OUTCOME, type SpeechOffer, type SpeechOutcome } from "#shared/wire/speech";
import {
  ANNOUNCER_GRACE_MS,
  ANNOUNCER_LINGER_MS,
  ANNOUNCER_RETRY_DELAY_MS,
  MAXIMUM_CONNECT_ATTEMPTS,
  SpeechMouth,
  type SpeechMouthSession,
} from "./speech-mouth";

const FAR_DEADLINE = Number.MAX_SAFE_INTEGER;

function speech(id: string, decidedAt = 1_000): BriefingSpeech {
  return {
    kind: BRIEFING_SPEECH_KIND,
    briefing: `Claude Code finished ${id}.`,
    decidedAt,
  };
}

function offer(id: string, turn: ProactiveSpeechTurn = speech(id), speakBy = FAR_DEADLINE) {
  return { id, speakBy, turn } satisfies SpeechOffer;
}

/** The ids the spoken briefings were worded about, in the order they were said. */
function spokenIds(session: FakeSession): string[] {
  return session.spoken.map((item) => /finished (.+)\.$/.exec(item.briefing)?.[1] ?? "");
}

interface FakeSession extends SpeechMouthSession {
  spoken: BriefingSpeech[];
  connects: number;
  closes: number;
  stops: number;
  /** What the next connect resolves to; the call opens when it does. */
  connectOpens: boolean;
  setStatus(status: RealtimeStatus): void;
  microphone: boolean;
}

function fakeSession(): FakeSession {
  const session: FakeSession = {
    spoken: [],
    connects: 0,
    closes: 0,
    stops: 0,
    connectOpens: true,
    microphone: false,
    status: REALTIME_STATUS.IDLE,
    get isConnected() {
      return this.status === REALTIME_STATUS.READY || this.status === REALTIME_STATUS.RESPONDING;
    },
    get isConnecting() {
      return this.status === REALTIME_STATUS.CONNECTING;
    },
    get microphoneCall() {
      return this.microphone;
    },
    setStatus(status: RealtimeStatus) {
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      (this as { status: RealtimeStatus }).status = status;
    },
    async connect() {
      this.connects += 1;
      this.setStatus(this.connectOpens ? REALTIME_STATUS.READY : REALTIME_STATUS.UNAVAILABLE);
      return this.connectOpens;
    },
    speak(item: ProactiveSpeechTurn) {
      if (!this.isConnected || this.status === REALTIME_STATUS.RESPONDING) return false;
      if (isBriefingSpeech(item)) this.spoken.push(item);
      this.setStatus(REALTIME_STATUS.RESPONDING);
      return true;
    },
    stopSpeaking() {
      if (this.status !== REALTIME_STATUS.RESPONDING) return false;
      this.stops += 1;
      this.setStatus(REALTIME_STATUS.READY);
      return true;
    },
    async close() {
      this.closes += 1;
      this.setStatus(REALTIME_STATUS.IDLE);
    },
  };
  return session;
}

interface Timers {
  schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel: (timer: ScheduledTimer) => void;
  fire: () => void;
  armed: () => number;
  delays: number[];
}

function fakeTimers(): Timers {
  const pending = new Map<ScheduledTimer, () => void>();
  const delays: number[] = [];
  let key = 0;
  return {
    schedule: (callback, delayMs) => {
      delays.push(delayMs);
      key += 1;
      pending.set(key, callback);
      return key;
    },
    cancel: (timer) => {
      pending.delete(timer);
    },
    fire: () => {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback();
      }
    },
    armed: () => pending.size,
    delays,
  };
}

interface Settlement {
  id: string;
  outcome: SpeechOutcome;
}

function mouth(session: FakeSession, timers: Timers, now = () => 1_000) {
  const settled: Settlement[] = [];
  const subject = new SpeechMouth({
    session: () => session,
    settle: (id, outcome) => settled.push({ id, outcome }),
    now,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  return { subject, settled };
}

test("an offer arriving into silence opens Luke's own call, is spoken, and settles SPOKEN", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("a"));
  assert.deepEqual(settled, [], "nothing is settled before the reply begins");
  // Opening the call is a promise away, and only then is the offer flushed.
  await Promise.resolve();

  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.SPOKEN }]);
});

test("offers speak one per reply, in order, on one call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("a"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["a"]);
  // The arbiter offers the next once the first is settled; the reply is still
  // under way, so the second waits for the READY edge.
  assert.equal(settled.length, 1);
  subject.offer(offer("b"));
  assert.deepEqual(spokenIds(session), ["a"]);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), ["a", "b"]);
  // One call served both.
  assert.equal(session.connects, 1);
  assert.deepEqual(
    settled.map((item) => item.id),
    ["a", "b"],
  );
});

test("the same offer again is the same offer", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("a"));
  subject.offer(offer("a"));
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);
  assert.equal(settled.length, 1);
});

test("an offer whose deadline passed settles STALE without speaking", () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.RESPONDING);
  session.microphone = true;
  const timers = fakeTimers();
  let now = 10_000;
  const { subject, settled } = mouth(session, timers, () => now);

  // Arrives during a long reply and waits.
  subject.offer(offer("a", speech("a", 10_000), 10_000 + 120_000));
  assert.deepEqual(spokenIds(session), []);
  assert.deepEqual(settled, []);

  // By the time the turn ends, the news is old; the panel has shown the
  // state the whole time, and the arbiter hears it went stale.
  now = 10_000 + 120_000 + 1;
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.STALE }]);
  // The retry clock armed mid-reply fires into an empty hand and says nothing.
  timers.fire();
  assert.deepEqual(spokenIds(session), []);
  assert.equal(settled.length, 1);
});

test("withdraw drops an unspoken offer without a settle and leaves a begun reply alone", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("beat", { kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: 1_000 }));
  await Promise.resolve();
  // The beat began; withdrawing an id that already settled changes nothing.
  assert.deepEqual(settled, [{ id: "beat", outcome: SPEECH_OUTCOME.SPOKEN }]);
  subject.withdraw("beat");
  assert.equal(session.stops, 0, "a reply begun is delivered");

  // The next offer waits behind the reply; the gate settles before it can
  // speak, and it is taken back unsaid and unsettled.
  subject.offer(offer("second", { kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: 1_000 }));
  subject.withdraw("second");
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.equal(settled.length, 1);
  assert.equal(session.status, REALTIME_STATUS.READY, "nothing spoke into the empty hand");
  // An empty hand on Luke's own call starts the linger, as an empty queue did.
  assert.deepEqual(timers.delays.slice(-1), [ANNOUNCER_LINGER_MS]);
});

test("the call Luke opened lingers for stragglers, then closes itself", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject } = mouth(session, timers);

  subject.offer(offer("a"));
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  // Everything said: the linger is armed rather than the call slammed shut.
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_LINGER_MS]);
  assert.equal(session.closes, 0);

  // A straggler cancels the linger and rides the same call.
  subject.offer(offer("b"));
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.equal(session.closes, 1);
});

test("an offer riding the developer's call never closes it", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.READY);
  const timers = fakeTimers();
  const { subject } = mouth(session, timers);

  subject.offer(offer("a"));
  assert.equal(session.connects, 0, "the open call is used, not replaced");
  assert.deepEqual(spokenIds(session), ["a"]);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  // No linger is ever armed against the developer's own call.
  assert.equal(timers.armed(), 0);
  timers.fire();
  assert.equal(session.closes, 0);
});

test("a refused call keeps the offer and speaks it on the retry", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("a"));
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);

  // The refusal armed the retry clock instead of settling the offer.
  assert.equal(session.connects, 1);
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_RETRY_DELAY_MS]);
  assert.deepEqual(settled, []);

  // The rate limit lifted; the retry delivers the same offer.
  session.connectOpens = true;
  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 2);
  assert.deepEqual(spokenIds(session), ["a"]);
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.SPOKEN }]);
});

test("an offer that outlives its attempts settles REFUSED, not retried into a loop", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("a"));
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);
  for (let attempt = 1; attempt < MAXIMUM_CONNECT_ATTEMPTS; attempt += 1) {
    timers.fire();
    await Promise.resolve();
    subject.onStatus(REALTIME_STATUS.UNAVAILABLE);
  }
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);

  // The final refusal spent the attempts: the offer is handed back refused
  // and no clock is left ticking for it.
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.REFUSED }]);
  assert.equal(timers.armed(), 0);
  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);

  // A later offer starts with fresh attempts.
  session.connectOpens = true;
  subject.offer(offer("b"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["b"]);
});

test("an offer arriving right after a refused one is kept, not refused with it", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.offer(offer("a"));
  await Promise.resolve();
  for (let attempt = 1; attempt < MAXIMUM_CONNECT_ATTEMPTS; attempt += 1) {
    timers.fire();
    await Promise.resolve();
  }
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.REFUSED }]);

  // Fresh news arriving before any clock ticks must find a fresh counter,
  // not die against the one the refused offer left behind.
  session.connectOpens = true;
  subject.offer(offer("b"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["b"]);
});

test("an offer stranded by a call that ended is picked up by the retry clock", async () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const { subject } = mouth(session, timers);

  // Arrives mid-reply on the developer's call and waits its turn.
  subject.offer(offer("a"));
  assert.deepEqual(spokenIds(session), []);

  // The developer hangs up before the turn ends; the offer survives.
  session.microphone = false;
  session.setStatus(REALTIME_STATUS.IDLE);
  subject.onStatus(REALTIME_STATUS.IDLE);
  assert.equal(timers.armed(), 1);

  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("an offer refused mid-reply keeps a clock of its own beside the READY edge", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const { subject } = mouth(session, timers);

  // Arrives mid-reply and is refused the turn. The READY edge is the
  // session's promise, not this class's, so the offer arms its own retry
  // rather than depending on that edge alone.
  subject.offer(offer("a"));
  assert.deepEqual(spokenIds(session), []);
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_RETRY_DELAY_MS]);

  // The edge never lands; the clock fires into a call that has since settled
  // and the offer is spoken rather than stranded.
  session.setStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("quiet beginning cuts the reply mid-sentence, closes Luke's own call, and hands back the unspoken offer HELD", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  // Mid-briefing on Luke's own call, with the next offer waiting behind it.
  subject.offer(offer("a"));
  await Promise.resolve();
  subject.offer(offer("b"));
  assert.equal(session.status, REALTIME_STATUS.RESPONDING);

  subject.setHeld(true);
  assert.equal(session.stops, 1, "the reply under way is cut off");
  assert.equal(session.closes, 1, "the call Luke opened is closed");
  // The spoken one was already settled; the unspoken one goes back held
  // rather than being dropped, for the arbiter to keep until the release.
  assert.deepEqual(settled, [
    { id: "a", outcome: SPEECH_OUTCOME.SPOKEN },
    { id: "b", outcome: SPEECH_OUTCOME.HELD },
  ]);

  // Quiet ending finds nothing in hand and no clock ticking.
  subject.onStatus(REALTIME_STATUS.IDLE);
  subject.setHeld(false);
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);

  // Quiet over, the arbiter offers again — the release arrives exactly here.
  subject.offer(offer("c"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["a", "c"]);
});

test("an offer arriving under a hold the panel still draws is spoken, not handed back", async () => {
  // The arbiter offers only once the quiet has ended; the panel's copy of
  // the hold lands a render later. The offer is the fresher word.
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  subject.setHeld(true);
  subject.offer(offer("a"));
  await Promise.resolve();

  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.SPOKEN }]);
});

test("a hold beginning over an unspoken offer settles it HELD and opens no call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  session.connectOpens = false;
  subject.offer(offer("a"));
  await Promise.resolve();
  assert.equal(timers.armed(), 1, "the refused call left a retry clock");

  subject.setHeld(true);
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.HELD }]);
  assert.equal(timers.armed(), 0);
  assert.deepEqual(spokenIds(session), []);
});

test("quiet beginning never touches the developer's own call", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const { subject, settled } = mouth(session, timers);

  // Waiting out the developer's reply when the quiet lands.
  subject.offer(offer("a"));
  assert.deepEqual(spokenIds(session), []);

  subject.setHeld(true);
  assert.equal(session.stops, 0, "the developer's reply is theirs to finish");
  assert.equal(session.closes, 0);

  // The waiting offer is handed back held rather than read after the reply.
  assert.deepEqual(settled, [{ id: "a", outcome: SPEECH_OUTCOME.HELD }]);
  assert.equal(timers.armed(), 0);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);
});

test("an offer waits out the developer's floor after Luke answers them", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const { subject } = mouth(session, timers, () => now);

  // A full exchange: the developer asks, Luke answers, the reply ends.
  session.setStatus(REALTIME_STATUS.LISTENING);
  subject.onStatus(REALTIME_STATUS.LISTENING);
  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);

  // News arrives mid-reply: the pause belongs to the developer's next ask,
  // not to the offer.
  subject.offer(offer("a"));
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);

  // Half the window passes in silence; the offer still may not speak.
  now = 1_000 + ANNOUNCER_GRACE_MS / 2;
  timers.fire();
  assert.deepEqual(spokenIds(session), []);

  // The developer left the pause empty; the waiting offer takes it.
  now = 1_000 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(spokenIds(session), ["a"]);

  // The next offer keeps its own readout after the first one ends.
  subject.offer(offer("b"));
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), ["a", "b"]);
});

test("the developer speaking inside the window keeps the floor theirs", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const { subject } = mouth(session, timers, () => now);

  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.offer(offer("s"));
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);

  // The developer takes the turn inside the window — the grace did its job —
  // and Luke's answer to them ends with a fresh window, not a spent one.
  now = 1_000 + ANNOUNCER_GRACE_MS / 2;
  session.setStatus(REALTIME_STATUS.LISTENING);
  subject.onStatus(REALTIME_STATUS.LISTENING);
  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.deepEqual(spokenIds(session), []);

  // Only the pause after the second answer, left empty, is spoken into.
  now = 1_000 + ANNOUNCER_GRACE_MS / 2 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(spokenIds(session), ["s"]);
});

test("the retry clock respects the developer's floor", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  let now = 1_000;
  const { subject } = mouth(session, timers, () => now);

  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.offer(offer("a"));
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  // Every armed clock firing inside the window still finds the floor held.
  now = 1_000 + ANNOUNCER_GRACE_MS - 1;
  timers.fire();
  assert.deepEqual(spokenIds(session), []);

  now = 1_000 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("an offer on Luke's own call speaks without the developer's window", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const { subject } = mouth(session, timers);

  // Nobody is conversing: the window guards the developer's next ask, and
  // on Luke's own call there is no ask to guard.
  subject.offer(offer("a"));
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("the developer taking the turn stands the grace clock down", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const { subject } = mouth(session, timers, () => now);

  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.offer(offer("a"));
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  const armedDuringWindow = timers.armed();

  // The press is what the window waited for: the clock aimed at the pause
  // stands down rather than firing into the developer's own turn.
  session.setStatus(REALTIME_STATUS.LISTENING);
  subject.onStatus(REALTIME_STATUS.LISTENING);
  assert.ok(timers.armed() < armedDuringWindow);

  // Every clock still standing fires into the busy turn and speaks nothing.
  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  now = 1_000 + ANNOUNCER_GRACE_MS * 2;
  timers.fire();
  assert.deepEqual(spokenIds(session), []);

  // The answer's own end opens the next window, on a clock of its own.
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.deepEqual(spokenIds(session), []);
  now = 1_000 + ANNOUNCER_GRACE_MS * 3;
  timers.fire();
  assert.deepEqual(spokenIds(session), ["a"]);
});
