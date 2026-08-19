import assert from "node:assert/strict";
import test from "node:test";
import type { RealtimeStatus } from "@sidecar/core";
import {
  ATTENTION_DISPOSITION,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  REALTIME_STATUS,
} from "@sidecar/core";
import {
  ANNOUNCER_LINGER_MS,
  ANNOUNCER_RETRY_DELAY_MS,
  type AnnouncerSession,
  MAXIMUM_CONNECT_ATTEMPTS,
  SPOKEN_NOTICE_MAX_AGE_MS,
  SpokenNoticeAnnouncer,
} from "../src/renderer/spoken-notices";

function speech(id: string, decidedAt = 1_000): AttentionSpeech {
  return {
    providerId: "claude-code",
    providerSessionId: id,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.STATUS_EDGE,
    summary: `Claude Code finished "${id}".`,
    decidedAt,
  };
}

interface FakeSession extends AnnouncerSession {
  spoken: AttentionSpeech[];
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
    speak(item: AttentionSpeech) {
      if (!this.isConnected || this.status === REALTIME_STATUS.RESPONDING) return false;
      this.spoken.push(item);
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
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timer: number) => void;
  fire: () => void;
  armed: () => number;
  delays: number[];
}

function fakeTimers(): Timers {
  const pending = new Map<number, () => void>();
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

test("queued notices speak one reply at a time, paced by READY", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a"), speech("b")]);
  await Promise.resolve();
  // The first took the turn; the second waits for the reply to end.
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "b"],
  );
  // One call served the whole queue.
  assert.equal(session.connects, 1);
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
  assert.deepEqual(session.spoken, []);

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
  assert.deepEqual(session.spoken, []);
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

  // Mid-announcement on Luke's own call, with another sentence waiting.
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
    ["a"],
  );

  // Quiet over, fresh news speaks again — the release arrives exactly here.
  subject.enqueue([speech("c")]);
  await Promise.resolve();
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a", "c"],
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
  assert.deepEqual(session.spoken, []);
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
  assert.deepEqual(session.spoken, []);

  subject.setMeetingQuiet(true);
  assert.equal(session.stops, 0, "the developer's reply is theirs to finish");
  assert.equal(session.closes, 0);

  // But the waiting announcement is dropped rather than read after the reply.
  assert.equal(timers.armed(), 0);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(session.spoken, []);
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
  assert.deepEqual(session.spoken, []);

  // By the time the turn ends, the news is old; the panel has shown the
  // state the whole time.
  now = 10_000 + SPOKEN_NOTICE_MAX_AGE_MS + 1;
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(session.spoken, []);
});
