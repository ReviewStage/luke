import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_DELIVERY_SOURCE, type BrainDelivery } from "@sidecar/brain";
import type { SpeechTraceRecord } from "@sidecar/devtrace";
import {
  ARRIVAL_SPEECH_KIND,
  BRIEFING_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  isBriefingSpeech,
} from "@sidecar/realtime";
import { SPEECH_OUTCOME } from "#shared/wire/speech";
import {
  MAXIMUM_PENDING_BRIEFINGS,
  SPEECH_DECISION,
  SPOKEN_NOTICE_MAX_AGE_MS,
  SpeechArbiter,
} from "./speech-arbiter";

function delivery(briefing: string, decidedAt = 1_000): BrainDelivery {
  return { briefing, decidedAt, source: BRAIN_DELIVERY_SOURCE.WAKE };
}

interface Harness {
  arbiter: SpeechArbiter;
  traces: SpeechTraceRecord[];
  clock: { now: number };
}

function harness(now = 1_000): Harness {
  const clock = { now };
  const traces: SpeechTraceRecord[] = [];
  let id = 0;
  const arbiter = new SpeechArbiter({
    now: () => clock.now,
    nextId: () => {
      id += 1;
      return `id-${id}`;
    },
    trace: (record) => traces.push(record),
  });
  return { arbiter, traces, clock };
}

function requestBriefing(arbiter: SpeechArbiter, text: string, decidedAt = 1_000): void {
  arbiter.request({ kind: BRIEFING_SPEECH_KIND, delivery: delivery(text, decidedAt) });
}

/** The briefing an offer carries, or the beat kind it names. */
function offeredWords(arbiter: SpeechArbiter): string | undefined {
  const offer = arbiter.next();
  if (!offer) return undefined;
  return isBriefingSpeech(offer.turn) ? offer.turn.briefing : offer.turn.kind;
}

test("a beat is requested once: pending, offered, or spent, the repeat is dropped", () => {
  const { arbiter, traces } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(traces.at(-1)?.decision, SPEECH_DECISION.DROPPED);

  const offer = arbiter.next();
  assert.ok(offer);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1, "offered still counts as pending");

  arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 0, "a spoken beat is spent for the run");
  // A different beat is its own line and is not deduped against the first.
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1);
});

test("the briefing backlog sheds its oldest whole past the bound", () => {
  const { arbiter } = harness();
  for (let index = 0; index < MAXIMUM_PENDING_BRIEFINGS + 2; index += 1) {
    requestBriefing(arbiter, `briefing ${index}`);
  }
  assert.equal(arbiter.pendingCount, MAXIMUM_PENDING_BRIEFINGS);

  arbiter.setQuiet(true);
  const held = arbiter.takeHeldBriefings();
  assert.equal(held.length, MAXIMUM_PENDING_BRIEFINGS);
  // The oldest went first: a backlog re-decided in one turn wants the recent few.
  assert.equal(held[0]?.briefing, "briefing 2");
  assert.equal(held.at(-1)?.briefing, `briefing ${MAXIMUM_PENDING_BRIEFINGS + 1}`);
  assert.equal(held[0]?.source, BRAIN_DELIVERY_SOURCE.WAKE);
  assert.equal(arbiter.pendingCount, 0);
  assert.deepEqual(arbiter.takeHeldBriefings(), []);
});

test("the bound never sheds the briefing the mouth already holds", () => {
  const { arbiter } = harness();
  requestBriefing(arbiter, "offered");
  const offer = arbiter.next();
  assert.ok(offer);
  for (let index = 0; index < MAXIMUM_PENDING_BRIEFINGS + 1; index += 1) {
    requestBriefing(arbiter, `later ${index}`);
  }
  assert.equal(arbiter.pendingCount, MAXIMUM_PENDING_BRIEFINGS);
  assert.equal(arbiter.offeredId, offer.id);
  // Settling the held one still lands: it was never taken out from under the mouth.
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN)?.kind, BRIEFING_SPEECH_KIND);
  assert.equal(offeredWords(arbiter), "later 2");
});

test("a request arriving under quiet enters held, and nothing is offered", () => {
  const { arbiter } = harness();
  arbiter.setQuiet(true);
  requestBriefing(arbiter, "quiet news");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.heldBriefingCount, 1);
  assert.equal(arbiter.next(), undefined);
  assert.equal(arbiter.pendingCount, 2);
});

test("quiet beginning holds every pending request; quiet ending releases the beats alone", () => {
  const { arbiter, clock } = harness();
  requestBriefing(arbiter, "before");
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  assert.equal(arbiter.heldBriefingCount, 0);

  arbiter.setQuiet(true);
  assert.equal(arbiter.heldBriefingCount, 1);
  assert.equal(arbiter.next(), undefined);

  // The meeting runs long past the news window; a held request does not age.
  clock.now += SPOKEN_NOTICE_MAX_AGE_MS * 3;
  arbiter.setQuiet(false);
  assert.equal(arbiter.heldBriefingCount, 1, "briefings wait for the brain, not the mouth");
  // The beat is released on a fresh clock: it is offered, not aged out, and
  // its deadline runs from the release.
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(offer.turn.kind, CALENDAR_ONBOARDING_SPEECH_KIND);
  assert.equal(offer.turn.decidedAt, clock.now);
  assert.equal(offer.speakBy, clock.now + SPOKEN_NOTICE_MAX_AGE_MS);
});

test("held briefings are taken in order with their source intact, once", () => {
  const { arbiter } = harness();
  arbiter.setQuiet(true);
  requestBriefing(arbiter, "first");
  requestBriefing(arbiter, "second");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  arbiter.setQuiet(false);

  const taken = arbiter.takeHeldBriefings();
  assert.deepEqual(
    taken.map((item) => item.briefing),
    ["first", "second"],
  );
  assert.ok(taken.every((item) => item.source === BRAIN_DELIVERY_SOURCE.WAKE));
  assert.equal(arbiter.heldBriefingCount, 0);
  assert.equal(arbiter.pendingCount, 1, "the beat is not a briefing and stays");
  assert.deepEqual(arbiter.takeHeldBriefings(), []);
});

test("dropBriefings discards every waiting briefing and nothing else", () => {
  const { arbiter, traces } = harness();
  requestBriefing(arbiter, "a");
  requestBriefing(arbiter, "b");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  arbiter.dropBriefings();
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(offeredWords(arbiter), ARRIVAL_SPEECH_KIND);
  assert.equal(traces.filter((record) => record.decision === SPEECH_DECISION.DROPPED).length, 2);
});

test("nothing is offered while quiet or while an offer is outstanding", () => {
  const { arbiter } = harness();
  requestBriefing(arbiter, "a");
  requestBriefing(arbiter, "b");
  const first = arbiter.next();
  assert.ok(first);
  assert.equal(arbiter.next(), undefined, "one offer at a time");
  assert.equal(arbiter.offeredId, first.id);

  arbiter.settle(first.id, SPEECH_OUTCOME.SPOKEN);
  arbiter.setQuiet(true);
  assert.equal(arbiter.next(), undefined, "nothing under quiet");
  arbiter.setQuiet(false);
  // The briefing that stood when the quiet began is held for the brain.
  assert.equal(arbiter.next(), undefined);
  assert.equal(arbiter.heldBriefingCount, 1);
});

test("offers go out FIFO across kinds, each with its deadline from its own decision", () => {
  const { arbiter, clock } = harness(5_000);
  requestBriefing(arbiter, "news", 4_000);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  clock.now = 6_000;
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });

  const first = arbiter.next();
  assert.ok(first && isBriefingSpeech(first.turn));
  assert.equal(first.turn.briefing, "news");
  assert.equal(first.turn.decidedAt, 4_000);
  assert.equal(first.speakBy, 4_000 + SPOKEN_NOTICE_MAX_AGE_MS);
  arbiter.settle(first.id, SPEECH_OUTCOME.SPOKEN);

  const second = arbiter.next();
  assert.ok(second);
  assert.equal(second.turn.kind, ARRIVAL_SPEECH_KIND);
  assert.equal(second.turn.decidedAt, 5_000);
  assert.equal(second.speakBy, 5_000 + SPOKEN_NOTICE_MAX_AGE_MS);
  arbiter.settle(second.id, SPEECH_OUTCOME.SPOKEN);

  const third = arbiter.next();
  assert.ok(third);
  assert.equal(third.turn.kind, CALENDAR_ONBOARDING_SPEECH_KIND);
  assert.equal(third.turn.decidedAt, 6_000);
  assert.equal(third.speakBy, 6_000 + SPOKEN_NOTICE_MAX_AGE_MS);
  assert.notEqual(first.id, second.id);
  assert.notEqual(second.id, third.id);
});

test("next ages out unheld requests, spends a stale beat, and never ages a held one", () => {
  const { arbiter, clock, traces } = harness(10_000);
  arbiter.setQuiet(true);
  requestBriefing(arbiter, "held", 10_000);
  arbiter.setQuiet(false);
  requestBriefing(arbiter, "old", 5_000);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  clock.now = 5_000 + SPOKEN_NOTICE_MAX_AGE_MS + 1;

  // Nothing arrives at the mouth stale: the aged briefing is settled here,
  // the beat requested later still stands, and the held briefing waits out
  // the hold rather than the clock.
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(offer.turn.kind, ARRIVAL_SPEECH_KIND);
  assert.equal(arbiter.heldBriefingCount, 1);
  assert.equal(traces.filter((record) => record.decision === SPEECH_OUTCOME.STALE).length, 1);

  // A beat that ages out is spent for the run.
  arbiter.settle(offer.id, SPEECH_OUTCOME.HELD);
  arbiter.setQuiet(true);
  arbiter.setQuiet(false);
  clock.now += SPOKEN_NOTICE_MAX_AGE_MS + 1;
  assert.equal(arbiter.next(), undefined);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1, "only the held briefing stands; the beat is spent");
  assert.equal(arbiter.heldBriefingCount, 1);
});

test("settle SPOKEN ends the request and spends a beat; the next is then offered", () => {
  const { arbiter } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  requestBriefing(arbiter, "after");
  const offer = arbiter.next();
  assert.ok(offer);
  const settled = arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);
  assert.equal(settled?.kind, ARRIVAL_SPEECH_KIND);
  assert.equal(settled?.outcome, SPEECH_OUTCOME.SPOKEN);
  assert.equal(settled?.request.id, offer.id);
  assert.equal(arbiter.offeredId, undefined);
  assert.equal(offeredWords(arbiter), "after");
});

test("settle HELD returns the request to the head, held, unspent", () => {
  const { arbiter } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  requestBriefing(arbiter, "later");
  const offer = arbiter.next();
  assert.ok(offer);
  arbiter.setQuiet(true);
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.HELD)?.outcome, SPEECH_OUTCOME.HELD);
  assert.equal(arbiter.pendingCount, 2);
  assert.equal(arbiter.offeredId, undefined);

  arbiter.setQuiet(false);
  // The beat is offered again, ahead of the briefing behind it, with a new deadline.
  const again = arbiter.next();
  assert.ok(again);
  assert.equal(again.id, offer.id);
  assert.equal(again.turn.kind, ARRIVAL_SPEECH_KIND);
  // A held beat was not spent: had it been, the repeat request would be dropped
  // — instead it is deduped against the pending one, and the count holds.
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 2);
});

test("settle HELD while no quiet stands returns the request to the head unheld", () => {
  // The mouth read a hold the panel still drew after the quiet had ended
  // here; the request must not wait for a release that can never come.
  const { arbiter, traces } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(arbiter.quiet, false);
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.HELD)?.outcome, SPEECH_OUTCOME.HELD);
  assert.equal(traces.at(-1)?.decision, SPEECH_OUTCOME.HELD);

  const again = arbiter.next();
  assert.ok(again);
  assert.equal(again.id, offer.id);
  assert.equal(again.turn.kind, ARRIVAL_SPEECH_KIND);
});

test("settle STALE ends the request and spends a beat", () => {
  const { arbiter } = harness();
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.STALE)?.outcome, SPEECH_OUTCOME.STALE);
  assert.equal(arbiter.pendingCount, 0);
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 0, "spent for the run");
});

test("settle REFUSED ends every pending request and spends the pending beats", () => {
  const { arbiter, traces } = harness();
  requestBriefing(arbiter, "a");
  requestBriefing(arbiter, "b");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  const settled = arbiter.settle(offer.id, SPEECH_OUTCOME.REFUSED);
  assert.equal(settled?.outcome, SPEECH_OUTCOME.REFUSED);
  assert.equal(arbiter.pendingCount, 0);
  assert.equal(traces.filter((record) => record.decision === SPEECH_OUTCOME.REFUSED).length, 3);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 0, "a refused beat is spent for the run");
  // Fresh news starts a fresh backlog.
  requestBriefing(arbiter, "c");
  assert.equal(offeredWords(arbiter), "c");
});

test("an unknown id is ignored, whether never offered, withdrawn, or already settled", () => {
  const { arbiter } = harness();
  requestBriefing(arbiter, "a");
  assert.equal(arbiter.settle("nobody", SPEECH_OUTCOME.SPOKEN), undefined);
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(arbiter.settle("nobody", SPEECH_OUTCOME.SPOKEN), undefined);
  assert.equal(arbiter.offeredId, offer.id, "a stray report does not clear the real offer");
  arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.REFUSED), undefined);
});

test("retract removes a pending beat silently and names an offered one for withdrawal", () => {
  const { arbiter } = harness();
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  assert.equal(arbiter.retract(CALENDAR_ONBOARDING_SPEECH_KIND), undefined);
  assert.equal(arbiter.pendingCount, 0);
  assert.equal(arbiter.retract(CALENDAR_ONBOARDING_SPEECH_KIND), undefined);

  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(arbiter.retract(CALENDAR_ONBOARDING_SPEECH_KIND), offer.id);
  assert.equal(arbiter.offeredId, undefined);
  // A late settle for the withdrawn offer is ignored; withdrawal spent nothing.
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN), undefined);
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1);
});

test("an offer past its deadline with no settle is reclaimed stale and the head re-offered", () => {
  const { arbiter, clock, traces } = harness(1_000);
  requestBriefing(arbiter, "lost", 1_000);
  clock.now = 1_500;
  requestBriefing(arbiter, "next", 1_500);
  const lost = arbiter.next();
  assert.ok(lost);
  // The renderer reloaded: no settle ever comes. Before the deadline, the
  // arbiter waits on it.
  clock.now = lost.speakBy;
  assert.equal(arbiter.next(), undefined);

  clock.now = lost.speakBy + 1;
  const reoffered = arbiter.next();
  assert.ok(reoffered && isBriefingSpeech(reoffered.turn));
  assert.equal(reoffered.turn.briefing, "next");
  assert.notEqual(reoffered.id, lost.id);
  assert.equal(traces.filter((record) => record.decision === SPEECH_OUTCOME.STALE).length, 1);
  assert.equal(
    arbiter.settle(lost.id, SPEECH_OUTCOME.SPOKEN),
    undefined,
    "the late report is ignored",
  );
});

test("every trace record carries a kind, a decision, and a count, and never the words", () => {
  const { arbiter, clock, traces } = harness();
  requestBriefing(arbiter, "the secret sentence");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);
  arbiter.setQuiet(true);
  arbiter.setQuiet(false);
  clock.now += SPOKEN_NOTICE_MAX_AGE_MS + 1;
  arbiter.next();
  arbiter.dropBriefings();

  assert.ok(traces.length >= 5);
  const decisions = new Set<string>(Object.values(SPEECH_DECISION));
  for (const record of traces) {
    assert.deepEqual(Object.keys(record).sort(), ["decision", "kind", "pendingCount"]);
    assert.ok(decisions.has(record.decision));
    assert.ok(Number.isInteger(record.pendingCount) && record.pendingCount >= 0);
    assert.equal("briefing" in record, false);
    assert.equal(JSON.stringify(record).includes("secret"), false);
  }
});
