import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DISPOSITION,
  ATTENTION_SPEECH_SOURCE,
  type AttentionDecision,
  type AttentionSpeech,
  HeldAttentionQueue,
  maximumHeldAttention,
  type NormalizedSession,
  normalizeSession,
  SESSION_STATUS,
  type SessionProvider,
  silentAttention,
} from "../src";

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const DECIDED_AT = 1_800_000_000_000;
const WAITING_SUMMARY = "Claude Code is waiting on you in checkout-service.";
const FINISHED_SUMMARY = "Claude Code finished its turn in checkout-service.";

function decision(summary: string, decidedAt = DECIDED_AT): AttentionDecision {
  return { disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END, decidedAt, summary };
}

function notice(
  provider: SessionProvider,
  providerSessionId: string,
  summary: string,
  decidedAt = DECIDED_AT,
): AttentionSpeech {
  return {
    providerId: provider.id,
    providerSessionId,
    disposition: ATTENTION_DISPOSITION.SPEAK_AT_TURN_END,
    source: ATTENTION_SPEECH_SOURCE.EVALUATOR,
    summary,
    decidedAt,
  };
}

/** A session as the registry holds it, with whatever attention it last reached. */
function session(
  provider: SessionProvider,
  providerSessionId: string,
  attention: AttentionDecision = silentAttention(DECIDED_AT),
): NormalizedSession {
  return normalizeSession(
    provider,
    {
      providerSessionId,
      title: `${provider.displayName}: checkout-service`,
      status: SESSION_STATUS.WAITING,
      observedAt: DECIDED_AT,
    },
    attention,
  );
}

test("a notice held through a Focus is said once the Focus ends", () => {
  const held = new HeldAttentionQueue();
  held.hold([notice(claude, "review", WAITING_SUMMARY)]);

  assert.equal(held.size, 1);
  const released = held.release([session(claude, "review", decision(WAITING_SUMMARY))]);

  assert.deepEqual(
    released.map((item) => item.summary),
    [WAITING_SUMMARY],
  );
  // Released once. A Focus ending twice is not a session finishing twice.
  assert.equal(held.size, 0);
  assert.deepEqual(held.release([session(claude, "review", decision(WAITING_SUMMARY))]), []);
});

test("a session that moved three times during a Focus has one thing to say", () => {
  const held = new HeldAttentionQueue();
  held.hold([notice(claude, "review", WAITING_SUMMARY, DECIDED_AT)]);
  held.hold([notice(claude, "review", FINISHED_SUMMARY, DECIDED_AT + 2_000)]);

  assert.equal(held.size, 1);
  const released = held.release([session(claude, "review", decision(FINISHED_SUMMARY))]);

  // Where it ended up, not the running commentary that got it there.
  assert.deepEqual(
    released.map((item) => item.summary),
    [FINISHED_SUMMARY],
  );
});

test("a notice the session has moved past is dropped rather than announced", () => {
  const held = new HeldAttentionQueue();
  held.hold([notice(claude, "review", WAITING_SUMMARY)]);

  // The reviewer overwrote the decision while the Focus was on: the failure
  // was recovered from, and saying so now would be news that is already wrong.
  assert.deepEqual(held.release([session(claude, "review", decision(FINISHED_SUMMARY))]), []);
});

test("a notice whose session went silent is dropped", () => {
  const held = new HeldAttentionQueue();
  held.hold([notice(claude, "review", WAITING_SUMMARY)]);

  assert.deepEqual(held.release([session(claude, "review")]), []);
});

test("a notice whose session is no longer reported is dropped", () => {
  const held = new HeldAttentionQueue();
  held.hold([notice(claude, "review", WAITING_SUMMARY)]);

  assert.deepEqual(held.release([session(codex, "review", decision(WAITING_SUMMARY))]), []);
});

test("two providers using the same session id are held apart", () => {
  const held = new HeldAttentionQueue();
  held.hold([
    notice(claude, "review", WAITING_SUMMARY, DECIDED_AT),
    notice(codex, "review", FINISHED_SUMMARY, DECIDED_AT + 1_000),
  ]);

  const released = held.release([
    session(codex, "review", decision(FINISHED_SUMMARY, DECIDED_AT + 1_000)),
    session(claude, "review", decision(WAITING_SUMMARY)),
  ]);

  // Oldest first, whatever order the roster happens to arrive in: what waited
  // longest is what happened first.
  assert.deepEqual(
    released.map((item) => item.summary),
    [WAITING_SUMMARY, FINISHED_SUMMARY],
  );
});

test("a long Focus keeps the most recent handful rather than everything", () => {
  const held = new HeldAttentionQueue();
  const sessions: NormalizedSession[] = [];
  for (let index = 0; index < maximumHeldAttention + 3; index += 1) {
    const summary = `Claude Code finished turn ${index}.`;
    held.hold([notice(claude, `session-${index}`, summary, DECIDED_AT + index)]);
    sessions.push(session(claude, `session-${index}`, decision(summary, DECIDED_AT + index)));
  }

  assert.equal(held.size, maximumHeldAttention);
  const released = held.release(sessions);

  // Reading an afternoon's worth back would be worse than having said nothing;
  // every session in it still reads as needing attention in the panel.
  assert.equal(released.length, maximumHeldAttention);
  assert.equal(released[0]?.summary, "Claude Code finished turn 3.");
  assert.equal(released.at(-1)?.summary, `Claude Code finished turn ${maximumHeldAttention + 2}.`);
});

test("clearing announces nothing, which is what quitting mid-Focus does", () => {
  const held = new HeldAttentionQueue();
  held.hold([notice(claude, "review", WAITING_SUMMARY)]);
  held.clear();

  assert.equal(held.size, 0);
  assert.deepEqual(held.release([session(claude, "review", decision(WAITING_SUMMARY))]), []);
});
