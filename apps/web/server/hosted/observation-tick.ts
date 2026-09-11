import { NOTHING_OPENED, type TurnOpeningOutcome } from "./brain-host/opener.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "./http.js";
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

/** Where Vercel's scheduler calls, fixed here so the cron entry can be checked against it. */
export const OBSERVATION_TICK_PATH = "/api/observation/tick";

export const OBSERVATION_ENVIRONMENT = {
  /** Vercel sends this as the bearer on every scheduled call once it is set. */
  CRON_SECRET: "CRON_SECRET",
} as const;

export const OBSERVATION_TICK = {
  /**
   * How long one tick may spend before leaving the rest for the next. A batch
   * starts only while a whole pass deadline still fits inside it, so the tick
   * settles under the function's own cap even when its last batch spends
   * every second a pass may.
   */
  BUDGET_MS: 50_000,
  /**
   * The longest one account's pass may run before the tick counts it failed
   * and moves on: the adapter's whole 429 budget and a request deadline
   * besides. The pass itself is not interrupted — a roster it still reads
   * whole is written down if the function lives to see it — but the tick no
   * longer waits on it, and the attempt the pass recorded at its start is
   * what keeps the account from heading the next tick's order.
   */
  PASS_DEADLINE_MS: 25_000,
  /** The function duration the tick's bundle declares; the budget leaves headroom under it. */
  MAX_DURATION_SECONDS: 60,
  /** The most accounts one tick lists; the least recently attempted come first, so nobody starves. */
  MAX_ACCOUNTS: 200,
  /** Accounts observed at once; each is a fan of provider requests of its own. */
  CONCURRENCY: 4,
  /** How recently an account must have been seen to be observed on the schedule. */
  ACCOUNT_SEEN_WITHIN_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

interface ObservedAccount {
  userId: string;
}

/** What one account's pass came to, as the tick counts it. */
export interface AccountPassOutcome {
  complete: boolean;
  changed: boolean;
}

export interface ObservationTickOptions {
  request: Request;
  /** The value of CRON_SECRET; undefined means the env var is absent and the schedule is off. */
  cronSecret: string | undefined;
  /**
   * The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var
   * is absent, and a tick that cannot read a key must not run at all, since a
   * pass that read nothing would be written down as an account with nothing.
   */
  encryptionSecret: string | undefined;
  /** Accounts with a cloud key seen since `seenAfter`, least recently attempted first, never attempted first of all. */
  listAccounts: (limit: number, seenAfter: number) => Promise<ObservedAccount[]>;
  /** Drops the snapshot, diffs, and pass record of every account without a cloud key or not seen since `seenAfter`. */
  forgetIneligible: (seenAfter: number) => Promise<void>;
  /**
   * Removes every conversation a Clear stamped past its retention window,
   * answering how many went. Retention rides on the observation tick because
   * it is the one schedule the service runs; the purge is not an observation
   * and reads nothing of any account.
   */
  purgeCleared: (now: number) => Promise<number>;
  /**
   * The pass over every briefing still on offer, of any account: held while
   * a device of its account reports quiet ahead, released unspoken with a
   * turn queued for the brain to decide again once the quiet lifts, and
   * expired unspoken past its own instant. It rides on the tick for the same
   * reason the purge does, and like the purge it observes nothing: it reads
   * the offers' events and the devices' quiet instants, never a word.
   */
  sweepSpeech: (now: number) => Promise<SpeechSweepOutcome>;
  /**
   * The pass over the briefings still on offer after the sweep, of any
   * account, pushing to a phone the ones no device is placed to say, as the
   * push module decides from the offers' standing and the devices' reported
   * presence. It runs after the sweep so an offer the sweep just held or
   * ended is never read as open here.
   */
  pushSpeech: (now: number) => Promise<SpeechPushOutcome>;
  /** One read-only pass over the account's cloud providers, written down as the pass module does. */
  observe: (userId: string) => Promise<AccountPassOutcome>;
  /**
   * The account's pending roster diffs handed to the brain as observation
   * turns, one per observed conversation, after the account's own pass and
   * under the same deadline as that pass, so the two together are one
   * account's share of the tick and the batches are gated exactly as before.
   * A pass that fails still has its earlier diffs opened. Runs only for an
   * account this tick listed, which is the one way an account is ever named
   * to eve on the tick's own credential.
   */
  openTurns: (userId: string) => Promise<TurnOpeningOutcome>;
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
  /** The observation turns the accounts' pending diffs were opened as. */
  turns: TurnOpeningOutcome;
}

const FAILED_PASS: AccountPassOutcome = { complete: false, changed: false };

/** An opening that threw or outran the deadline, counted as one failure: what it did not consume stands for the next tick. */
const FAILED_OPENING: TurnOpeningOutcome = { observation: 0, failed: 1 };

/** One account's pass and its opening as the tick counts them: each failed when it threw, and both cut short when the account outran its deadline. */
interface AccountOutcome {
  readonly pass: AccountPassOutcome;
  readonly turns: TurnOpeningOutcome;
}

const TIMED_OUT_ACCOUNT: AccountOutcome = { pass: FAILED_PASS, turns: FAILED_OPENING };

function accountWithin(
  account: Promise<AccountOutcome>,
  deadlineMs: number,
): Promise<AccountOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT_ACCOUNT), deadlineMs);
    account
      .then((outcome) => resolve(outcome))
      .catch(() => resolve(TIMED_OUT_ACCOUNT))
      .finally(() => clearTimeout(timer));
  });
}

/** The pass, then the opening over what it and earlier passes left pending; a pass that throws is failed and still followed by the opening. */
async function accountTurn(
  options: ObservationTickOptions,
  userId: string,
): Promise<AccountOutcome> {
  const pass = await options.observe(userId).catch(() => FAILED_PASS);
  const turns = await options.openTurns(userId).catch(() => FAILED_OPENING);
  return { pass, turns };
}

export async function handleObservationTick(options: ObservationTickOptions): Promise<Response> {
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

  await options.forgetIneligible(seenAfter);
  const purged = await options.purgeCleared(startedAt);
  const speech = await options.sweepSpeech(startedAt);
  const push = await options.pushSpeech(startedAt);
  const accounts = await options.listAccounts(OBSERVATION_TICK.MAX_ACCOUNTS, seenAfter);

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
    const outcomes = await Promise.all(
      batch.map((account) => accountWithin(accountTurn(options, account.userId), passDeadlineMs)),
    );
    for (const { pass, turns } of outcomes) {
      answer.accounts += 1;
      if (pass.complete) answer.observed += 1;
      else answer.failed += 1;
      if (pass.changed) answer.changed += 1;
      answer.turns = {
        observation: answer.turns.observation + turns.observation,
        failed: answer.turns.failed + turns.failed,
      };
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
