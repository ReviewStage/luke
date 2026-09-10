import assert from "node:assert/strict";
import test from "node:test";
import type { BrainUtterance } from "@sidecar/brain";
import type { SpeechTraceRecord } from "@sidecar/devtrace";
import {
  ARRIVAL_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  UTTERANCE_SPEECH_KIND,
} from "@sidecar/realtime";
import { SPEECH_OUTCOME } from "@sidecar/realtime/speech";
import { FakeClock } from "@sidecar/runtime/testing";
import {
  MAXIMUM_PENDING_UTTERANCES,
  SPEECH_DECISION,
  SPOKEN_NOTICE_MAX_AGE_MS,
  SpeechArbiter,
} from "./speech-arbiter.js";

function utterance(text: string, decidedAt = 1_000): BrainUtterance {
  return { text, decidedAt };
}

interface Harness {
  arbiter: SpeechArbiter;
  traces: SpeechTraceRecord[];
  clock: FakeClock;
}

function harness(now = 1_000): Harness {
  const clock = new FakeClock(now);
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

function requestUtterance(arbiter: SpeechArbiter, text: string, decidedAt = 1_000): void {
  arbiter.request({ kind: UTTERANCE_SPEECH_KIND, utterance: utterance(text, decidedAt) });
}

/** The words an offer carries, or the beat kind it names. */
function offeredWords(arbiter: SpeechArbiter): string | undefined {
  const offer = arbiter.next();
  if (!offer) return undefined;
  return offer.turn.kind === UTTERANCE_SPEECH_KIND ? offer.turn.text : offer.turn.kind;
}

function dropped(traces: readonly SpeechTraceRecord[]): number {
  return traces.filter((record) => record.decision === SPEECH_DECISION.DROPPED).length;
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

test("the utterance backlog sheds its oldest whole past the bound", () => {
  const { arbiter, traces } = harness();
  for (let index = 0; index < MAXIMUM_PENDING_UTTERANCES + 2; index += 1) {
    requestUtterance(arbiter, `utterance ${index}`);
  }
  assert.equal(arbiter.pendingCount, MAXIMUM_PENDING_UTTERANCES);
  assert.equal(dropped(traces), 2);
  // The oldest went first: the mouth reads the recent few.
  assert.equal(offeredWords(arbiter), "utterance 2");
});

test("the bound never sheds the utterance the mouth already holds", () => {
  const { arbiter } = harness();
  requestUtterance(arbiter, "offered");
  const offer = arbiter.next();
  assert.ok(offer);
  for (let index = 0; index < MAXIMUM_PENDING_UTTERANCES + 1; index += 1) {
    requestUtterance(arbiter, `later ${index}`);
  }
  assert.equal(arbiter.pendingCount, MAXIMUM_PENDING_UTTERANCES);
  assert.equal(arbiter.offeredId, offer.id);
  // Settling the held one still lands: it was never taken out from under the mouth.
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN)?.kind, UTTERANCE_SPEECH_KIND);
  assert.equal(offeredWords(arbiter), "later 2");
});

test("an utterance requested under quiet is dropped; a beat enters held and nothing is offered", () => {
  const { arbiter, traces } = harness();
  arbiter.setQuiet(true);
  requestUtterance(arbiter, "quiet news");
  assert.equal(arbiter.pendingCount, 0);
  assert.equal(traces.at(-1)?.decision, SPEECH_DECISION.DROPPED);
  assert.equal(traces.at(-1)?.kind, UTTERANCE_SPEECH_KIND);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(arbiter.next(), undefined);
  // The quiet over, the beat is offered and the utterance is gone for good.
  arbiter.setQuiet(false);
  assert.equal(offeredWords(arbiter), ARRIVAL_SPEECH_KIND);
});

test("quiet beginning drops every pending utterance but holds the beats; quiet ending releases the beats on a fresh clock", () => {
  const { arbiter, clock, traces } = harness();
  requestUtterance(arbiter, "before");
  requestUtterance(arbiter, "also before");
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 3);

  arbiter.setQuiet(true);
  assert.equal(arbiter.pendingCount, 1, "only the beat stands");
  assert.equal(dropped(traces), 2);
  assert.equal(arbiter.next(), undefined);

  // The meeting runs long past the news window; a held beat does not age.
  clock.now += SPOKEN_NOTICE_MAX_AGE_MS * 3;
  arbiter.setQuiet(false);
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(offer.turn.kind, CALENDAR_ONBOARDING_SPEECH_KIND);
  assert.equal(offer.turn.decidedAt, clock.now);
  assert.equal(offer.speakBy, clock.now + SPOKEN_NOTICE_MAX_AGE_MS);
});

test("quiet beginning leaves the offered utterance to the mouth's own settle", () => {
  const { arbiter, traces } = harness();
  requestUtterance(arbiter, "in the mouth");
  requestUtterance(arbiter, "waiting");
  const offer = arbiter.next();
  assert.ok(offer);
  arbiter.setQuiet(true);
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(arbiter.offeredId, offer.id);
  assert.equal(dropped(traces), 1);
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN)?.outcome, SPEECH_OUTCOME.SPOKEN);
  assert.equal(arbiter.pendingCount, 0);
});

test("nothing is offered while quiet or while an offer is outstanding", () => {
  const { arbiter } = harness();
  requestUtterance(arbiter, "a");
  requestUtterance(arbiter, "b");
  const first = arbiter.next();
  assert.ok(first);
  assert.equal(arbiter.next(), undefined, "one offer at a time");
  assert.equal(arbiter.offeredId, first.id);

  arbiter.settle(first.id, SPEECH_OUTCOME.SPOKEN);
  arbiter.setQuiet(true);
  assert.equal(arbiter.next(), undefined, "nothing under quiet");
  arbiter.setQuiet(false);
  // The utterance that stood when the quiet began was dropped with it.
  assert.equal(arbiter.next(), undefined);
  assert.equal(arbiter.pendingCount, 0);
});

test("offers go out FIFO across kinds, each with its deadline from its own decision", () => {
  const { arbiter, clock } = harness(5_000);
  requestUtterance(arbiter, "news", 4_000);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  clock.now = 6_000;
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });

  const first = arbiter.next();
  assert.ok(first && first.turn.kind === UTTERANCE_SPEECH_KIND);
  assert.equal(first.turn.text, "news");
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
  arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
  requestUtterance(arbiter, "old", 5_000);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  clock.now = 5_000 + SPOKEN_NOTICE_MAX_AGE_MS + 1;

  // Held beats wait out the hold rather than the clock: nothing is offered
  // and nothing ages while the quiet stands.
  assert.equal(arbiter.next(), undefined);
  assert.equal(arbiter.pendingCount, 2);
  arbiter.setQuiet(false);
  const offer = arbiter.next();
  assert.ok(offer);
  assert.equal(offer.turn.kind, CALENDAR_ONBOARDING_SPEECH_KIND);
  arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);

  // An unheld utterance past the window is settled stale here, and the beat
  // requested later still stands.
  requestUtterance(arbiter, "old", 5_000);
  const next = arbiter.next();
  assert.ok(next);
  assert.equal(next.turn.kind, ARRIVAL_SPEECH_KIND);
  assert.equal(traces.filter((record) => record.decision === SPEECH_OUTCOME.STALE).length, 1);

  // A beat that ages out is spent for the run.
  arbiter.settle(next.id, SPEECH_OUTCOME.HELD);
  clock.now += SPOKEN_NOTICE_MAX_AGE_MS + 1;
  assert.equal(arbiter.next(), undefined);
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 0, "the beat is spent");
});

test("settle SPOKEN ends the request and spends a beat; the next is then offered", () => {
  const { arbiter } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  requestUtterance(arbiter, "after");
  const offer = arbiter.next();
  assert.ok(offer);
  const settled = arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);
  assert.equal(settled?.kind, ARRIVAL_SPEECH_KIND);
  assert.equal(settled?.outcome, SPEECH_OUTCOME.SPOKEN);
  assert.equal(settled?.request.id, offer.id);
  assert.equal(arbiter.offeredId, undefined);
  assert.equal(offeredWords(arbiter), "after");
});

test("settle HELD returns a beat to the head, held, unspent", () => {
  const { arbiter } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  arbiter.setQuiet(true);
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.HELD)?.outcome, SPEECH_OUTCOME.HELD);
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(arbiter.offeredId, undefined);

  arbiter.setQuiet(false);
  // The beat is offered again with a new deadline.
  const again = arbiter.next();
  assert.ok(again);
  assert.equal(again.id, offer.id);
  assert.equal(again.turn.kind, ARRIVAL_SPEECH_KIND);
  // A held beat was not spent: had it been, the repeat request would be dropped
  // — instead it is deduped against the pending one, and the count holds.
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  assert.equal(arbiter.pendingCount, 1);
});

test("settle HELD drops an utterance", () => {
  const { arbiter, traces } = harness();
  requestUtterance(arbiter, "decided against a roster that moved on");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer && offer.turn.kind === UTTERANCE_SPEECH_KIND);
  arbiter.setQuiet(true);
  const settled = arbiter.settle(offer.id, SPEECH_OUTCOME.HELD);
  assert.equal(settled?.kind, UTTERANCE_SPEECH_KIND);
  assert.equal(settled?.outcome, SPEECH_OUTCOME.HELD);
  assert.equal(traces.at(-1)?.decision, SPEECH_DECISION.DROPPED);
  assert.equal(arbiter.offeredId, undefined);
  assert.equal(arbiter.pendingCount, 1, "the beat behind it stands, held");
  arbiter.setQuiet(false);
  assert.equal(offeredWords(arbiter), ARRIVAL_SPEECH_KIND);
  // A late settle for the dropped utterance names nothing.
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN), undefined);
});

test("settle HELD while no quiet stands returns the request to the head unheld", () => {
  // The mouth read a hold the panel still drew after the quiet had ended
  // here; the request must not wait for a release that can never come.
  const { arbiter, traces } = harness();
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
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
  requestUtterance(arbiter, "a");
  requestUtterance(arbiter, "b");
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
  requestUtterance(arbiter, "c");
  assert.equal(offeredWords(arbiter), "c");
});

test("an unknown id is ignored, whether never offered, withdrawn, or already settled", () => {
  const { arbiter } = harness();
  requestUtterance(arbiter, "a");
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
  requestUtterance(arbiter, "lost", 1_000);
  clock.now = 1_500;
  requestUtterance(arbiter, "next", 1_500);
  const lost = arbiter.next();
  assert.ok(lost);
  // The renderer reloaded: no settle ever comes. Before the deadline, the
  // arbiter waits on it.
  clock.now = lost.speakBy;
  assert.equal(arbiter.next(), undefined);

  clock.now = lost.speakBy + 1;
  const reoffered = arbiter.next();
  assert.ok(reoffered && reoffered.turn.kind === UTTERANCE_SPEECH_KIND);
  assert.equal(reoffered.turn.text, "next");
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
  requestUtterance(arbiter, "the secret sentence");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(offer);
  arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN);
  arbiter.setQuiet(true);
  requestUtterance(arbiter, "the secret sentence again");
  arbiter.setQuiet(false);
  clock.now += SPOKEN_NOTICE_MAX_AGE_MS + 1;
  arbiter.next();
  arbiter.withdrawUtterances();

  assert.ok(traces.length >= 5);
  const decisions = new Set<string>(Object.values(SPEECH_DECISION));
  for (const record of traces) {
    assert.deepEqual(Object.keys(record).sort(), ["decision", "kind", "pendingCount"]);
    assert.ok(decisions.has(record.decision));
    assert.ok(Number.isInteger(record.pendingCount) && record.pendingCount >= 0);
    assert.equal("text" in record, false);
    assert.equal(JSON.stringify(record).includes("secret"), false);
  }
});

test("withdrawing utterances takes the queued and the offered alike, answers the offered id, and leaves beats standing", () => {
  const { arbiter, clock, traces } = harness();
  requestUtterance(arbiter, "OFFERED_OLD");
  requestUtterance(arbiter, "QUEUED_OLD");
  arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
  const offer = arbiter.next();
  assert.ok(
    offer && offer.turn.kind === UTTERANCE_SPEECH_KIND && offer.turn.text === "OFFERED_OLD",
  );

  assert.equal(arbiter.withdrawUtterances(), offer.id);
  assert.equal(arbiter.offeredId, undefined);
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(dropped(traces), 2);
  // The mouth's late report on the withdrawn offer is nobody's.
  assert.equal(arbiter.settle(offer.id, SPEECH_OUTCOME.SPOKEN), undefined);
  clock.now += 1;
  assert.equal(offeredWords(arbiter), ARRIVAL_SPEECH_KIND);
  // Nothing to withdraw answers nothing, and a beat is never an utterance.
  assert.equal(arbiter.withdrawUtterances(), undefined);
});

test("reclaiming takes the outstanding offer back to the head unspoken, so the next receiver is offered it at once", () => {
  const { arbiter, traces, clock } = harness();
  requestUtterance(arbiter, "first");
  requestUtterance(arbiter, "second");
  const offered = arbiter.next();
  assert.equal(
    offered && offered.turn.kind === UTTERANCE_SPEECH_KIND ? offered.turn.text : undefined,
    "first",
  );
  // While the offer stands, nothing else is offered.
  assert.equal(arbiter.next(), undefined);
  // The renderer holding it is gone: the offer is reclaimed, not settled.
  arbiter.reclaimOffer();
  assert.equal(arbiter.offeredId, undefined);
  assert.equal(arbiter.pendingCount, 2);
  const again = arbiter.next();
  assert.equal(
    again && again.turn.kind === UTTERANCE_SPEECH_KIND ? again.turn.text : undefined,
    "first",
  );
  // The reoffer carries a fresh id, so a late settle from the vanished renderer
  // names an offer nobody holds and is ignored.
  assert.notEqual(again?.id, offered?.id);
  assert.equal(arbiter.settle(offered?.id ?? "", SPEECH_OUTCOME.SPOKEN), undefined);
  assert.equal(arbiter.offeredId, again?.id);
  assert.ok(traces.some((trace) => trace.decision === SPEECH_DECISION.RECLAIMED));
  // Reclaiming with nothing offered is a no-op, and the clock is untouched.
  arbiter.settle(again?.id ?? "", SPEECH_OUTCOME.SPOKEN);
  arbiter.reclaimOffer();
  assert.equal(arbiter.pendingCount, 1);
  assert.equal(clock.now, 1_000);
});
