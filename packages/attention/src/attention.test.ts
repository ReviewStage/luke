import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_TRIGGER,
  type AttentionUpdate,
  attentionDecisionFromModel,
  attentionUpdateInput,
  SessionAttentionReviewer,
} from "@sidecar/attention";
import {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  maximumSessionRecapExcerptLength,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type Session,
  type SessionProvider,
} from "@sidecar/session";
import {
  ATTENTION_REVIEW_OUTCOME,
  AttentionSpeechLedger,
  attentionUpdate,
  DISPOSITION_GUIDANCE,
} from "./attention.js";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const DECIDED_AT = 1_800_000_000_000;
const SPOKEN_RECAP = "Claude Code is waiting on you in checkout-service.";
const OTHER_RECAP = "Claude Code finished its turn in checkout-service.";
const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";
/**
 * A session's own address and the change it opened stay on the machine, so the
 * test looks for these markers rather than for a host: matching on a host would
 * pass for any other address on it, and reads as URL sanitization when it is
 * only an absence check.
 */
const WITHHELD_ADDRESS_MARKER = "withheld-session-address";
const WITHHELD_CHANGE_MARKER = "withheld-change-reference";

function session(
  provider: SessionProvider,
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): Session {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title: `${provider.displayName}: checkout-service`,
    status: SESSION_STATUS.WORKING,
    observedAt: DECIDED_AT,
    ...overrides,
  };
  return normalizeSession(provider, observation);
}

function speakDecision(): AttentionDecision {
  return {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: DECIDED_AT,
  };
}

/** A development the ledger can weigh: the observed fields, not a sentence. */
function spokenUpdate(recap = SPOKEN_RECAP): AttentionUpdate {
  return {
    providerId: claude.id,
    providerSessionId: "review",
    trigger: ATTENTION_TRIGGER.RECAP_CHANGED,
    providerName: claude.displayName,
    title: "Review the trust constraints",
    status: SESSION_STATUS.WAITING,
    recap,
    observedAt: DECIDED_AT,
  };
}

function evaluatorReturning(decision: AttentionDecision | undefined): {
  evaluate: (update: AttentionUpdate) => Promise<AttentionDecision | undefined>;
} & {
  readonly updates: AttentionUpdate[];
} {
  const updates: AttentionUpdate[] = [];
  return {
    updates,
    evaluate: async (update) => {
      updates.push(update);
      return decision;
    },
  };
}

test("derives an update only when a session reports something new", () => {
  const working = session(claude, "review");
  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING, observedAt: 1 });

  assert.deepEqual(attentionUpdate(working), {
    providerId: claude.id,
    providerSessionId: "review",
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: claude.displayName,
    title: "Claude Code: checkout-service",
    status: SESSION_STATUS.WORKING,
    observedAt: DECIDED_AT,
  });
  assert.equal(attentionUpdate(working, working), undefined);
  assert.equal(attentionUpdate(waiting, working)?.trigger, ATTENTION_TRIGGER.STATUS_CHANGED);
  assert.equal(attentionUpdate(waiting, working)?.previousStatus, SESSION_STATUS.WORKING);
  assert.equal(
    attentionUpdate(session(claude, "review", { recap: "Claude Code waiting." }), working)?.trigger,
    ATTENTION_TRIGGER.RECAP_CHANGED,
  );

  const held = attentionUpdate(
    session(claude, "held", {
      status: SESSION_STATUS.WAITING,
      holdingForDeveloper: true,
    }),
  );
  assert.ok(held);
  assert.equal(held?.holdingForDeveloper, true);
  assert.doesNotMatch(attentionUpdateInput(held), /holdingForDeveloper/);
});

test("an update carries the recap's excerpt, and a change past it is no development", () => {
  const opening = `Waiting on the rounding rule. ${"y".repeat(700)}`;
  const before = session(claude, "review", { recap: opening });

  const update = attentionUpdate(before);
  assert.equal(update?.recap, opening.slice(0, maximumSessionRecapExcerptLength));

  // A recap that differs only past the excerpt reads identical to the
  // evaluator, so it opens no review the model would have to judge blind.
  const changedPastExcerpt = session(claude, "review", { recap: `${opening} and one more word` });
  assert.equal(attentionUpdate(changedPastExcerpt, before), undefined);

  // A change inside the excerpt is still the development it always was.
  const changedInsideExcerpt = session(claude, "review", { recap: `Settled. ${opening}` });
  assert.equal(
    attentionUpdate(changedInsideExcerpt, before)?.trigger,
    ATTENTION_TRIGGER.RECAP_CHANGED,
  );
});

test("the update names the workspace a chat belongs to, and only by its name", () => {
  const grouped = session(claude, "chat", {
    workspace: { providerWorkspaceId: "workspace-1", name: "lisbon-v2" },
  });
  // The name is the part a readout says; the id identifies nothing out loud
  // and stays on the machine.
  assert.equal(attentionUpdate(grouped)?.workspace, "lisbon-v2");

  const unnamed = session(claude, "chat", {
    workspace: { providerWorkspaceId: "workspace-1" },
  });
  assert.equal(attentionUpdate(unnamed)?.workspace, undefined);
  assert.equal(attentionUpdate(session(claude, "chat"))?.workspace, undefined);
});

test("rejects model output that does not satisfy the decision contract", () => {
  assert.equal(attentionDecisionFromModel(undefined, DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel("silent", DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel([], DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel({ disposition: "speak" }, DECIDED_AT), undefined);
  assert.deepEqual(
    attentionDecisionFromModel({ disposition: ATTENTION_DISPOSITION.SILENT }, DECIDED_AT),
    { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT },
  );
  assert.deepEqual(
    attentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN },
      DECIDED_AT,
    ),
    speakDecision(),
  );
  // A decision carries a judgment and nothing else, so words a model sends
  // anyway are dropped rather than kept: the voice writes what is said.
  assert.deepEqual(
    attentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: SPOKEN_RECAP },
      DECIDED_AT,
    ),
    speakDecision(),
  );
});

test("deduplicates repeated speech per session without composing identity keys", () => {
  let now = DECIDED_AT;
  const repeatWindowMs = 10_000;
  const ledger = new AttentionSpeechLedger({ now: () => now, repeatWindowMs });
  const review = { providerId: claude.id, providerSessionId: "review" };
  const otherProvider = { providerId: codex.id, providerSessionId: "review" };

  assert.equal(
    ledger.shouldSpeak(
      review,
      { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: now },
      spokenUpdate(),
    ),
    false,
  );

  assert.equal(ledger.shouldSpeak(review, speakDecision(), spokenUpdate()), true);
  ledger.remember(review, speakDecision(), spokenUpdate());
  assert.equal(ledger.shouldSpeak(review, speakDecision(), spokenUpdate()), false);
  const firstPermission = {
    ...spokenUpdate(),
    context: { activity: "Approve reading package.json" },
  };
  const secondPermission = {
    ...spokenUpdate(),
    context: { activity: "Approve running pnpm test" },
  };
  ledger.remember(review, speakDecision(), firstPermission);
  assert.equal(ledger.shouldSpeak(review, speakDecision(), firstPermission), false);
  assert.equal(ledger.shouldSpeak(review, speakDecision(), secondPermission), true);
  assert.equal(
    ledger.shouldSpeak(otherProvider, speakDecision(), spokenUpdate()),
    true,
    "the same session id under another provider is a different session",
  );
  // The decision carries no words, so what tells fresh news from a repeat is
  // the observed state the decision was reached on.
  assert.equal(ledger.shouldSpeak(review, speakDecision(), spokenUpdate(OTHER_RECAP)), true);
  assert.equal(
    ledger.shouldSpeak(
      review,
      { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, decidedAt: now },
      spokenUpdate(),
    ),
    true,
  );

  now += repeatWindowMs;
  assert.equal(ledger.shouldSpeak(review, speakDecision(), spokenUpdate()), true);

  now = DECIDED_AT;
  ledger.remember(review, speakDecision(), spokenUpdate());
  assert.equal(ledger.shouldSpeak(review, speakDecision(), spokenUpdate()), false);
  ledger.retain([otherProvider]);
  assert.equal(
    ledger.shouldSpeak(review, speakDecision(), spokenUpdate()),
    true,
    "forgotten sessions speak again",
  );
});

test("reviews only changed sessions and speaks again once the state moves on", async () => {
  const evaluator = evaluatorReturning(speakDecision());
  const reviewer = new SessionAttentionReviewer({
    evaluator,
    now: () => DECIDED_AT,
  });

  const working = session(claude, "review");
  const [firstReview, ...extraReviews] = await reviewer.review([working]);
  assert.equal(extraReviews.length, 0);
  assert.deepEqual(firstReview?.decision, speakDecision());
  assert.equal(firstReview?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);

  assert.deepEqual(
    await reviewer.review([working]),
    [],
    "an unchanged session is not re-evaluated",
  );

  // A decision carries no words to compare, so what a repeat means is the
  // observed state: working becoming waiting is a second development and is
  // spoken again, where the same state twice would not be.
  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  const [movedOn] = await reviewer.review([waiting]);
  assert.equal(movedOn?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.deepEqual(movedOn?.decision, speakDecision());
  assert.equal(evaluator.updates.length, 2);
});

test("a speaking decision deferred by the caller can be reviewed again", async () => {
  let now = DECIDED_AT;
  const evaluator = evaluatorReturning(speakDecision());
  const reviewer = new SessionAttentionReviewer({
    evaluator,
    now: () => now,
  });
  const working = session(claude, "meeting-held");

  const [held] = await reviewer.review([working]);
  assert.ok(held);
  assert.equal(held.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.deepEqual(await reviewer.review([working]), []);

  now += 6 * 60_000;
  reviewer.reconsider([held]);

  const [released] = await reviewer.review([working]);
  assert.equal(released?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.equal(evaluator.updates.length, 2);
});

test("a development reaches the evaluator however old its timestamp", async () => {
  const evaluator = evaluatorReturning(speakDecision());
  const reviewer = new SessionAttentionReviewer({ evaluator, now: () => DECIDED_AT });

  // The timestamp is when the provider last wrote about the session, never
  // when the status was entered, so its age cannot tell late history from a
  // change that just landed. The difference between two readings is the
  // development, and every one is reviewed exactly once.
  const asked = session(claude, "asked", {
    status: SESSION_STATUS.WAITING,
    observedAt: DECIDED_AT - 4 * 60 * 60 * 1000,
  });
  const failed = session(claude, "failed", {
    status: SESSION_STATUS.ERROR,
    observedAt: DECIDED_AT - 6 * 60 * 60 * 1000,
  });
  const finished = session(codex, "finished", {
    status: SESSION_STATUS.COMPLETE,
    observedAt: DECIDED_AT - 7 * 60 * 60 * 1000,
  });

  const reviews = await reviewer.review([asked, failed, finished]);
  assert.deepEqual(
    reviews.map((review) => review.providerSessionId),
    ["asked", "failed", "finished"],
  );
  assert.equal(evaluator.updates.length, 3);
  assert.deepEqual(
    await reviewer.review([asked, failed, finished]),
    [],
    "consumed, not deferred: the same development is not re-derived next pass",
  );
  assert.equal(evaluator.updates.length, 3);

  // The baseline advanced: the next real development is reviewed, and it
  // honestly reports the state the session moved from.
  const revived = session(claude, "asked", {
    status: SESSION_STATUS.WORKING,
    observedAt: DECIDED_AT,
  });
  const [review] = await reviewer.review([revived, failed, finished]);
  assert.equal(review?.providerSessionId, "asked");
  assert.equal(review?.update.previousStatus, SESSION_STATUS.WAITING);
  assert.equal(evaluator.updates.length, 4);
});

test("an edge first seen after hours of sleep is reviewed like any other", async () => {
  let now = DECIDED_AT;
  const evaluator = evaluatorReturning(speakDecision());
  const reviewer = new SessionAttentionReviewer({ evaluator, now: () => now });

  const working = session(claude, "overnight", { observedAt: DECIDED_AT });
  await reviewer.review([working]);
  assert.equal(evaluator.updates.length, 1);

  // The Mac sleeps for six hours; the session finished half an hour in. The
  // edge is only visible on the first pass after waking, and it is the edge
  // that is the development: the timestamp's age decides nothing.
  now = DECIDED_AT + 6 * 60 * 60 * 1000;
  const finished = session(claude, "overnight", {
    status: SESSION_STATUS.COMPLETE,
    observedAt: DECIDED_AT + 30 * 60 * 1000,
  });
  const [review] = await reviewer.review([finished]);
  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.equal(review?.update.previousStatus, SESSION_STATUS.WORKING);
  assert.equal(evaluator.updates.length, 2);
});

test("keeps a second real development visible when Luke stays quiet about it", async () => {
  // Two turns finishing minutes apart leave the session in the same observed
  // state, so the ledger suppresses the second one. It still finished twice.
  // The turn between them is silent, as a session merely resuming work is:
  // only what Luke actually said is remembered as said.
  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async (update) =>
        update.status === SESSION_STATUS.COMPLETE
          ? { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, decidedAt: DECIDED_AT }
          : { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT },
    },
    now: () => DECIDED_AT,
  });

  const complete = session(codex, "build", { status: SESSION_STATUS.COMPLETE });
  const working = session(codex, "build");

  const [first] = await reviewer.review([complete]);
  assert.equal(first?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);

  await reviewer.review([working]);

  const [second] = await reviewer.review([complete]);
  assert.equal(second?.outcome, ATTENTION_REVIEW_OUTCOME.DEDUPLICATED);
  assert.notEqual(
    second?.decision.disposition,
    ATTENTION_DISPOSITION.SILENT,
    "a second completed turn must not be hidden because its state matches a recent one",
  );
});

test("stays silent when an evaluator fails or answers outside the contract", async () => {
  const failing = {
    evaluate: async () => {
      throw new Error("network unavailable");
    },
  };
  const reviewer = new SessionAttentionReviewer({ evaluator: failing, now: () => DECIDED_AT });
  const [review] = await reviewer.review([session(claude, "review")]);
  assert.deepEqual(review?.decision, {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: DECIDED_AT,
  });
  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.UNAVAILABLE);

  const empty = new SessionAttentionReviewer({
    evaluator: evaluatorReturning(undefined),
    now: () => DECIDED_AT,
  });
  const [emptyReview] = await empty.review([session(codex, "build")]);
  assert.equal(emptyReview?.decision.disposition, ATTENTION_DISPOSITION.SILENT);
  assert.equal(emptyReview?.outcome, ATTENTION_REVIEW_OUTCOME.UNAVAILABLE);
});

test("a quiet evaluator skips the pass whole, spending nothing", async () => {
  let now = DECIDED_AT;
  const quietUntil = DECIDED_AT + 60_000;
  const updates: AttentionUpdate[] = [];
  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      quietUntil: () => quietUntil,
      evaluate: async (update) => {
        updates.push(update);
        return speakDecision();
      },
    },
    now: () => now,
    // With no retries budgeted, one pass counted as unavailable would drop
    // the development — which is exactly what a skipped pass must not do.
    maximumUnavailableRetries: 0,
  });

  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  await reviewer.review([waiting]);
  await reviewer.review([waiting]);
  assert.equal(updates.length, 0, "nothing is sent while the evaluator is quiet");

  // The quiet over, the development that waited through it is reviewed.
  now = quietUntil;
  const [review] = await reviewer.review([waiting]);
  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.equal(updates.length, 1);
});

test("drops a decision about a failure the session has already replaced", async () => {
  const rateLimited = session(claude, "review", {
    status: SESSION_STATUS.ERROR,
    detail: { error: "429 rate limit exceeded" },
  });
  // Same status and no recap either side, so the failure itself is the only
  // thing that moved. A trigger that can open a review has to be able to
  // supersede one, or Luke speaks about a failure that is no longer true.
  const disconnected = session(claude, "review", {
    status: SESSION_STATUS.ERROR,
    detail: { error: "Unable to connect to API (ConnectionRefused)" },
  });
  let current: Session = rateLimited;

  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async () => {
        current = disconnected;
        return speakDecision();
      },
    },
    currentSession: () => current,
    now: () => DECIDED_AT,
  });

  const [review] = await reviewer.review([rateLimited]);
  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);
  assert.deepEqual(review?.decision, {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: DECIDED_AT,
  });
});

test("drops a decision the session already moved past", async () => {
  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  const working = session(claude, "review");
  let current: Session = waiting;
  let answeredWhileEvaluating = true;

  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async () => {
        // The developer answers the session while the model is still thinking.
        if (answeredWhileEvaluating) current = working;
        return speakDecision();
      },
    },
    currentSession: () => current,
    now: () => DECIDED_AT,
  });

  const [staleReview] = await reviewer.review([waiting]);
  assert.equal(staleReview?.outcome, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);
  assert.deepEqual(staleReview?.decision, {
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: DECIDED_AT,
  });

  answeredWhileEvaluating = false;
  current = working;
  const [spokenReview] = await reviewer.review([working]);
  assert.equal(
    spokenReview?.outcome,
    ATTENTION_REVIEW_OUTCOME.DECIDED,
    "a superseded decision is never spoken, so the same sentence is not deduplicated later",
  );
  assert.deepEqual(spokenReview?.decision, speakDecision());
});

test("reviews the development again after the session returns to a superseded state", async () => {
  const working = session(claude, "review");
  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  let current: Session = working;
  let answeredWhileEvaluating = false;

  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async (update) => {
        if (update.status !== SESSION_STATUS.WAITING) {
          return { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT };
        }
        if (answeredWhileEvaluating) current = working;
        return speakDecision();
      },
    },
    currentSession: () => current,
    now: () => DECIDED_AT,
  });

  await reviewer.review([working]);

  answeredWhileEvaluating = true;
  const [supersededReview] = await reviewer.review([waiting]);
  assert.equal(supersededReview?.outcome, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);

  // The session asks again before any pass observed the answered state.
  answeredWhileEvaluating = false;
  current = waiting;
  const [retriedReview] = await reviewer.review([waiting]);
  assert.equal(
    retriedReview?.outcome,
    ATTENTION_REVIEW_OUTCOME.DECIDED,
    "a superseded development is derived again instead of being consumed with the baseline",
  );
  assert.deepEqual(retriedReview?.decision, speakDecision());
});

test("re-checks every decision after the slowest evaluation in the pass lands", async () => {
  const waitingSession = session(claude, "answered", {
    status: SESSION_STATUS.WAITING,
    observedAt: DECIDED_AT,
  });
  const workingSession = session(claude, "answered", { observedAt: DECIDED_AT });
  const slowSession = session(claude, "slow", { observedAt: DECIDED_AT - 1_000 });
  const current = new Map<string, Session>([
    ["answered", waitingSession],
    ["slow", slowSession],
  ]);
  let releaseSlow: (() => void) | undefined;

  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async (update) => {
        if (update.providerSessionId === "slow") {
          await new Promise<void>((resolve) => {
            releaseSlow = resolve;
          });
        }
        return speakDecision();
      },
    },
    currentSession: (identity) => current.get(identity.providerSessionId),
    now: () => DECIDED_AT,
  });

  const pass = reviewer.review([waitingSession, slowSession]);
  // Let the answered session's evaluation finish completely, so the pass is
  // held open only by the slow sibling.
  await new Promise((resolve) => setImmediate(resolve));

  // A provider refresh lands while the slow sibling still holds the pass open.
  current.set("answered", workingSession);
  releaseSlow?.();
  const reviews = await pass;

  assert.equal(
    reviews.find((review) => review.providerSessionId === "answered")?.outcome,
    ATTENTION_REVIEW_OUTCOME.SUPERSEDED,
  );
  assert.equal(
    reviews.find((review) => review.providerSessionId === "slow")?.outcome,
    ATTENTION_REVIEW_OUTCOME.DECIDED,
  );
});

test("drops a decision for a session that disappeared while it was evaluated", async () => {
  const reviewer = new SessionAttentionReviewer({
    evaluator: evaluatorReturning(speakDecision()),
    currentSession: () => undefined,
    now: () => DECIDED_AT,
  });

  const [review] = await reviewer.review([session(claude, "review")]);
  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);
  assert.equal(review?.decision.disposition, ATTENTION_DISPOSITION.SILENT);
});

test("retries a failed evaluation a bounded number of times", async () => {
  let attempts = 0;
  const failuresBeforeSuccess = 2;
  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async () => {
        attempts += 1;
        if (attempts <= failuresBeforeSuccess) throw new Error("network blip");
        return speakDecision();
      },
    },
    now: () => DECIDED_AT,
  });

  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  for (let pass = 0; pass < failuresBeforeSuccess; pass += 1) {
    const [review] = await reviewer.review([waiting]);
    assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.UNAVAILABLE);
  }

  const [recovered] = await reviewer.review([waiting]);
  assert.equal(
    recovered?.outcome,
    ATTENTION_REVIEW_OUTCOME.DECIDED,
    "a passing failure must not permanently drop the development",
  );
  assert.deepEqual(recovered?.decision, speakDecision());
});

test("stops retrying an evaluator that keeps failing", async () => {
  let attempts = 0;
  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async () => {
        attempts += 1;
        return undefined;
      },
    },
    maximumUnavailableRetries: 1,
    now: () => DECIDED_AT,
  });

  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  await reviewer.review([waiting]);
  await reviewer.review([waiting]);
  assert.equal(attempts, 2);

  assert.deepEqual(
    await reviewer.review([waiting]),
    [],
    "a standing misconfiguration must not re-evaluate on every poll",
  );
  assert.equal(attempts, 2);
});

test("a superseded answer ends the failure streak", async () => {
  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  const working = session(claude, "review");
  let current: Session = waiting;
  let pass = 0;

  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async () => {
        pass += 1;
        // Fail, then answer into a session that moved on, then fail again.
        if (pass === 1 || pass === 3) throw new Error("network blip");
        if (pass === 2) current = working;
        return speakDecision();
      },
    },
    currentSession: () => current,
    maximumUnavailableRetries: 1,
    now: () => DECIDED_AT,
  });

  assert.equal(
    (await reviewer.review([waiting]))[0]?.outcome,
    ATTENTION_REVIEW_OUTCOME.UNAVAILABLE,
  );
  assert.equal((await reviewer.review([waiting]))[0]?.outcome, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);

  current = waiting;
  assert.equal(
    (await reviewer.review([waiting]))[0]?.outcome,
    ATTENTION_REVIEW_OUTCOME.UNAVAILABLE,
  );
  const [recovered] = await reviewer.review([waiting]);
  assert.equal(
    recovered?.outcome,
    ATTENTION_REVIEW_OUTCOME.DECIDED,
    "an answered call resets the budget, so sparse blips cannot accumulate into a dropped development",
  );
});

test("reviews a session that round-trips back to the state it was reopened from", async () => {
  // complete, then working, then complete again, with the middle transition
  // failing. Restoring the pre-pass baseline would make the second completion
  // compare equal to it and vanish.
  const complete = session(codex, "build", { status: SESSION_STATUS.COMPLETE });
  const working = session(codex, "build");
  const finished: AttentionDecision = {
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    decidedAt: DECIDED_AT,
  };

  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async (update) => {
        if (update.status !== SESSION_STATUS.COMPLETE) throw new Error("network blip");
        return finished;
      },
    },
    now: () => DECIDED_AT,
  });

  assert.equal((await reviewer.review([complete]))[0]?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.equal(
    (await reviewer.review([working]))[0]?.outcome,
    ATTENTION_REVIEW_OUTCOME.UNAVAILABLE,
  );

  const [second] = await reviewer.review([complete]);
  assert.ok(second, "a second completed turn must still be reviewed");
  assert.notEqual(
    second.decision.disposition,
    ATTENTION_DISPOSITION.SILENT,
    "the session finished again and must still read as needing attention",
  );
});

test("bounds one review pass and re-derives the updates it deferred", async () => {
  const evaluator = evaluatorReturning({
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: DECIDED_AT,
  });
  const reviewer = new SessionAttentionReviewer({
    evaluator,
    now: () => DECIDED_AT,
    maximumUpdatesPerReview: 1,
  });

  const newest = session(claude, "newest", { observedAt: DECIDED_AT });
  const oldest = session(claude, "oldest", { observedAt: DECIDED_AT - 5_000 });
  const firstPass = await reviewer.review([oldest, newest]);
  assert.deepEqual(
    firstPass.map((review) => review.providerSessionId),
    ["newest"],
    "the newest development is reviewed first",
  );

  const secondPass = await reviewer.review([oldest, newest]);
  assert.deepEqual(
    secondPass.map((review) => review.providerSessionId),
    ["oldest"],
  );
  assert.deepEqual(await reviewer.review([oldest, newest]), []);
});

test("keeps one evaluation in flight per session", async () => {
  let release: (() => void) | undefined;
  const started: AttentionUpdate[] = [];
  const reviewer = new SessionAttentionReviewer({
    evaluator: {
      evaluate: async (update) => {
        started.push(update);
        if (started.length === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT };
      },
    },
    now: () => DECIDED_AT,
  });

  const working = session(claude, "review");
  const inFlight = reviewer.review([working]);
  await Promise.resolve();

  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  assert.deepEqual(await reviewer.review([waiting]), []);
  assert.equal(started.length, 1);

  release?.();
  await inFlight;

  const [laterReview] = await reviewer.review([waiting]);
  assert.equal(
    laterReview?.update.trigger,
    ATTENTION_TRIGGER.STATUS_CHANGED,
    "a development observed while busy is reviewed once the session is free",
  );
});

test("sends bounded material and withholds what a decision does not turn on", async () => {
  const evaluator = evaluatorReturning({
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: DECIDED_AT,
  });
  const reviewer = new SessionAttentionReviewer({ evaluator, now: () => DECIDED_AT });
  await reviewer.review([
    session(claude, "review", {
      title: `Split the checkout total ${TRANSCRIPT_SECRET}`.padEnd(400, "x"),
      recap: `Waiting on the rounding rule. ${TRANSCRIPT_SECRET}`.padEnd(900, "y"),
      detail: {
        repository: "checkout-service",
        branch: "dean/line-items",
        activity: "Edit: src/totals.ts",
        error: "429 rate limit exceeded",
        model: "claude-opus-5",
        link: `https://cursor.example/agents/${WITHHELD_ADDRESS_MARKER}`,
        change: `https://forge.example/reviewstage/luke/pull/${WITHHELD_CHANGE_MARKER}`,
      },
    }),
  ]);

  const [update] = evaluator.updates;
  assert.ok(update);
  assert.deepEqual(Object.keys(update).sort(), [
    "context",
    "observedAt",
    "providerId",
    "providerName",
    "providerSessionId",
    "recap",
    "status",
    "title",
    "trigger",
  ]);
  assert.equal(update.title.length, 160, "titles stay bounded by session normalization");
  assert.equal(update.recap?.length, 500, "recaps leave only as the update's bounded excerpt");

  // An evaluator is the one place session material leaves the machine, so the
  // session's own address and the change it published stay behind: they are
  // identifiers a decision never turns on.
  assert.deepEqual(Object.keys(update.context ?? {}).sort(), [
    "activity",
    "branch",
    "error",
    "repository",
  ]);

  const input = attentionUpdateInput(update);
  assert.ok(input.includes("Provider: Claude Code"));
  assert.ok(input.includes(`Status: ${SESSION_STATUS.WORKING}`));
  assert.ok(input.includes("Running: Edit: src/totals.ts"));
  assert.ok(input.includes("Error: 429 rate limit exceeded"));
  assert.ok(!input.includes(WITHHELD_ADDRESS_MARKER));
  assert.ok(!input.includes(WITHHELD_CHANGE_MARKER));
  assert.ok(!input.includes("providerSessionId"));
});

test("the decision schema carries the disposition contract", () => {
  const schemaDescription = ATTENTION_DECISION_SCHEMA.properties.disposition.description;
  for (const disposition of Object.values(ATTENTION_DISPOSITION)) {
    const guidance = `${disposition}: ${DISPOSITION_GUIDANCE[disposition]}`;
    assert.ok(schemaDescription.includes(guidance));
  }
  assert.deepEqual(ATTENTION_DECISION_SCHEMA.properties.disposition.enum, [
    ATTENTION_DISPOSITION.SILENT,
    ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
  ]);
  assert.deepEqual(ATTENTION_DECISION_SCHEMA.required, ["disposition"]);
  assert.equal(ATTENTION_DECISION_SCHEMA.additionalProperties, false);
});
test("a closed session never reaches the evaluator", async () => {
  const evaluator = evaluatorReturning(speakDecision());
  const reviewer = new SessionAttentionReviewer({
    evaluator,
    now: () => DECIDED_AT,
  });

  await reviewer.review([session(claude, "watched", { status: SESSION_STATUS.WAITING })]);
  evaluator.updates.length = 0;

  const reviews = await reviewer.review([
    session(claude, "watched", {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
    }),
  ]);

  assert.deepEqual(reviews, []);
  assert.deepEqual(evaluator.updates, []);
});

test("a work-finished completion still reaches the evaluator", async () => {
  const evaluator = evaluatorReturning(speakDecision());
  const reviewer = new SessionAttentionReviewer({ evaluator, now: () => DECIDED_AT });

  await reviewer.review([session(claude, "finished")]);
  evaluator.updates.length = 0;
  await reviewer.review([
    session(claude, "finished", {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.WORK_FINISHED,
    }),
  ]);

  assert.equal(evaluator.updates.length, 1);
  assert.equal(evaluator.updates[0]?.status, SESSION_STATUS.COMPLETE);
});

test("closure supersedes an in-flight work-finished review", async () => {
  const closed = session(claude, "finished", {
    status: SESSION_STATUS.COMPLETE,
    completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
  });
  const reviewer = new SessionAttentionReviewer({
    evaluator: evaluatorReturning(speakDecision()),
    currentSession: () => closed,
    now: () => DECIDED_AT,
  });

  const [review] = await reviewer.review([
    session(claude, "finished", {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.WORK_FINISHED,
    }),
  ]);

  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.SUPERSEDED);
  assert.equal(review?.decision.disposition, ATTENTION_DISPOSITION.SILENT);
});
