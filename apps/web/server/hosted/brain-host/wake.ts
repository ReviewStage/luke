import { timingSafeEqual } from "node:crypto";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "../http.js";
import { decodeRosterDiff } from "../roster-diff.js";
import type { HostedStore } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";
import { acquireLeaseNow } from "./lease-run.js";
import {
  type BrainSessionSeams,
  HOSTED_CONVERSATION_KEY,
  leaseSeamsFor,
  openBrainSession,
  reporter,
} from "./route.js";
import { wakeEventsFromDiffs } from "./wake-events.js";

/**
 * The scheduled wake of the hosted brain: once a minute, for every account
 * whose stored roster changed since the brain last looked, one observation
 * turn over the pending diffs — the brain's own look at what changed, its
 * `announce` the one thing that can leave a briefing — and for every
 * conversation a function left a run unfinished in, its resumption. The
 * observation tick stays what it is: it writes the roster down and decides
 * nothing, and the brain runs here, in a function with the room a turn needs.
 */

export interface BrainWakeOptions extends BrainSessionSeams {
  request: Request;
  /** The value of CRON_SECRET; undefined means the env var is absent and the schedule is off. */
  cronSecret: string | undefined;
  encryptionSecret: string | undefined;
  openAiKey: string | undefined;
  store: (secret: string) => HostedStore;
  budgetMs?: number;
  concurrency?: number;
}

export interface BrainWakeAnswer {
  /** Conversations the wake reached. */
  users: number;
  /** Conversations that opened an observation turn over pending diffs. */
  woke: number;
  /** Conversations opened only to resume what a function left unfinished. */
  resumed: number;
  /** Conversations another holder still ran, left for the next wake. */
  busy: number;
  failed: number;
  /** Whether the wake stopped on its budget with conversations still listed. */
  exhausted: boolean;
}

const WAKE_OUTCOME = {
  WOKE: "woke",
  RESUMED: "resumed",
  BUSY: "busy",
  FAILED: "failed",
} as const;

type WakeOutcome = (typeof WAKE_OUTCOME)[keyof typeof WAKE_OUTCOME];

function bearerMatches(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const offered = Buffer.from(authorization);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

async function wakeConversation(
  options: BrainWakeOptions,
  store: HostedStore,
  secret: string,
  openAiKey: string,
  userId: string,
): Promise<WakeOutcome> {
  const lease = await acquireLeaseNow(leaseSeamsFor(options, store, userId));
  if (!lease) return WAKE_OUTCOME.BUSY;
  const session = await openBrainSession(options, { userId, secret, store }, openAiKey, lease);
  const now = options.now ?? Date.now;
  try {
    await session.brain.agent.ready();
    const pending = await store.roster.pendingDiffs(userId);
    const diffs = pending.flatMap((record) => {
      const diff = decodeRosterDiff(record.payload);
      return diff ? [{ diff, observedAt: record.observedAt }] : [];
    });
    const roster = await session.brain.refreshRoster();
    // The events open one turn together; the inbox's earlier entries, if a
    // turn left any standing, open with them. A diff this build cannot read
    // is consumed with the rest: the snapshot it led to is the truth, and
    // the next diff is taken against that.
    await session.brain.agent.observe(wakeEventsFromDiffs(diffs, roster));
    for (const record of pending) await store.roster.consumeDiff(userId, record.id, now());
    return pending.length > 0 ? WAKE_OUTCOME.WOKE : WAKE_OUTCOME.RESUMED;
  } catch (error) {
    reporter(options)(
      `The brain's wake for one account failed: ${error instanceof Error ? error.name : "unknown error"}`,
    );
    return WAKE_OUTCOME.FAILED;
  } finally {
    await session.finish();
  }
}

export async function handleBrainWake(options: BrainWakeOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const cronSecret = options.cronSecret?.trim();
  const encryptionSecret = options.encryptionSecret?.trim();
  const openAiKey = options.openAiKey?.trim();
  if (!cronSecret || !encryptionSecret || !openAiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!bearerMatches(request, cronSecret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const now = options.now ?? Date.now;
  const startedAt = now();
  const budgetMs = options.budgetMs ?? BRAIN_HOST.WAKE_BUDGET_MS;
  const concurrency = options.concurrency ?? BRAIN_HOST.WAKE_CONCURRENCY;
  const store = options.store(encryptionSecret);

  // A user with a diff waiting and a user with a run left unfinished are one
  // list: the same session runs both, resuming first, then observing.
  const listed = new Set<string>();
  for (const userId of await store.roster.usersWithPendingDiffs(BRAIN_HOST.WAKE_MAX_USERS)) {
    listed.add(userId);
  }
  for (const unfinished of await store.runs.unfinished(BRAIN_HOST.WAKE_MAX_USERS)) {
    if (unfinished.sessionKey === HOSTED_CONVERSATION_KEY) listed.add(unfinished.userId);
  }
  const users = [...listed];

  const answer: BrainWakeAnswer = {
    users: 0,
    woke: 0,
    resumed: 0,
    busy: 0,
    failed: 0,
    exhausted: false,
  };
  for (let index = 0; index < users.length; index += concurrency) {
    if (now() - startedAt > budgetMs) {
      answer.exhausted = true;
      break;
    }
    const batch = users.slice(index, index + concurrency);
    const outcomes = await Promise.all(
      batch.map((userId) => wakeConversation(options, store, encryptionSecret, openAiKey, userId)),
    );
    for (const outcome of outcomes) {
      answer.users += 1;
      answer[outcome] += 1;
    }
  }
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
