import type { SqlClient } from "@effect/sql";
import { Duration, Effect, Fiber } from "effect";
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
export interface AccountPassOutcome {
  complete: boolean;
  changed: boolean;
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
  /** Drops the snapshot, diffs, and pass record of every account without a cloud key or not seen since `seenAfter`. */
  forgetIneligible: (seenAfter: number) => TickRead<void>;
  /**
   * Removes every conversation a Clear stamped past its retention window,
   * answering how many went. Retention rides on the observation tick because
   * it is the one schedule the service runs; the purge is not an observation
   * and reads nothing of any account.
   */
  purgeCleared: (now: number) => TickRead<number>;
  /**
   * The pass over every briefing still on offer, of any account: held while
   * a device of its account reports quiet ahead, released unspoken with a
   * turn queued for the brain to decide again once the quiet lifts, and
   * expired unspoken past its own instant. It rides on the tick for the same
   * reason the purge does, and like the purge it observes nothing: it reads
   * the offers' events and the devices' quiet instants, never a word.
   */
  sweepSpeech: (now: number) => TickRead<SpeechSweepOutcome>;
  /**
   * The pass over the briefings still on offer after the sweep, of any
   * account, pushing to a phone the ones no device is placed to say, as the
   * push module decides from the offers' standing and the devices' reported
   * presence. It runs after the sweep so an offer the sweep just held or
   * ended is never read as open here.
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
}

export interface ObservationTickOptions extends ObservationTickReads {
  request: Request;
  /** The value of CRON_SECRET; undefined means the env var is absent and the schedule is off. */
  cronSecret: string | undefined;
  /**
   * The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var
   * is absent, and a tick that cannot read a key must not run at all, since a
   * pass that read nothing would be written down as an account with nothing.
   */
  encryptionSecret: string | undefined;
  now?: () => number;
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
  /** Accounts whose roster changed against the snapshot it replaced. */
  changed: number;
  /** Whether the tick stopped on its budget with accounts still listed. */
  exhausted: boolean;
  /** Cleared conversations the tick purged past their retention window. */
  purged: number;
  /** What the sweep over the briefings on offer did. */
  speech: SpeechSweepOutcome;
  /** What the push over the briefings still on offer did. */
  push: SpeechPushOutcome;
  /** The turns the accounts' changes and queued hold releases were opened as, and the bookmarks reseeded across a stale gap instead of woken from. */
  turns: TurnOpeningOutcome;
}

const FAILED_PASS: AccountPassOutcome = { complete: false, changed: false };

/** An opening that threw or outran the deadline, counted as one failure: what it did not consume stands for the next tick. */
const FAILED_OPENING: TurnOpeningOutcome = {
  observation: 0,
  holdRelease: 0,
  failed: 1,
  reseeded: 0,
};

/** One account's pass and its opening as the tick counts them: each failed when it threw, and both cut short when the account outran its deadline. */
interface AccountOutcome {
  readonly pass: AccountPassOutcome;
  readonly turns: TurnOpeningOutcome;
}

const TIMED_OUT_ACCOUNT: AccountOutcome = { pass: FAILED_PASS, turns: FAILED_OPENING };

/**
 * A read that failed or defected stands as the fallback; a caller ending the
 * fiber is neither, so only `catchAll` (the read's own typed failure) and
 * `catchAllDefect` (an unexpected throw) are handled here — an interruption
 * passes through untouched.
 */
function withFallback<A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  fallback: A,
): Effect.Effect<A, never, SqlClient.SqlClient> {
  return Effect.catchAllDefect(
    Effect.catchAll(effect, () => Effect.succeed(fallback)),
    () => Effect.succeed(fallback),
  );
}

/**
 * An account's turn cut short at its own deadline, on the ambient clock so a
 * test may move it without a real wait — but only the tick's own wait ends:
 * the turn is forked as a daemon and only the join is raced, so a pass still
 * reading a roster whole past the deadline is left running to write it down,
 * exactly as the promise race this replaces never cancelled the pass it
 * raced either.
 */
function accountWithin(
  account: Effect.Effect<AccountOutcome, never, SqlClient.SqlClient>,
  deadlineMs: number,
): Effect.Effect<AccountOutcome, never, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkDaemon(account);
    return yield* Effect.race(
      Fiber.join(fiber),
      Effect.as(Effect.sleep(Duration.millis(deadlineMs)), TIMED_OUT_ACCOUNT),
    );
  });
}

/** The pass, then the opening over what it and earlier passes left pending; a pass that throws is failed and still followed by the opening. */
function accountTurn(
  options: ObservationTickReads,
  userId: string,
): Effect.Effect<AccountOutcome, never, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const pass = yield* withFallback(options.observe(userId), FAILED_PASS);
    const turns = yield* withFallback(options.openTurns(userId), FAILED_OPENING);
    return { pass, turns };
  });
}

export function handleObservationTick(
  options: ObservationTickOptions,
): Effect.Effect<Response, unknown, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const { request } = options;
    if (request.method !== "GET") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }

    const secret = options.cronSecret?.trim();
    if (!secret || !options.encryptionSecret?.trim()) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }
    if (!bearerMatchesSecret(request, secret)) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }

    const now = options.now ?? Date.now;
    const startedAt = now();
    const budgetMs = options.budgetMs ?? OBSERVATION_TICK.BUDGET_MS;
    const passDeadlineMs = options.passDeadlineMs ?? OBSERVATION_TICK.PASS_DEADLINE_MS;
    const seenAfter = startedAt - OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS;

    yield* options.forgetIneligible(seenAfter);
    const purged = yield* options.purgeCleared(startedAt);
    const speech = yield* options.sweepSpeech(startedAt);
    const push = yield* options.pushSpeech(startedAt);
    const accounts = yield* options.listAccounts(OBSERVATION_TICK.MAX_ACCOUNTS, seenAfter);

    const answer: ObservationTickAnswer = {
      accounts: 0,
      observed: 0,
      failed: 0,
      changed: 0,
      exhausted: false,
      purged,
      speech,
      push,
      turns: NOTHING_OPENED,
    };
    for (let index = 0; index < accounts.length; index += OBSERVATION_TICK.CONCURRENCY) {
      if (now() - startedAt + passDeadlineMs > budgetMs) {
        answer.exhausted = true;
        break;
      }
      const batch = accounts.slice(index, index + OBSERVATION_TICK.CONCURRENCY);
      const outcomes = yield* Effect.all(
        batch.map((account) => accountWithin(accountTurn(options, account.userId), passDeadlineMs)),
        { concurrency: "unbounded" },
      );
      for (const { pass, turns } of outcomes) {
        answer.accounts += 1;
        if (pass.complete) answer.observed += 1;
        else answer.failed += 1;
        if (pass.changed) answer.changed += 1;
        answer.turns = {
          observation: answer.turns.observation + turns.observation,
          holdRelease: answer.turns.holdRelease + turns.holdRelease,
          failed: answer.turns.failed + turns.failed,
          reseeded: answer.turns.reseeded + turns.reseeded,
        };
      }
    }

    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  });
}
