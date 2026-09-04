import { timingSafeEqual } from "node:crypto";
import {
  boundedText,
  isPushEnvironment,
  normalizeSession,
  PROVIDER_IDENTITY_BY_ID,
  SESSION_NOTICE_STATUS,
  type Session,
  type SessionNotice,
  type SessionNoticeMemory,
  SessionNoticeTracker,
  sessionNoticeMemoryFromWire,
  type UnparsedWireValue,
} from "../core.js";
import {
  APNS_DELIVERY,
  APNS_INTERRUPTION_LEVEL,
  type ApnsAlert,
  type ApnsNotification,
  type ApnsSender,
} from "./apns.js";
import {
  type CloudObserveSeams,
  observeCloudProviders,
  type VaultKeyRow,
} from "./cloud-observe.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/**
 * The scheduled watch: once a minute, for every account signed in on a phone
 * and holding a synced key, the service observes that account's cloud
 * sessions exactly as the on-demand endpoint does, diffs the pass against
 * the account's memory of the last one with the same deterministic tracker
 * the desktop runs, and tells the phone about a session that started holding
 * for the developer or stopped on an error. Nothing a model wrote reaches
 * this pass: there is no evaluator here, and what it keeps between ticks is
 * the tracker's memory alone.
 */

/** Where Vercel's scheduler calls, fixed here so the cron entry can be checked against it. */
export const WATCH_TICK_PATH = "/api/watch/tick";

export const WATCH_ENVIRONMENT = {
  /** Vercel sends this as the bearer on every scheduled call once it is set. */
  CRON_SECRET: "CRON_SECRET",
} as const;

export const WATCH_TICK = {
  /** How long one tick may spend before leaving the rest for the next; the function's own cap sits above it. */
  BUDGET_MS: 45_000,
  /** The most accounts one tick lists; the oldest-passed come first, so nobody starves. */
  MAX_ACCOUNTS: 200,
  /** Accounts observed at once; each is a fan of provider requests of its own. */
  CONCURRENCY: 4,
  /**
   * A pass this long after the last is a watch that was down, not a minute
   * that passed: the edges inside the gap are history arriving late, the
   * phone's roster's to show and not a notification's to announce, so the
   * memory reseeds silently instead of diffing across it.
   */
  GAP_MS: 5 * 60_000,
} as const;

/**
 * The two changes a notification may announce, named for the phone as the
 * desktop's announcements name them: a turn holding for the developer, or a
 * session stopped on an error. A finish is deliberately not one of them.
 */
export const WATCH_CHANGE = {
  NEEDS_INPUT: "needs-input",
  FAILED: "failed",
} as const;

export type WatchChange = (typeof WATCH_CHANGE)[keyof typeof WATCH_CHANGE];

/** The longest alert line a notification carries; the fields were bounded upstream, this is the belt. */
const MAXIMUM_ALERT_LINE_LENGTH = 200;

/** Apple caps a collapse id at 64 bytes. */
const MAXIMUM_COLLAPSE_ID_LENGTH = 64;

export interface WatchedAccount {
  userId: string;
  /** When the account's last pass completed, or undefined when it has never been watched. */
  passedAt: number | undefined;
}

export interface WatchDevice {
  token: string;
  environment: string;
}

export interface WatchTickOptions {
  request: Request;
  /** The value of CRON_SECRET; undefined means the env var is absent and the watch is off. */
  cronSecret: string | undefined;
  /** The sender, or undefined when the deployment holds no Apple credential. */
  sender: Pick<ApnsSender, "send"> | undefined;
  /**
   * The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var
   * is absent, and a watch that cannot read a key must not run at all, since a
   * pass that read nothing would be written down as an account with nothing.
   */
  encryptionSecret: string | undefined;
  /** Accounts with a phone and a key, oldest pass first, never-passed first of all. */
  listAccounts: (limit: number) => Promise<WatchedAccount[]>;
  /** Drops the memory of every account that no longer has a phone or a key. */
  forgetIneligible: () => Promise<void>;
  /** One read-only observation pass over the account's cloud sessions. */
  observeSessions: (userId: string) => Promise<WatchObservation>;
  readMemory: (userId: string) => Promise<UnparsedWireValue>;
  writeMemory: (userId: string, memory: SessionNoticeMemory, passedAt: number) => Promise<void>;
  listDevices: (userId: string) => Promise<WatchDevice[]>;
  /** Deletes a token Apple has said will never take another notification. */
  retireDevice: (token: string) => Promise<void>;
  now?: () => number;
  budgetMs?: number;
}

/**
 * One pass over an account's cloud sessions. `complete` says the sessions
 * are every provider's whole current roster; a pass a provider refused, did
 * not answer, or whose key could not be read is incomplete, and diffing it
 * would read every session as gone and then, when the provider answered
 * again, as new — silently, since first sight is never news.
 */
export interface WatchObservation {
  sessions: readonly Session[];
  complete: boolean;
}

export interface WatchTickAnswer {
  accounts: number;
  notices: number;
  delivered: number;
  retired: number;
  /** Whether the tick stopped on its budget with accounts still listed. */
  exhausted: boolean;
}

function bearerMatches(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const expected = `Bearer ${secret}`;
  const offered = Buffer.from(authorization);
  const wanted = Buffer.from(expected);
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/**
 * The same narrowing the desktop's deterministic path keeps: a finish is not
 * an interruption, and a waiting session is one only when its provider said
 * the turn holds for the developer. Everything else the phone's roster shows.
 */
export function watchAnnouncementChange(notice: SessionNotice): WatchChange | undefined {
  if (notice.status === SESSION_NOTICE_STATUS.ERROR) return WATCH_CHANGE.FAILED;
  if (notice.status === SESSION_NOTICE_STATUS.WAITING && notice.holdingForDeveloper === true) {
    return WATCH_CHANGE.NEEDS_INPUT;
  }
  return undefined;
}

function flattened(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function alertLine(value: string): string | undefined {
  return boundedText(flattened(value), MAXIMUM_ALERT_LINE_LENGTH);
}

/** The custom keys the phone reads on a tap, beside Apple's `aps`. */
export const WATCH_PAYLOAD_KEY = {
  PROVIDER_ID: "providerId",
  SESSION_ID: "sessionId",
  CHANGE: "change",
} as const;

/**
 * The notification one notice earns, or none. Fields the provider wrote about
 * the session and nothing else: the title as its alert, the workspace under
 * it, and one line saying what it holds on or why it stopped.
 */
export function watchNotificationFor(
  notice: SessionNotice,
  device: WatchDevice,
): ApnsNotification | undefined {
  const change = watchAnnouncementChange(notice);
  if (!change || !isPushEnvironment(device.environment)) return undefined;
  const title = alertLine(notice.title) ?? notice.providerName;
  const body =
    change === WATCH_CHANGE.FAILED
      ? (notice.error && alertLine(`Stopped: ${notice.error}`)) || "Stopped on an error."
      : (notice.activity && alertLine(`Waiting on you: ${notice.activity}`)) || "Waiting on you.";
  const collapseId = boundedText(notice.providerSessionId, MAXIMUM_COLLAPSE_ID_LENGTH);
  const subtitle = notice.workspace ? alertLine(notice.workspace) : undefined;
  const alert: ApnsAlert = {
    title,
    ...(subtitle && subtitle !== title ? { subtitle } : undefined),
    body,
  };
  return {
    token: device.token,
    environment: device.environment,
    payload: {
      aps: {
        alert,
        sound: "default",
        "interruption-level": APNS_INTERRUPTION_LEVEL.TIME_SENSITIVE,
        ...(collapseId ? { "thread-id": collapseId } : undefined),
      },
      custom: {
        [WATCH_PAYLOAD_KEY.PROVIDER_ID]: notice.providerId,
        [WATCH_PAYLOAD_KEY.SESSION_ID]: notice.providerSessionId,
        [WATCH_PAYLOAD_KEY.CHANGE]: change,
      },
    },
    ...(collapseId ? { collapseId } : undefined),
  };
}

interface AccountOutcome {
  notices: number;
  delivered: number;
  retired: number;
}

async function watchAccount(
  account: WatchedAccount,
  options: WatchTickOptions,
  sender: Pick<ApnsSender, "send">,
  now: number,
): Promise<AccountOutcome> {
  const outcome: AccountOutcome = { notices: 0, delivered: 0, retired: 0 };
  const devices = (await options.listDevices(account.userId)).filter((device) =>
    isPushEnvironment(device.environment),
  );
  if (devices.length === 0) return outcome;

  let observation: WatchObservation;
  try {
    observation = await options.observeSessions(account.userId);
  } catch {
    observation = { sessions: [], complete: false };
  }
  // A pass that could not read leaves the memory as it was; the next tick
  // that can read either continues it or, past the gap, reseeds it.
  if (!observation.complete) return outcome;
  const { sessions } = observation;

  const stale = account.passedAt !== undefined && now - account.passedAt > WATCH_TICK.GAP_MS;
  const tracker = stale
    ? new SessionNoticeTracker()
    : SessionNoticeTracker.restore(
        sessionNoticeMemoryFromWire(await options.readMemory(account.userId)),
      );
  const notices = tracker.notices(sessions, now);
  // Written before anything is sent: a tick that dies mid-send misses a
  // notification rather than repeating one, and the repeat window it just
  // recorded is what keeps the next tick from saying it again.
  await options.writeMemory(account.userId, tracker.snapshot(), now);

  for (const notice of notices) {
    const change = watchAnnouncementChange(notice);
    if (!change) continue;
    outcome.notices += 1;
    for (const device of devices) {
      const notification = watchNotificationFor(notice, device);
      if (!notification) continue;
      const delivery = await sender.send(notification);
      if (delivery === APNS_DELIVERY.DELIVERED) outcome.delivered += 1;
      if (delivery === APNS_DELIVERY.TOKEN_GONE) {
        await options.retireDevice(device.token);
        outcome.retired += 1;
      }
    }
  }
  return outcome;
}

export async function handleWatchTick(options: WatchTickOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secret = options.cronSecret?.trim();
  if (!secret || !options.sender || !options.encryptionSecret?.trim()) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  if (!bearerMatches(request, secret)) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const now = options.now ?? Date.now;
  const startedAt = now();
  const budgetMs = options.budgetMs ?? WATCH_TICK.BUDGET_MS;
  const sender = options.sender;

  await options.forgetIneligible();
  const accounts = await options.listAccounts(WATCH_TICK.MAX_ACCOUNTS);

  const answer: WatchTickAnswer = {
    accounts: 0,
    notices: 0,
    delivered: 0,
    retired: 0,
    exhausted: false,
  };
  for (let index = 0; index < accounts.length; index += WATCH_TICK.CONCURRENCY) {
    if (now() - startedAt >= budgetMs) {
      answer.exhausted = true;
      break;
    }
    const batch = accounts.slice(index, index + WATCH_TICK.CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((account) => watchAccount(account, options, sender, now())),
    );
    for (const outcome of outcomes) {
      answer.accounts += 1;
      answer.notices += outcome.notices;
      answer.delivered += outcome.delivered;
      answer.retired += outcome.retired;
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

/**
 * The production observation seam: the same cloud pass the on-demand endpoint
 * runs, normalized into the sessions the tracker reads. An observation the
 * normalizer refuses is dropped alone, never the pass.
 */
export function cloudSessionsObserver(input: {
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  encryptionSecret: string;
  seams?: CloudObserveSeams;
}): (userId: string) => Promise<WatchObservation> {
  return async (userId) => {
    const observed = await observeCloudProviders(
      await input.readVaultKeys(userId),
      input.encryptionSecret,
      input.seams,
    );
    const sessions: Session[] = [];
    let complete = true;
    for (const { providerId, observations, failure } of observed) {
      if (failure) complete = false;
      const provider = PROVIDER_IDENTITY_BY_ID[providerId];
      for (const observation of observations) {
        try {
          sessions.push(normalizeSession(provider, observation));
        } catch {
          // A malformed observation is the adapter's fault and its own row's loss.
        }
      }
    }
    return { sessions, complete };
  };
}
