import { timingSafeEqual } from "node:crypto";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { SpeechSweepOutcome } from "./store/speech.js";

/**
 * The scheduled observation: once a minute, for every account seen within
 * the last week and holding a cloud provider key, the service runs the same
 * read-only pass the on-demand endpoint runs and writes the roster down —
 * the snapshot, and the diff the brain host will wake on. Nothing here
 * decides anything: no model runs, no notification leaves, and what a pass
 * leaves behind is a stored roster and a stored difference.
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
  /** One read-only pass over the account's cloud providers, written down as the pass module does. */
  observe: (userId: string) => Promise<AccountPassOutcome>;
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
}

const FAILED_PASS: AccountPassOutcome = { complete: false, changed: false };

/** One account's pass as the tick counts it: failed when it threw, and failed when it outran its deadline. */
function passWithin(
  pass: Promise<AccountPassOutcome>,
  deadlineMs: number,
): Promise<AccountPassOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(FAILED_PASS), deadlineMs);
    pass
      .then((outcome) => resolve(outcome))
      .catch(() => resolve(FAILED_PASS))
      .finally(() => clearTimeout(timer));
  });
}

function bearerMatches(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const offered = Buffer.from(authorization);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
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
  if (!bearerMatches(request, secret)) {
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
  const accounts = await options.listAccounts(OBSERVATION_TICK.MAX_ACCOUNTS, seenAfter);

  const answer: ObservationTickAnswer = {
    accounts: 0,
    observed: 0,
    failed: 0,
    changed: 0,
    exhausted: false,
    purged,
    speech,
  };
  for (let index = 0; index < accounts.length; index += OBSERVATION_TICK.CONCURRENCY) {
    if (now() - startedAt + passDeadlineMs > budgetMs) {
      answer.exhausted = true;
      break;
    }
    const batch = accounts.slice(index, index + OBSERVATION_TICK.CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((account) => passWithin(options.observe(account.userId), passDeadlineMs)),
    );
    for (const outcome of outcomes) {
      answer.accounts += 1;
      if (outcome.complete) answer.observed += 1;
      else answer.failed += 1;
      if (outcome.changed) answer.changed += 1;
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
