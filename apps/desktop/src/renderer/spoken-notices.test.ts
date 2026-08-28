import assert from "node:assert/strict";
import test from "node:test";
import type { ProactiveSpeechTurn, RealtimeStatus, ScheduledTimer } from "@sidecar/realtime";
import {
  CALENDAR_ONBOARDING_SPEECH_KIND,
  isArrivalSpeech,
  isCalendarOnboardingSpeech,
  REALTIME_STATUS,
  SESSION_ANNOUNCEMENT_CHANGE,
  type SessionAnnouncement,
} from "@sidecar/realtime";
import {
  ANNOUNCER_GRACE_MS,
  ANNOUNCER_LINGER_MS,
  ANNOUNCER_RETRY_DELAY_MS,
  type AnnouncerSession,
  MAXIMUM_CONNECT_ATTEMPTS,
  MAXIMUM_QUEUED_NOTICES,
  SPOKEN_NOTICE_MAX_AGE_MS,
  SpokenNoticeAnnouncer,
} from "./spoken-notices";

function speech(id: string, decidedAt = 1_000): SessionAnnouncement {
  return {
    providerId: "claude-code",
    providerSessionId: id,
    work: id,
    change: SESSION_ANNOUNCEMENT_CHANGE.FINISHED,
    decidedAt,
  };
}

interface FakeSession extends AnnouncerSession {
  spoken: SessionAnnouncement[];
  turns: SessionAnnouncement[][];
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
    turns: [],
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
      if (!isArrivalSpeech(item) && !isCalendarOnboardingSpeech(item)) {
        this.turns.push([...item]);
        this.spoken.push(...item);
      }
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

function announcer(session: FakeSession, timers: Timers, now = () => 1_000) {
  return new SpokenNoticeAnnouncer({
    session: () => session,
    now,
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
}

test("a notice arriving into silence opens Luke's own call and is spoken", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
  // Opening the call is a promise away, and only then is the queue flushed.
  await Promise.resolve();

  assert.equal(session.connects, 1);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("queued notices speak together in one reply", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a"), speech("b")]);
  await Promise.resolve();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "b"],
  );
  assert.equal(session.turns.length, 1);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "b"],
  );
  // One call served the whole queue.
  assert.equal(session.connects, 1);
});

test("separate batches stay separate while the bounded queue sheds oldest news", () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const subject = announcer(session, fakeTimers());

  subject.enqueue(
    Array.from({ length: MAXIMUM_QUEUED_NOTICES }, (_, index) => speech(`a-${index}`)),
  );
  subject.enqueue([speech("b")]);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.turns.map((turn) => turn.map(({ providerSessionId }) => providerSessionId)),
    [Array.from({ length: MAXIMUM_QUEUED_NOTICES - 1 }, (_, index) => `a-${index + 1}`)],
  );

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.turns.map((turn) => turn.map(({ providerSessionId }) => providerSessionId)),
    [Array.from({ length: MAXIMUM_QUEUED_NOTICES - 1 }, (_, index) => `a-${index + 1}`), ["b"]],
  );
});

test("a calendar beat still queued is dropped when the gate stands down", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue({ kind: CALENDAR_ONBOARDING_SPEECH_KIND, decidedAt: 1_000 });
  subject.enqueue([speech("after-done")]);
  // The gate settled before the beat could speak; only the real notice says.
  subject.dropCalendarOnboardingSpeech();
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  assert.equal(session.spoken.length, 1);
  assert.equal(session.spoken[0]?.providerSessionId, "after-done");
});

test("the call Luke opened lingers for stragglers, then closes itself", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  // Everything said: the linger is armed rather than the call slammed shut.
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_LINGER_MS]);
  assert.equal(session.closes, 0);

  // A straggler cancels the linger and rides the same call.
  subject.enqueue([speech("b")]);
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.equal(session.closes, 1);
});

test("a notice riding the developer's call never closes it", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.READY);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
  assert.equal(session.connects, 0, "the open call is used, not replaced");
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );

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
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);

  // The refusal armed the retry clock instead of emptying the queue.
  assert.equal(session.connects, 1);
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_RETRY_DELAY_MS]);

  // The rate limit lifted; the retry delivers the same notice.
  session.connectOpens = true;
  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 2);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("a backlog that outlives its attempts is dropped, not retried into a loop", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
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

  // A later notice is a fresh backlog with fresh attempts.
  session.connectOpens = true;
  subject.enqueue([speech("b")]);
  await Promise.resolve();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["b"],
  );
});

test("a notice arriving right after a spent backlog is kept, not dropped with it", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
  await Promise.resolve();
  for (let attempt = 1; attempt < MAXIMUM_CONNECT_ATTEMPTS; attempt += 1) {
    timers.fire();
    await Promise.resolve();
  }
  assert.equal(session.connects, MAXIMUM_CONNECT_ATTEMPTS);

  // Fresh news arriving before any clock ticks must find a fresh counter,
  // not die against the one the spent backlog left behind.
  session.connectOpens = true;
  subject.enqueue([speech("b")]);
  await Promise.resolve();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["b"],
  );
});

test("a backlog stranded by a call that ended is picked up by the retry clock", async () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // Arrives mid-reply on the developer's call and waits its turn.
  subject.enqueue([speech("a")]);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  // The developer hangs up before the turn ends; the backlog survives.
  session.microphone = false;
  session.setStatus(REALTIME_STATUS.IDLE);
  subject.onStatus(REALTIME_STATUS.IDLE);
  assert.equal(timers.armed(), 1);

  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("a notice refused mid-reply keeps a clock of its own beside the READY edge", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // Arrives mid-reply and is refused the turn. The READY edge is the
  // session's promise, not this class's, so the backlog arms its own retry
  // rather than depending on that edge alone.
  subject.enqueue([speech("a")]);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);
  assert.equal(timers.armed(), 1);
  assert.deepEqual(timers.delays, [ANNOUNCER_RETRY_DELAY_MS]);

  // The edge never lands; the clock fires into a call that has since settled
  // and the notice is spoken rather than stranded.
  session.setStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("quiet beginning cuts the announcement mid-sentence and closes Luke's own call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // Mid-announcement on Luke's own call, with two updates in the reply.
  subject.enqueue([speech("a"), speech("b")]);
  await Promise.resolve();
  assert.equal(session.status, REALTIME_STATUS.RESPONDING);

  subject.setMeetingQuiet(true);
  assert.equal(session.stops, 1, "the reply under way is cut off");
  assert.equal(session.closes, 1, "the call Luke opened is closed");

  // The backlog was dropped with the reply: quiet ending finds nothing to
  // say, and no clock is left ticking toward saying it.
  subject.onStatus(REALTIME_STATUS.IDLE);
  subject.setMeetingQuiet(false);
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "b"],
  );

  // Quiet over, fresh news speaks again — the release arrives exactly here.
  subject.enqueue([speech("c")]);
  await Promise.resolve();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "b", "c"],
  );
});

test("a notice arriving under the quiet never opens a call", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.setMeetingQuiet(true);
  subject.enqueue([speech("a")]);
  await Promise.resolve();

  assert.equal(session.connects, 0);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);
  assert.equal(timers.armed(), 0);
});

test("quiet beginning never touches the developer's own call", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // Waiting out the developer's reply when the quiet lands.
  subject.enqueue([speech("a")]);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  subject.setMeetingQuiet(true);
  assert.equal(session.stops, 0, "the developer's reply is theirs to finish");
  assert.equal(session.closes, 0);

  // But the waiting announcement is dropped rather than read after the reply.
  assert.equal(timers.armed(), 0);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a sentence that went stale in the queue is dropped, not read as news", () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.RESPONDING);
  session.microphone = true;
  const timers = fakeTimers();
  let now = 10_000;
  const subject = announcer(session, timers, () => now);

  // Arrives during a long reply and waits.
  subject.enqueue([speech("a", 10_000)]);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  // By the time the turn ends, the news is old; the panel has shown the
  // state the whole time.
  now = 10_000 + SPOKEN_NOTICE_MAX_AGE_MS + 1;
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);
});

test("an announcement waits out the developer's floor after Luke answers them", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const subject = announcer(session, timers, () => now);

  // A full exchange: the developer asks, Luke answers, the reply ends.
  session.setStatus(REALTIME_STATUS.LISTENING);
  subject.onStatus(REALTIME_STATUS.LISTENING);
  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);

  // News arrives mid-reply and again right after: the pause belongs to the
  // developer's next ask, not to the backlog.
  subject.enqueue([speech("a")]);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  // Half the window passes in silence; a straggler still may not speak.
  now = 1_000 + ANNOUNCER_GRACE_MS / 2;
  subject.enqueue([speech("b")]);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  // The developer left the pause empty; the first waiting batch takes it.
  now = 1_000 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );

  // The later batch keeps its own readout after the first one ends.
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "b"],
  );
});

test("the developer speaking inside the window keeps the floor theirs", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const subject = announcer(session, timers, () => now);

  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.enqueue([speech("s")]);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

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
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  // Only the pause after the second answer, left empty, is spoken into.
  now = 1_000 + ANNOUNCER_GRACE_MS / 2 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["s"],
  );
});

test("the retry clock respects the developer's floor", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  let now = 1_000;
  const subject = announcer(session, timers, () => now);

  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.enqueue([speech("a")]);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  // Every armed clock firing inside the window still finds the floor held.
  now = 1_000 + ANNOUNCER_GRACE_MS - 1;
  timers.fire();
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  now = 1_000 + ANNOUNCER_GRACE_MS;
  timers.fire();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("a notice on Luke's own call speaks without the developer's window", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // Nobody is conversing: the window guards the developer's next ask, and
  // on Luke's own call there is no ask to guard.
  subject.enqueue([speech("a")]);
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("the developer taking the turn stands the grace clock down", () => {
  const session = fakeSession();
  session.microphone = true;
  const timers = fakeTimers();
  let now = 1_000;
  const subject = announcer(session, timers, () => now);

  session.setStatus(REALTIME_STATUS.RESPONDING);
  subject.onStatus(REALTIME_STATUS.RESPONDING);
  subject.enqueue([speech("a")]);
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
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);

  // The answer's own end opens the next window, on a clock of its own.
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.deepEqual<SessionAnnouncement[]>(session.spoken, []);
  now = 1_000 + ANNOUNCER_GRACE_MS * 3;
  timers.fire();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});
