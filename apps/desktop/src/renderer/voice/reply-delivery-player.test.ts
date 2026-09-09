import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_REQUEST_ORIGIN, type BrainRequestOrigin } from "@sidecar/brain/requests";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import type { BrainReplyClaimResult, BrainReplyOffer } from "#shared/messages/brain";
import { drainMicrotasks } from "#testing/drain";
import { ReplyDeliveryPlayer } from "./reply-delivery-player";

interface Harness {
  player: ReplyDeliveryPlayer;
  /** What the player did, in order: claims, connects, speaks, notices, acknowledgements. */
  log: string[];
  /** Answers the outstanding claim. */
  grant: (result: BrainReplyClaimResult) => void;
  /** Answers the outstanding connect. */
  connected: (opened: boolean) => void;
  session: {
    isConnected: boolean;
    microphoneCall: boolean;
    status: RealtimeStatus;
    speaks: boolean;
  };
  generation: { current: number };
}

function offer(runId: string, epoch = 1): BrainReplyOffer {
  return { runId, deliveryId: `delivery-${runId}`, epoch };
}

function harness(): Harness {
  const log: string[] = [];
  const claims: ((result: BrainReplyClaimResult) => void)[] = [];
  const connects: ((opened: boolean) => void)[] = [];
  const session: Harness["session"] = {
    isConnected: false,
    microphoneCall: false,
    status: REALTIME_STATUS.IDLE,
    speaks: true,
  };
  const generation = { current: 1 };
  const player = new ReplyDeliveryPlayer({
    session: () => ({
      get isConnected() {
        return session.isConnected;
      },
      get microphoneCall() {
        return session.microphoneCall;
      },
      get status() {
        return session.status;
      },
      speakReply: (words, runId) => {
        log.push(`speak ${runId}: ${words}`);
        return session.speaks;
      },
    }),
    connect: () => {
      log.push("connect");
      return new Promise((resolve) => {
        connects.push(resolve);
      });
    },
    claim: (candidate) => {
      log.push(`claim ${candidate.runId}@${candidate.epoch}`);
      return new Promise((resolve) => {
        claims.push(resolve);
      });
    },
    acknowledge: (candidate) => log.push(`ack ${candidate.runId}@${candidate.epoch}`),
    showNotice: (words) => log.push(`notice ${words}`),
    onSpeaking: (origin) => log.push(`speaking ${origin}`),
    conversationGeneration: () => generation.current,
  });
  return {
    player,
    log,
    grant: (result) => claims.shift()?.(result),
    connected: (opened) => {
      session.isConnected = opened;
      session.microphoneCall = opened;
      if (opened) session.status = REALTIME_STATUS.READY;
      connects.shift()?.(opened);
    },
    session,
    generation,
  };
}

function granted(
  words: string,
  origin: BrainRequestOrigin = BRAIN_REQUEST_ORIGIN.TYPED,
): BrainReplyClaimResult {
  return { granted: true, words, origin };
}

test("an offer is claimed, the call opened, the words spoken once, and acknowledged when the reply ends", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  assert.deepEqual(h.log, ["claim run-1@1"]);
  h.grant(granted("Two agents are waiting."));
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(1), ["connect"]);
  h.connected(true);
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(2), ["speak run-1: Two agents are waiting.", "speaking typed"]);
  assert.equal(h.player.active?.runId, "run-1");
  // The same offer again is the same offer; another run's ending is not this one's.
  h.player.offer(offer("run-1"));
  h.player.onReplyEnded("run-other");
  assert.equal(h.log.length, 4);
  h.player.onReplyEnded("run-1");
  assert.deepEqual(h.log.slice(4), ["ack run-1@1"]);
  assert.equal(h.player.active, undefined);
});

test("a Clear while the claim is out leaves the granted words unspoken, unshown, and unacknowledged", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  // The History generation moves while the claim is in flight.
  h.generation.current += 1;
  h.player.withdraw();
  h.grant(granted("Old words."));
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1"]);
  assert.equal(h.player.pending, undefined);
  assert.equal(h.player.active, undefined);
});

test("a withdrawn generation while the call is opening leaves the words unspoken and nothing acknowledged", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  h.grant(granted("Old words."));
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1", "connect"]);
  // The generation ends — expiry, or a Clear from a panel — mid-connect.
  h.player.withdraw();
  h.connected(true);
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1", "connect"]);
  // A new offer, of the new generation, is claimed afresh.
  h.player.offer(offer("run-2", 1));
  assert.deepEqual(h.log.at(-1), "claim run-2@1");
});

test("a newer offer arriving during a claim retires the older attempt without speaking it", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  h.player.offer(offer("run-2"));
  h.grant(granted("First."));
  await drainMicrotasks(1);
  // The first grant is not spoken; the pending offer is now the second, claimed next.
  assert.deepEqual(h.log, ["claim run-1@1", "claim run-2@1"]);
});

test("a refused claim empties the hand with nothing said", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  h.grant({ granted: false });
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1"]);
  assert.equal(h.player.pending, undefined);
});

test("words the voice cannot say are shown once and acknowledged at once", async () => {
  const h = harness();
  h.session.speaks = false;
  h.player.offer(offer("run-1"));
  h.grant(granted("Two agents are waiting."));
  await drainMicrotasks(1);
  h.connected(true);
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(2), [
    "speak run-1: Two agents are waiting.",
    "notice Two agents are waiting.",
    "ack run-1@1",
  ]);
  assert.equal(h.player.active, undefined);
});

test("an offer waits for a quiet moment: not while the developer talks or a reply is under way", async () => {
  const h = harness();
  h.session.isConnected = true;
  h.session.microphoneCall = true;
  h.session.status = REALTIME_STATUS.LISTENING;
  h.player.offer(offer("run-1"));
  assert.deepEqual(h.log, []);
  h.session.status = REALTIME_STATUS.RESPONDING;
  h.player.onStatus(REALTIME_STATUS.RESPONDING);
  assert.deepEqual(h.log, []);
  // The developer's own reply ends; now the offer is claimed, on the open call.
  h.session.status = REALTIME_STATUS.READY;
  h.player.onStatus(REALTIME_STATUS.READY);
  assert.deepEqual(h.log, ["claim run-1@1"]);
  h.grant(granted("Now."));
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(1), ["speak run-1: Now.", "speaking typed"]);
});

test("the call ending under a delivered reply acknowledges it, so the next may be offered", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  h.grant(granted("Words."));
  await drainMicrotasks(1);
  h.connected(true);
  await drainMicrotasks(1);
  assert.equal(h.player.active?.runId, "run-1");
  h.session.status = REALTIME_STATUS.FAILED;
  h.player.onStatus(REALTIME_STATUS.FAILED);
  assert.deepEqual(h.log.at(-1), "ack run-1@1");
  assert.equal(h.player.active, undefined);
});

test("a withdrawal while a delivered reply plays acknowledges nothing: the main process already let go", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  h.grant(granted("Words."));
  await drainMicrotasks(1);
  h.connected(true);
  await drainMicrotasks(1);
  h.player.withdraw();
  h.player.onReplyEnded("run-1");
  assert.equal(h.log.filter((line) => line.startsWith("ack")).length, 0);
});

test("a delivered reply carries the origin of the ask it answers, so only a typed one holds the composer's caption", async () => {
  const h = harness();
  h.player.offer(offer("run-s"));
  h.grant(granted("Later.", BRAIN_REQUEST_ORIGIN.SPOKEN));
  await drainMicrotasks(1);
  h.connected(true);
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(2), ["speak run-s: Later.", "speaking spoken"]);
});

test("a grant landing after the developer took the turn is held, not spoken over them, and spoken once at the next quiet status", async () => {
  const h = harness();
  h.session.isConnected = true;
  h.session.microphoneCall = true;
  h.session.status = REALTIME_STATUS.READY;
  h.player.offer(offer("run-1"));
  assert.deepEqual(h.log, ["claim run-1@1"]);
  // The developer starts a turn while the claim is out.
  h.session.status = REALTIME_STATUS.LISTENING;
  h.player.onStatus(REALTIME_STATUS.LISTENING);
  h.grant(granted("Held words."));
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1"]);
  h.session.status = REALTIME_STATUS.RESPONDING;
  h.player.onStatus(REALTIME_STATUS.RESPONDING);
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1"]);
  // Their reply ends: the held grant is spoken, with no second claim.
  h.session.status = REALTIME_STATUS.READY;
  h.player.onStatus(REALTIME_STATUS.READY);
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(1), ["speak run-1: Held words.", "speaking typed"]);
  assert.equal(h.player.active?.runId, "run-1");
});

test("a grant whose call opened into the developer's turn is held through the connect and spoken once later", async () => {
  const h = harness();
  h.player.offer(offer("run-1"));
  h.grant(granted("Held words."));
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1", "connect"]);
  // The call opens, but the developer is already talking on it.
  h.connected(true);
  h.session.status = REALTIME_STATUS.LISTENING;
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1", "connect"]);
  h.player.onStatus(REALTIME_STATUS.RESPONDING);
  h.session.status = REALTIME_STATUS.READY;
  h.player.onStatus(REALTIME_STATUS.READY);
  await drainMicrotasks(1);
  assert.deepEqual(h.log.slice(2), ["speak run-1: Held words.", "speaking typed"]);
  assert.equal(h.log.filter((line) => line.startsWith("claim")).length, 1);
});

test("a held grant is voided by a withdrawal: the next quiet status speaks nothing and acknowledges nothing", async () => {
  const h = harness();
  h.session.isConnected = true;
  h.session.microphoneCall = true;
  h.session.status = REALTIME_STATUS.READY;
  h.player.offer(offer("run-1"));
  h.session.status = REALTIME_STATUS.RESPONDING;
  h.player.onStatus(REALTIME_STATUS.RESPONDING);
  h.grant(granted("Held words."));
  await drainMicrotasks(1);
  h.player.withdraw();
  h.session.status = REALTIME_STATUS.READY;
  h.player.onStatus(REALTIME_STATUS.READY);
  await drainMicrotasks(1);
  assert.deepEqual(h.log, ["claim run-1@1"]);
});
