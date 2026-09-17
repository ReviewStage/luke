import { withFallback } from "@sidecar/runtime/effect";
import { Clock, Duration, Effect, Fiber, type Redacted } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import {
  type ChildCompletionSweepOutcome,
  NOTHING_DELIVERED,
} from "./brain-host/child-completion.js";
import { NOTHING_OPENED, type TurnOpeningOutcome } from "./brain-host/opener.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "./http.js";
import { OBSERVATION_TICK } from "./observation-bounds.js";
import type { SpeechPushOutcome } from "./speech-push.js";
import type { SpeechSweepOutcome } from "./store/speech.js";

/**
 * The scheduled observation: once a minute, for every account seen within
 * the last week and holding a cloud provider key, the service runs the same
 * read-only pass the on-demand endpoint runs and writes the roster down —
 * the snapshot, and the diff the brain host wakes on — and then, for the
 * same account, hands the brain the diffs still pending as one observation
 * turn per observed conversation. Nothing here decides anything: the pass
 * runs no model and sends nothing, the opener only hands eve the words a
 * turn opens with, and what the brain then decides is the turn's, in eve.
 * The one thing that leaves the service from a tick is a briefing already
 * decided, pushed to a phone by the speech push pass when no device is
 * placed to say it.
 */

interface ObservedAccount {
  userId: string;
}

/** What one account's pass came to, as the tick counts it. */
interface AccountPassOutcome {
  complete: boolean;
}

/** One read of the tick's own: a query against the store, so its requirement is the client the edge provides. */
type TickRead<A> = Effect.Effect<A, unknown, SqlClient.SqlClient>;

/**
 * The reads one tick makes, each answering an Effect over the store's own
 * client rather than a promise: the edge that calls `handleObservationTick`
 * provides `SqlClient.SqlClient`, exactly as it already does for every other
 * hosted route in its group.
 */
interface ObservationTickReads {
  /** Accounts with a cloud key seen since `seenAfter`, least recently attempted first, never attempted first of all. */
  listAccounts: (limit: number, seenAfter: number) => TickRead<ObservedAccount[]>;
  /** Drops the snapshot, bookmark, and pass record of every account without a cloud key or not seen since `seenAfter`. */
  forgetIneligible: (seenAfter: number) => TickRead<void>;
  /**
   * Removes every conversation a Clear stamped past its retention window,
   * answering how many went. Retention rides on the observation tick because
   * it is the one schedule the service runs; the purge is not an observation
   * and reads nothing of any account.
   */
  purgeCleared: (now: number) => TickRead<number>;
  /**
   * Settles every turn still running an hour after it started as failed for
   * abandonment, answering how many. Bounded per tick, and on the tick for
   * the same reason the purge is: a run whose end the relay never heard has
   * no other moment that would settle it.
   */
  sweepAbandonedTurns: (now: number) => TickRead<number>;
  /**
   * The pass over every briefing still on offer, of any account, expiring
   * unspoken the ones past their own instant. It rides on the tick for the
   * same reason the purge does, and like the purge it observes nothing: it
   * reads the offers' events, never a word.
   */
  sweepSpeech: (now: number) => TickRead<SpeechSweepOutcome>;
  /**
   * The pass over the briefings still on offer after the sweep, of any
   * account, pushing to a phone the ones no device is placed to say, as the
   * push module decides from the offers' standing and the devices' reported
   * presence. It runs after the sweep so an offer the sweep just ended is
   * never read as open here.
   */
  pushSpeech: (now: number) => TickRead<SpeechPushOutcome>;
  /** One read-only pass over the account's cloud providers, written down as the pass module does. */
  observe: (userId: string) => TickRead<AccountPassOutcome>;
  /**
   * The account's pending roster diffs handed to the brain as observation
   * turns, one per observed conversation, after the account's own pass and
   * under the same deadline as that pass, so the two together are one
   * account's share of the tick and the batches are gated exactly as before.
   * A pass that fails still has its earlier diffs opened. Runs only for an
   * account this tick listed, which is the one way an account is ever named
   * to eve on the tick's own credential.
   */
  openTurns: (userId: string) => TickRead<TurnOpeningOutcome>;
  /**
   * The sweep over the account's children whose run has ended and whose
   * completion is not stamped, delivering each to its parent on the same
   * claim the relay makes at the turn's end: what the relay could not
   * deliver — a hook that failed after the seal, a deployment that could not
   * reach eve at the time — reaches the parent a tick later. It runs after
   * the account's opening, inside the same share of the tick, and only for
   * an account this tick listed, for the same reason the opening does.
   */
  sweepChildCompletions: (userId: string) => TickRead<ChildCompletionSweepOutcome>;
}

export interface ObservationTickOptions extends ObservationTickReads {
  request: Request;
  /** CRON_SECRET, sealed; undefined means the env var is absent or blank and the schedule is off. */
  cronSecret: Redacted.Redacted | undefined;
  /**
   * PROVIDER_KEY_ENCRYPTION_SECRET, sealed; undefined means the env var is
   * absent or blank, and a tick that cannot read a key must not run at all,
   * since a pass that read nothing would be written down as an account with
   * nothing.
   */
  encryptionSecret: Redacted.Redacted | undefined;
  budgetMs?: number;
  passDeadlineMs?: number;
}

interface ObservationTickAnswer {
  /** Accounts the tick reached. */
  accounts: number;
  /** Accounts whose roster was read whole and written down. */
  observed: number;
  /** Accounts whose pass left the previous snapshot standing. */
  failed: number;
  /** Whether the tick stopped on its budget with accounts still listed. */
  exhausted: boolean;
  /** Cleared conversations the tick purged past their retention window. */
  purged: number;
  /** Turns still running an hour after their start, settled as failed for abandonment. */
  abandoned: number;
  /** What the sweep over the briefings on offer did. */
  speech: SpeechSweepOutcome;
  /** What the push over the briefings still on offer did. */
  push: SpeechPushOutcome;
  /** What the accounts' sweeps over their ended children owed a completion did, summed. */
  children: ChildCompletionSweepOutcome;
  /** The turns the accounts' changed chats were opened as. */
  turns: TurnOpeningOutcome;
}

const FAILED_PASS: AccountPassOutcome = { complete: false };

/** An opening that threw or outran the deadline, counted as one failure: what it did not consume stands for the next tick. */
const FAILED_OPENING: TurnOpeningOutcome = {
  observation: 0,
  failed: 1,
};

/** One account's pass, opening, and completion sweep as the tick counts them: each failed when it threw, and all cut short when the account outran its deadline. */
interface AccountOutcome {
  readonly pass: AccountPassOutcome;
  readonly turns: TurnOpeningOutcome;
  readonly children: ChildCompletionSweepOutcome;
}

const TIMED_OUT_ACCOUNT: AccountOutcome = {
  pass: FAILED_PASS,
  turns: FAILED_OPENING,
  children: NOTHING_DELIVERED,
};

/**
 * An account's turn cut short at its own deadline, on the ambient clock so a
 * test may move it without a real wait — but only the tick's own wait ends:
 * the turn is forked as a daemon and only the join is raced, so a pass still
 * reading a roster whole past the deadline is left running to write it down,
 * exactly as the promise race this replaces never cancelled the pass it
 * raced either.
 */
const accountWithin = /* @__PURE__ */ Effect.fn("accountWithin")(function* (
  account: Effect.Effect<AccountOutcome, never, SqlClient.SqlClient>,
  deadlineMs: number,
): Effect.fn.Return<AccountOutcome, never, SqlClient.SqlClient> {
  const fiber = yield* Effect.forkDetach(account);
  return yield* Effect.race(
    Fiber.join(fiber),
    Effect.as(Effect.sleep(Duration.millis(deadlineMs)), TIMED_OUT_ACCOUNT),
  );
});

/** The pass, then the opening over what it and earlier passes left pending, then the completion sweep; a step that throws is failed and still followed by the next. */
const accountTurn = /* @__PURE__ */ Effect.fn("accountTurn")(function* (
  options: ObservationTickReads,
  userId: string,
): Effect.fn.Return<AccountOutcome, never, SqlClient.SqlClient> {
  const pass = yield* withFallback(options.observe(userId), FAILED_PASS);
  const turns = yield* withFallback(options.openTurns(userId), FAILED_OPENING);
  const children = yield* withFallback(options.sweepChildCompletions(userId), NOTHING_DELIVERED);
  return { pass, turns, children };
});

export const handleObservationTick = /* @__PURE__ */ Effect.fn("handleObservationTick")(function* (
  options: ObservationTickOptions,
): Effect.fn.Return<Response, unknown, SqlClient.SqlClient> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secret = options.cronSecret;
  if (secret === undefined || options.encryptionSecret === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!bearerMatchesSecret(request, secret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const startedAt = yield* Clock.currentTimeMillis;
  const budgetMs = options.budgetMs ?? OBSERVATION_TICK.BUDGET_MS;
  const passDeadlineMs = options.passDeadlineMs ?? OBSERVATION_TICK.PASS_DEADLINE_MS;
  const seenAfter = startedAt - OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS;

  yield* options.forgetIneligible(seenAfter);
  const purged = yield* options.purgeCleared(startedAt);
  const abandoned = yield* options.sweepAbandonedTurns(startedAt);
  const speech = yield* options.sweepSpeech(startedAt);
  const push = yield* options.pushSpeech(startedAt);
  const accounts = yield* options.listAccounts(OBSERVATION_TICK.MAX_ACCOUNTS, seenAfter);

  const answer: ObservationTickAnswer = {
    accounts: 0,
    observed: 0,
    failed: 0,
    exhausted: false,
    purged,
    abandoned,
    speech,
    push,
    children: NOTHING_DELIVERED,
    turns: NOTHING_OPENED,
  };
  for (let index = 0; index < accounts.length; index += OBSERVATION_TICK.CONCURRENCY) {
    if ((yield* Clock.currentTimeMillis) - startedAt + passDeadlineMs > budgetMs) {
      answer.exhausted = true;
      break;
    }
    const batch = accounts.slice(index, index + OBSERVATION_TICK.CONCURRENCY);
    const outcomes = yield* Effect.all(
      batch.map((account) => accountWithin(accountTurn(options, account.userId), passDeadlineMs)),
      { concurrency: "unbounded" },
    );
    for (const { pass, turns, children } of outcomes) {
      answer.accounts += 1;
      if (pass.complete) answer.observed += 1;
      else answer.failed += 1;
      answer.turns = {
        observation: answer.turns.observation + turns.observation,
        failed: answer.turns.failed + turns.failed,
      };
      answer.children = {
        delivered: answer.children.delivered + children.delivered,
        undelivered: answer.children.undelivered + children.undelivered,
        withheld: answer.children.withheld + children.withheld,
      };
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});
