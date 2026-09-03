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
import {
  ANNOUNCER_GRACE_MS,
  ANNOUNCER_LINGER_MS,
  ANNOUNCER_RETRY_DELAY_MS,
  BriefingQueue,
  type BriefingQueueSession,
  MAXIMUM_CONNECT_ATTEMPTS,
  MAXIMUM_QUEUED_NOTICES,
  SPOKEN_NOTICE_MAX_AGE_MS,
} from "./briefing-queue";

function speech(id: string, decidedAt = 1_000): BriefingSpeech {
  return {
    kind: BRIEFING_SPEECH_KIND,
    briefing: `Claude Code finished ${id}.`,
    sessionIds: [{ providerId: "claude-code", providerSessionId: id }],
    decidedAt,
  };
}

/** The sessions the spoken briefings were about, in the order they were said. */
function spokenIds(session: FakeSession): string[] {
  return session.spoken.map((item) => item.sessionIds[0]?.providerSessionId ?? "");
}

interface FakeSession extends BriefingQueueSession {
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

function queue(session: FakeSession, timers: Timers, now = () => 1_000) {
  return new BriefingQueue({
    session: () => session,
    now,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
}

test("a briefing arriving into silence opens Luke's own call and is spoken", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  // Opening the call is a promise away, and only then is the queue flushed.
  await Promise.resolve();

  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("queued briefings speak one per reply, in order, on one call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  subject.enqueue(speech("b"));
  await Promise.resolve();
  // Each briefing is one reply: the second waits for the first to end.
  assert.deepEqual(spokenIds(session), ["a"]);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), ["a", "b"]);
  // One call served the whole queue.
  assert.equal(session.connects, 1);
});

test("the bounded queue sheds its oldest briefings whole", () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const subject = queue(session, fakeTimers());

  for (let index = 0; index < MAXIMUM_QUEUED_NOTICES; index += 1) {
    subject.enqueue(speech(`a-${index}`));
  }
  // One past the cap: the oldest is dropped, not trimmed, because a briefing
  // is one sentence the brain already worded and there is no half to keep.
  subject.enqueue(speech("b"));

  for (let readout = 0; readout <= MAXIMUM_QUEUED_NOTICES; readout += 1) {
    session.setStatus(REALTIME_STATUS.READY);
    subject.onStatus(REALTIME_STATUS.READY);
  }
  assert.deepEqual(spokenIds(session), [
    ...Array.from({ length: MAXIMUM_QUEUED_NOTICES - 1 }, (_, index) => `a-${index + 1}`),
    "b",
  ]);
});

test("a calendar beat still queued is dropped when the gate stands down", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue({ kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: 1_000 });
  subject.enqueue(speech("after-done"));
  // The gate settled before the beat could speak; only the real briefing says.
  subject.dropCalendarOnboardingSpeech();
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  assert.deepEqual(spokenIds(session), ["after-done"]);
});

test("the call Luke opened lingers for stragglers, then closes itself", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  // Everything said: the linger is armed rather than the call slammed shut.
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_LINGER_MS]);
  assert.equal(session.closes, 0);

  // A straggler cancels the linger and rides the same call.
  subject.enqueue(speech("b"));
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.equal(session.closes, 1);
});

test("a briefing riding the developer's call never closes it", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.READY);
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  assert.equal(session.connects, 0, "the open call is used, not replaced");
  assert.deepEqual(spokenIds(session), ["a"]);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  // No linger is ever armed against the developer's own call.
  assert.equal(timers.armed(), 0);
  timers.fire();
  assert.equal(session.closes, 0);
});

test("a refused call keeps the backlog and speaks it on the retry", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);

  // The refusal armed the retry clock instead of emptying the queue.
  assert.equal(session.connects, 1);
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_RETRY_DELAY_MS]);

  // The rate limit lifted; the retry delivers the same briefing.
  session.connectOpens = true;
  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 2);
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("a backlog that outlives its attempts is dropped, not retried into a loop", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);
  for (let attempt = 1; attempt < MAXIMUM_CONNECT_ATTEMPTS; attempt += 1) {
    timers.fire();
    await Promise.resolve();
    subject.onStatus(REALTIME_STATUS.UNAVAILABLE);
  }
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);

  // The final refusal spent the attempts: the backlog is already dropped and
  // no clock is left ticking for it.
  assert.equal(timers.armed(), 0);
  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);

  // A later briefing is a fresh backlog with fresh attempts.
  session.connectOpens = true;
  subject.enqueue(speech("b"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["b"]);
});

test("a briefing arriving right after a spent backlog is kept, not dropped with it", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.enqueue(speech("a"));
  await Promise.resolve();
  for (let attempt = 1; attempt < MAXIMUM_CONNECT_ATTEMPTS; attempt += 1) {
    timers.fire();
    await Promise.resolve();
  }
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);

  // Fresh news arriving before any clock ticks must find a fresh counter,
  // not die against the one the spent backlog left behind.
  session.connectOpens = true;
  subject.enqueue(speech("b"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["b"]);
});

test("a backlog stranded by a call that ended is picked up by the retry clock", async () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = queue(session, timers);

  // Arrives mid-reply on the developer's call and waits its turn.
  subject.enqueue(speech("a"));
  assert.deepEqual(spokenIds(session), []);

  // The developer hangs up before the turn ends; the backlog survives.
  session.microphone = false;
  session.setStatus(REALTIME_STATUS.IDLE);
  subject.onStatus(REALTIME_STATUS.IDLE);
  assert.equal(timers.armed(), 1);

  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("a briefing refused mid-reply keeps a clock of its own beside the READY edge", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = queue(session, timers);

  // Arrives mid-reply and is refused the turn. The READY edge is the
  // session's promise, not this class's, so the backlog arms its own retry
  // rather than depending on that edge alone.
  subject.enqueue(speech("a"));
  assert.deepEqual(spokenIds(session), []);
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_RETRY_DELAY_MS]);

  // The edge never lands; the clock fires into a call that has since settled
  // and the briefing is spoken rather than stranded.
  session.setStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("quiet beginning cuts the briefing mid-sentence and closes Luke's own call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  // Mid-briefing on Luke's own call, with another waiting behind it.
  subject.enqueue(speech("a"));
  subject.enqueue(speech("b"));
  await Promise.resolve();
  assert.equal(session.status, REALTIME_STATUS.RESPONDING);

  subject.setHeld(true);
  assert.equal(session.stops, 1, "the reply under way is cut off");
  assert.equal(session.closes, 1, "the call Luke opened is closed");

  // The backlog was dropped with the reply: quiet ending finds nothing to
  // say, and no clock is left ticking toward saying it.
  subject.onStatus(REALTIME_STATUS.IDLE);
  subject.setHeld(false);
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);
  assert.deepEqual(spokenIds(session), ["a"]);

  // Quiet over, fresh news speaks again — the release arrives exactly here.
  subject.enqueue(speech("c"));
  await Promise.resolve();
  assert.deepEqual(spokenIds(session), ["a", "c"]);
});

test("a briefing arriving under the quiet never opens a call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  subject.setHeld(true);
  subject.enqueue(speech("a"));
  await Promise.resolve();

  assert.equal(session.connects, 0);
  assert.deepEqual(spokenIds(session), []);
  assert.equal(timers.armed(), 0);
});

test("quiet beginning never touches the developer's own call", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = queue(session, timers);

  // Waiting out the developer's reply when the quiet lands.
  subject.enqueue(speech("a"));
  assert.deepEqual(spokenIds(session), []);

  subject.setHeld(true);
  assert.equal(session.stops, 0, "the developer's reply is theirs to finish");
  assert.equal(session.closes, 0);

  // But the waiting briefing is dropped rather than read after the reply.
  assert.equal(timers.armed(), 0);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);
});

test("a briefing that went stale in the queue is dropped, not read as news", () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.RESPONDING);
  session.microphone = true;
  const timers = fakeTimers();
  let now = 10_000;
  const subject = queue(session, timers, () => now);

  // Arrives during a long reply and waits.
  subject.enqueue(speech("a", 10_000));
  assert.deepEqual(spokenIds(session), []);

  // By the time the turn ends, the news is old; the panel has shown the
  // state the whole time.
  now = 10_000 + SPOKEN_NOTICE_MAX_AGE_MS + 1;
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);
});

test("a briefing waits out the developer's floor after Luke answers them", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const subject = queue(session, timers, () => now);

  // A full exchange: the developer asks, Luke answers, the reply ends.
  session.setStatus(REALTIME_STATUS.LISTENING);
  subject.onStatus(REALTIME_STATUS.LISTENING);
  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);

  // News arrives mid-reply and again right after: the pause belongs to the
  // developer's next ask, not to the backlog.
  subject.enqueue(speech("a"));
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), []);

  // Half the window passes in silence; a straggler still may not speak.
  now = 1_000 + ANNOUNCER_GRACE_MS / 2;
  subject.enqueue(speech("b"));
  assert.deepEqual(spokenIds(session), []);

  // The developer left the pause empty; the first waiting briefing takes it.
  now = 1_000 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(spokenIds(session), ["a"]);

  // The later briefing keeps its own readout after the first one ends.
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), ["a", "b"]);
});

test("the developer speaking inside the window keeps the floor theirs", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const subject = queue(session, timers, () => now);

  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.enqueue(speech("s"));
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
  const subject = queue(session, timers, () => now);

  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.enqueue(speech("a"));
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

test("a briefing on Luke's own call speaks without the developer's window", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = queue(session, timers);

  // Nobody is conversing: the window guards the developer's next ask, and
  // on Luke's own call there is no ask to guard.
  subject.enqueue(speech("a"));
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(spokenIds(session), ["a"]);
});

test("the developer taking the turn stands the grace clock down", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const subject = queue(session, timers, () => now);

  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.enqueue(speech("a"));
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
