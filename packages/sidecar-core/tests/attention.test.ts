import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DISPOSITION,
  ATTENTION_REVIEW_OUTCOME,
  ATTENTION_TRIGGER,
  ATTENTION_TUNING_EXAMPLES,
  type AttentionDecision,
  AttentionSpeechLedger,
  type AttentionUpdate,
  attentionDecisionFromModel,
  attentionInstructions,
  attentionUpdate,
  attentionUpdateInput,
  maximumAttentionSummaryLength,
  type NormalizedSession,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_STATUS,
  SessionAttentionReviewer,
  type SessionProvider,
} from "../src";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const DECIDED_AT = 1_800_000_000_000;
const SPOKEN_SUMMARY = "Claude Code is waiting on you in checkout-service.";
const OTHER_SUMMARY = "Claude Code finished its turn in checkout-service.";
const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";

function session(
  provider: SessionProvider,
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): NormalizedSession {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title: `${provider.displayName}: checkout-service`,
    status: SESSION_STATUS.WORKING,
    observedAt: DECIDED_AT,
    ...overrides,
  };
  return normalizeSession(provider, observation);
}

function speakDecision(summary = SPOKEN_SUMMARY): AttentionDecision {
  return {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: DECIDED_AT,
    summary,
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
    attentionUpdate(session(claude, "review", { summary: "Claude Code waiting." }), working)
      ?.trigger,
    ATTENTION_TRIGGER.SUMMARY_CHANGED,
  );
});

test("rejects model output that does not satisfy the decision contract", () => {
  assert.equal(attentionDecisionFromModel(undefined, DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel("silent", DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel([], DECIDED_AT), undefined);
  assert.equal(attentionDecisionFromModel({ disposition: "speak" }, DECIDED_AT), undefined);
  assert.equal(
    attentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, summary: null },
      DECIDED_AT,
    ),
    undefined,
    "a speaking decision must carry the sentence Luke would say",
  );

  assert.deepEqual(
    attentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SILENT, summary: null },
      DECIDED_AT,
    ),
    { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: DECIDED_AT },
  );
  assert.deepEqual(
    attentionDecisionFromModel(
      { disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN, summary: `  ${SPOKEN_SUMMARY}  ` },
      DECIDED_AT,
    ),
    speakDecision(),
  );
  assert.equal(
    attentionDecisionFromModel(
      {
        disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
        summary: "a".repeat(maximumAttentionSummaryLength + 40),
      },
      DECIDED_AT,
    )?.summary?.length,
    maximumAttentionSummaryLength,
  );
});

test("deduplicates repeated speech per session without composing identity keys", () => {
  let now = DECIDED_AT;
  const repeatWindowMs = 10_000;
  const ledger = new AttentionSpeechLedger({ now: () => now, repeatWindowMs });
  const review = { providerId: claude.id, providerSessionId: "review" };
  const otherProvider = { providerId: codex.id, providerSessionId: "review" };

  assert.equal(
    ledger.shouldSpeak(review, { disposition: ATTENTION_DISPOSITION.SILENT, decidedAt: now }),
    false,
  );

  assert.equal(ledger.shouldSpeak(review, speakDecision()), true);
  ledger.remember(review, speakDecision());
  assert.equal(ledger.shouldSpeak(review, speakDecision()), false);
  assert.equal(
    ledger.shouldSpeak(otherProvider, speakDecision()),
    true,
    "the same session id under another provider is a different session",
  );
  assert.equal(ledger.shouldSpeak(review, speakDecision(OTHER_SUMMARY)), true);
  assert.equal(
    ledger.shouldSpeak(review, {
      disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
      decidedAt: now,
      summary: SPOKEN_SUMMARY,
    }),
    true,
  );

  now += repeatWindowMs;
  assert.equal(ledger.shouldSpeak(review, speakDecision()), true);

  now = DECIDED_AT;
  ledger.remember(review, speakDecision());
  assert.equal(ledger.shouldSpeak(review, speakDecision()), false);
  ledger.retain([otherProvider]);
  assert.equal(ledger.shouldSpeak(review, speakDecision()), true, "forgotten sessions speak again");
});

test("reviews only changed sessions and suppresses a repeated decision", async () => {
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

  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  const [repeatReview] = await reviewer.review([waiting]);
  assert.equal(repeatReview?.outcome, ATTENTION_REVIEW_OUTCOME.DEDUPLICATED);
  assert.deepEqual(
    repeatReview?.decision,
    speakDecision(),
    "a repeat stays worth attention even though Luke will not say it again",
  );
  assert.equal(evaluator.updates.length, 2);
});

test("keeps a second real development visible when Luke stays quiet about it", async () => {
  // Two turns finishing minutes apart produce the same sentence, so the ledger
  // suppresses the second one. The session still finished twice.
  const evaluator = evaluatorReturning({
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    decidedAt: DECIDED_AT,
    summary: "Codex finished its turn in billing-api.",
  });
  const reviewer = new SessionAttentionReviewer({ evaluator, now: () => DECIDED_AT });

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
    "a second completed turn must not be hidden because its sentence matches a recent one",
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

test("drops a decision the session already moved past", async () => {
  const waiting = session(claude, "review", { status: SESSION_STATUS.WAITING });
  const working = session(claude, "review");
  let current: NormalizedSession = waiting;
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
  let current: NormalizedSession = working;
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
  const current = new Map<string, NormalizedSession>([
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
  let current: NormalizedSession = waiting;
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

test("sends bounded, redacted material and never provider transcripts", async () => {
  const evaluator = evaluatorReturning({
    disposition: ATTENTION_DISPOSITION.SILENT,
    decidedAt: DECIDED_AT,
  });
  const reviewer = new SessionAttentionReviewer({ evaluator, now: () => DECIDED_AT });
  await reviewer.review([
    session(claude, "review", {
      title: `Claude Code: checkout-service ${TRANSCRIPT_SECRET}`.padEnd(400, "x"),
      summary: `Claude Code working. ${TRANSCRIPT_SECRET}`.padEnd(900, "y"),
    }),
  ]);

  const [update] = evaluator.updates;
  assert.ok(update);
  assert.deepEqual(Object.keys(update).sort(), [
    "observedAt",
    "providerId",
    "providerName",
    "providerSessionId",
    "status",
    "summary",
    "title",
    "trigger",
  ]);
  assert.equal(update.title.length, 160, "titles stay bounded by session normalization");
  assert.equal(update.summary?.length, 500, "summaries stay bounded by session normalization");

  const input = attentionUpdateInput(update);
  assert.ok(input.includes("Provider: Claude Code"));
  assert.ok(input.includes(`Status: ${SESSION_STATUS.WORKING}`));
  assert.ok(!input.includes("providerSessionId"));
});

test("tuning examples are redacted, bounded, and cover every disposition", () => {
  assert.deepEqual(
    [...new Set(ATTENTION_TUNING_EXAMPLES.map((example) => example.expected.disposition))].sort(),
    [...Object.values(ATTENTION_DISPOSITION)].sort(),
  );

  for (const example of ATTENTION_TUNING_EXAMPLES) {
    const decision = attentionDecisionFromModel(example.expected, DECIDED_AT);
    assert.ok(decision, `${example.name} must satisfy the decision contract`);
    assert.equal(decision.disposition, example.expected.disposition);
    assert.ok((example.expected.summary ?? "").length <= maximumAttentionSummaryLength);
    assert.ok(!example.update.title.includes("/"), "examples use workspace names, not paths");
  }
});

test("instructions carry the decision contract and the tuning examples", () => {
  const instructions = attentionInstructions();
  for (const disposition of Object.values(ATTENTION_DISPOSITION)) {
    assert.ok(instructions.includes(disposition));
  }
  for (const example of ATTENTION_TUNING_EXAMPLES) {
    assert.ok(instructions.includes(example.name));
    assert.ok(instructions.includes(attentionUpdateInput(example.update)));
  }
  assert.ok(instructions.includes(String(maximumAttentionSummaryLength)));
  assert.deepEqual(ATTENTION_DECISION_SCHEMA.properties.disposition.enum, [
    ATTENTION_DISPOSITION.SILENT,
    ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
  ]);
  assert.deepEqual(ATTENTION_DECISION_SCHEMA.required, ["disposition", "summary"]);
  assert.equal(ATTENTION_DECISION_SCHEMA.additionalProperties, false);
});
