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
  PREVIEW_LINGER_MS,
  SPOKEN_NOTICE_MAX_AGE_MS,
  SpokenNoticeAnnouncer,
  VOICE_PREVIEW_MAX_AGE_MS,
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
  /** How many samples this call was asked to play. */
  previews: number;
  connects: number;
  closes: number;
  /** What the next connect resolves to; the call opens when it does. */
  connectOpens: boolean;
  /**
   * Whether a connect leaves the call CONNECTING and waits, rather than
   * settling as it is asked. It is what lets a test put a pick inside a
   * handshake — the stretch a credential is minted across.
   */
  slowHandshake: boolean;
  /** Settles the handshake now waiting, as {@link connectOpens} says. */
  settleHandshake(): void;
  setStatus(status: RealtimeStatus): void;
  microphone: boolean;
}

function fakeSession(): FakeSession {
  let settle: ((opened: boolean) => void) | undefined;
  const session: FakeSession = {
    spoken: [],
    previews: 0,
    connects: 0,
    closes: 0,
    connectOpens: true,
    slowHandshake: false,
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
      (this as { status: RealtimeStatus }).status = status;
    },
    async connect() {
      this.connects += 1;
      if (this.slowHandshake) {
        this.setStatus(REALTIME_STATUS.CONNECTING);
        return await new Promise<boolean>((resolve) => {
          settle = resolve;
        });
      }
      this.setStatus(this.connectOpens ? REALTIME_STATUS.READY : REALTIME_STATUS.UNAVAILABLE);
      return this.connectOpens;
    },
    settleHandshake() {
      this.setStatus(this.connectOpens ? REALTIME_STATUS.READY : REALTIME_STATUS.UNAVAILABLE);
      settle?.(this.connectOpens);
      settle = undefined;
    },
    speak(item: AttentionSpeech) {
      if (!this.isConnected || this.status === REALTIME_STATUS.RESPONDING) return false;
      this.spoken.push(item);
      this.setStatus(REALTIME_STATUS.RESPONDING);
      return true;
    },
    speakPreview() {
      if (!this.isConnected || this.status === REALTIME_STATUS.RESPONDING) return false;
      this.previews += 1;
      this.setStatus(REALTIME_STATUS.RESPONDING);
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
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (timer: unknown) => void;
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
      pending.delete(timer as number);
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

function announcer(
  session: FakeSession,
  timers: Timers,
  told: {
    now?: () => number;
    reopening?: () => boolean;
    revoicing?: () => boolean;
  } = {},
) {
  return new SpokenNoticeAnnouncer({
    session: () => session,
    reopening: told.reopening ?? (() => false),
    revoicing: told.revoicing ?? (() => false),
    now: told.now ?? (() => 1_000),
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

test("a changed voice is heard: the sample opens a speak-only call of Luke's own", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  await Promise.resolve();

  assert.equal(session.connects, 1);
  assert.equal(session.microphoneCall, false, "a sample never asks for the microphone");
  assert.equal(session.previews, 1);
});

test("only the latest pick is heard: a second sample supersedes the first", async () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // Both land while a reply is under way, so neither can speak yet.
  subject.requestPreview();
  subject.requestPreview();
  assert.equal(session.previews, 0);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  // One sample, not two: auditioning four voices quickly is one ask to hear
  // the fourth, never four replies queued behind each other.
  assert.equal(session.previews, 1);
});

test("a sample goes ahead of the news it arrived beside", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.enqueue([speech("a")]);
  subject.requestPreview();
  await Promise.resolve();

  // The sample answers something the developer did a moment ago; the notice
  // behind it is news, and news keeps.
  assert.equal(session.previews, 1);
  assert.deepEqual(session.spoken, []);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(
    session.spoken.map((item) => item.providerSessionId),
    ["a"],
  );
});

test("a refused call drops the sample rather than opening one later", async () => {
  const session = fakeSession();
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  await Promise.resolve();
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);

  // No clock is left ticking: a call opening twenty seconds after a settings
  // click is Luke introducing himself to someone who went back to work.
  assert.equal(session.connects, 1);
  assert.equal(timers.armed(), 0);

  session.connectOpens = true;
  timers.fire();
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.equal(session.previews, 0);
});

test("a sample that waited out a long reply is dropped, not played late", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.RESPONDING);
  const timers = fakeTimers();
  let now = 10_000;
  const subject = announcer(session, timers, { now: () => now });

  subject.requestPreview();
  assert.equal(session.previews, 0);

  now = 10_000 + VOICE_PREVIEW_MAX_AGE_MS + 1;
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  // The click it answered is long past; arriving now, it would interrupt
  // rather than demonstrate.
  assert.equal(session.previews, 0);
});

test("a call that only played samples puts itself away in seconds", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);

  assert.deepEqual(timers.delays, [PREVIEW_LINGER_MS]);
  // Long enough to reuse while the next voice is picked.
  subject.requestPreview();
  assert.equal(timers.armed(), 0);
  assert.equal(session.connects, 1);
  assert.equal(session.previews, 2);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.equal(session.closes, 1);
});

test("news spoken on the sample's call earns the call the full linger", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  await Promise.resolve();
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(timers.delays, [PREVIEW_LINGER_MS]);

  // A session finishing while the call is still up: it is a cluster's first
  // now, and the call waits for the stragglers as any announcing call does.
  subject.enqueue([speech("a")]);
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(timers.delays, [PREVIEW_LINGER_MS, ANNOUNCER_LINGER_MS]);
});

test("a sample rides the developer's own call and never closes it", () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.READY);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  assert.equal(session.connects, 0, "the open call is used, not replaced");
  assert.equal(session.previews, 1);

  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.equal(timers.armed(), 0);
  timers.fire();
  assert.equal(session.closes, 0);
});

test("a sample stranded by the voice restart is asked for again at once", async () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.CONNECTING);
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // The restart is already tearing the old call down, so there is nothing to
  // speak on and nothing to wait for either.
  subject.requestPreview();
  assert.equal(session.previews, 0);

  // The call the new voice is minted for opens from here — on the status,
  // not on the queue's twenty-second retry clock, which nothing would arm
  // for a sample anyway.
  session.setStatus(REALTIME_STATUS.IDLE);
  subject.onStatus(REALTIME_STATUS.IDLE);
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.equal(session.previews, 1);
});

test("the ending of the call it replaced does not orphan the call Luke just opened", async () => {
  const session = fakeSession();
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  // The call opens while the one it replaced is still reporting its own
  // ending — which is what a voice restart looks like from here.
  subject.requestPreview();
  subject.onStatus(REALTIME_STATUS.IDLE);
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.equal(session.previews, 1);

  // The stale ending must not have taken ownership of the new call with it:
  // a call nobody owns is a call nobody closes, and it would sit open until
  // the session's own idle retirement instead of the seconds it is owed.
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  timers.fire();
  assert.equal(session.closes, 1);
});

test("a sample waits for the developer's call to come back in the new voice", async () => {
  const session = fakeSession();
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.READY);
  const timers = fakeTimers();
  let reopening = false;
  const subject = announcer(session, timers, { reopening: () => reopening });

  // The voice change tore the developer's call down to mint the next one in
  // the new voice. Across that gap the session answers "no call, none
  // coming", and it is the one time that answer must not be believed.
  reopening = true;
  session.microphone = false;
  session.setStatus(REALTIME_STATUS.IDLE);
  subject.onStatus(REALTIME_STATUS.IDLE);
  subject.requestPreview();
  await Promise.resolve();
  assert.equal(session.connects, 0, "a call opened into the gap is torn down mid-sentence");
  assert.equal(session.previews, 0);

  // The developer's call is back, in the new voice, and the sample rides it —
  // which is where a sample belongs while a conversation is being held.
  reopening = false;
  session.microphone = true;
  session.setStatus(REALTIME_STATUS.READY);
  subject.onStatus(REALTIME_STATUS.READY);
  assert.equal(session.connects, 0);
  assert.equal(session.previews, 1);
});

test("a pick made inside the handshake is heard in its own voice, not the replaced one", async () => {
  const session = fakeSession();
  session.slowHandshake = true;
  const timers = fakeTimers();
  // What the voice restart holds while it waits: a changed voice owed against
  // the call coming up, which cannot be paid until that call settles.
  let revoicing = false;
  const subject = announcer(session, timers, { revoicing: () => revoicing });

  // The first pick opens a call, and its credential is minted for that voice
  // across the whole handshake.
  subject.requestPreview();
  await Promise.resolve();
  assert.equal(session.connects, 1);
  assert.equal(session.status, REALTIME_STATUS.CONNECTING);

  // A second pick lands inside that stretch. The restart can only wait — there
  // is no settled call to tear down yet — so the voice now stored and the voice
  // the call is coming up in have come apart.
  revoicing = true;
  subject.requestPreview();

  // The call opens in the voice being replaced. Auditioning the new pick on it
  // would play the wrong voice and spend the ask doing it.
  session.settleHandshake();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(session.previews, 0, "the voice being replaced never speaks the sample");

  // The restart pays what it owed: the call is released, and the sample is
  // still waiting for the one that replaces it.
  revoicing = false;
  session.setStatus(REALTIME_STATUS.IDLE);
  subject.onStatus(REALTIME_STATUS.IDLE);
  await Promise.resolve();
  session.settleHandshake();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(session.connects, 2, "the voice now stored gets a call minted for it");
  assert.equal(session.previews, 1, "and is heard once, on that call");
});

test("a refused handshake keeps the pick made while it was going", async () => {
  const session = fakeSession();
  session.slowHandshake = true;
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  await Promise.resolve();
  assert.equal(session.connects, 1);

  // A newer click lands inside the handshake, and then the handshake is
  // refused. The sample that refusal belonged to goes with it; this one is a
  // different click, and still owed an answer.
  subject.requestPreview();
  session.settleHandshake();
  await Promise.resolve();
  await Promise.resolve();

  session.connectOpens = true;
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);
  await Promise.resolve();
  assert.equal(session.connects, 2, "the newer pick is tried on its own");
  session.settleHandshake();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(session.previews, 1);
});

test("a refusal with no newer pick behind it drops the sample and stops", async () => {
  const session = fakeSession();
  session.slowHandshake = true;
  session.connectOpens = false;
  const timers = fakeTimers();
  const subject = announcer(session, timers);

  subject.requestPreview();
  await Promise.resolve();
  session.settleHandshake();
  await Promise.resolve();
  await Promise.resolve();

  // Nothing superseded the sample this call was opened for, so the refusal
  // takes it — the status it raises must not start the attempt over.
  subject.onStatus(REALTIME_STATUS.UNAVAILABLE);
  await Promise.resolve();
  assert.equal(session.connects, 1, "a spent sample does not reopen the call it lost");
});

test("a sentence that went stale in the queue is dropped, not read as news", () => {
  const session = fakeSession();
  session.setStatus(REALTIME_STATUS.RESPONDING);
  session.microphone = true;
  const timers = fakeTimers();
  let now = 10_000;
  const subject = announcer(session, timers, { now: () => now });

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
