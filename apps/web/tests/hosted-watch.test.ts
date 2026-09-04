import assert from "node:assert/strict";
import test from "node:test";
import { PUSH_ENVIRONMENT } from "@sidecar/hosted";
import {
  normalizeSession,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderSessionObservation,
  SESSION_STATUS,
  type Session,
  type SessionNoticeMemory,
  SessionNoticeTracker,
  type SessionStatus,
} from "@sidecar/session";
import type { UnparsedWireValue } from "../server/core";
import {
  APNS_DELIVERY,
  APNS_INTERRUPTION_LEVEL,
  type ApnsDelivery,
  type ApnsNotification,
} from "../server/hosted/apns";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import {
  handleWatchTick,
  WATCH_CHANGE,
  WATCH_PAYLOAD_KEY,
  WATCH_TICK,
  WATCH_TICK_PATH,
  type WatchDevice,
  type WatchedAccount,
  type WatchObservation,
  type WatchTickOptions,
  watchNotificationFor,
} from "../server/hosted/watch";

function complete(sessions: readonly Session[]): () => Promise<WatchObservation> {
  return async () => ({ sessions, complete: true });
}

import vercelConfig from "../vercel.json";

const SECRET = "cron-secret-1";
const NOW = 1_800_000_000_000;
const TOKEN_A = "0a".repeat(32);
const TOKEN_B = "0b".repeat(32);
const conductor = PROVIDER_IDENTITY_BY_ID.conductor;

function session(
  providerSessionId: string,
  status: SessionStatus,
  overrides: {
    title?: string;
    workspace?: string;
    activity?: string;
    error?: string;
    holdingForDeveloper?: boolean;
  } = {},
): Session {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title: overrides.title ?? `Session ${providerSessionId}`,
    status,
    lastActivityAt: NOW - 1_000,
    detail: {},
  };
  if (overrides.workspace) {
    observation.workspace = { providerWorkspaceId: "ws-1", name: overrides.workspace };
  }
  if (overrides.holdingForDeveloper !== undefined) {
    observation.holdingForDeveloper = overrides.holdingForDeveloper;
  }
  if (overrides.activity)
    observation.detail = { ...observation.detail, activity: overrides.activity };
  if (overrides.error) observation.detail = { ...observation.detail, error: overrides.error };
  return normalizeSession(conductor, observation);
}

function tickRequest(headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return new Request(`https://luke.test${WATCH_TICK_PATH}`, { method: "GET", headers });
}

interface Harness {
  options: WatchTickOptions;
  events: string[];
  sent: ApnsNotification[];
  memories: Map<string, { memory: SessionNoticeMemory; passedAt: number }>;
  retired: string[];
}

function harness(input: {
  accounts?: WatchedAccount[];
  sessions?: Record<string, () => Promise<WatchObservation>>;
  memory?: Record<string, UnparsedWireValue>;
  devices?: Record<string, WatchDevice[]>;
  delivery?: (notification: ApnsNotification) => ApnsDelivery;
  now?: () => number;
  budgetMs?: number;
  overrides?: Partial<WatchTickOptions>;
}): Harness {
  const events: string[] = [];
  const sent: ApnsNotification[] = [];
  const memories = new Map<string, { memory: SessionNoticeMemory; passedAt: number }>();
  const retired: string[] = [];
  const options: WatchTickOptions = {
    request: tickRequest(),
    cronSecret: SECRET,
    encryptionSecret: "a".repeat(64),
    sender: {
      async send(notification) {
        events.push(`send:${notification.token}`);
        sent.push(notification);
        return input.delivery ? input.delivery(notification) : APNS_DELIVERY.DELIVERED;
      },
    },
    listAccounts: async () => input.accounts ?? [{ userId: "user-1", passedAt: undefined }],
    forgetIneligible: async () => {
      events.push("forget");
    },
    observeSessions: async (userId) => {
      events.push(`observe:${userId}`);
      const found = input.sessions?.[userId];
      return found ? found() : { sessions: [], complete: true };
    },
    readMemory: async (userId) => input.memory?.[userId],
    writeMemory: async (userId, memory, passedAt) => {
      events.push(`write:${userId}`);
      memories.set(userId, { memory, passedAt });
    },
    listDevices: async (userId) =>
      input.devices?.[userId] ?? [{ token: TOKEN_A, environment: PUSH_ENVIRONMENT.PRODUCTION }],
    retireDevice: async (token) => {
      retired.push(token);
    },
    now: input.now ?? (() => NOW),
    ...(input.budgetMs !== undefined ? { budgetMs: input.budgetMs } : undefined),
    ...input.overrides,
  };
  return { options, events, sent, memories, retired };
}

function memoryAfter(...passes: Array<readonly Session[]>): SessionNoticeMemory {
  const tracker = new SessionNoticeTracker();
  for (const [index, pass] of passes.entries())
    tracker.notices(pass, NOW - (passes.length - index) * 60_000);
  return tracker.snapshot();
}

test("the cron entry calls the tick path every minute inside a longer function cap", () => {
  assert.deepEqual(vercelConfig.crons, [{ path: WATCH_TICK_PATH, schedule: "* * * * *" }]);
  const cap = vercelConfig.functions["api/watch/tick.ts"].maxDuration * 1000;
  assert.ok(cap > WATCH_TICK.BUDGET_MS);
});

test("the tick gate order is method, secrets and sender, bearer", async () => {
  const wrongMethod = await handleWatchTick(
    harness({
      overrides: {
        request: new Request(`https://luke.test${WATCH_TICK_PATH}`, { method: "POST" }),
      },
    }).options,
  );
  assert.equal(wrongMethod.status, 405);

  const noSecret = await handleWatchTick(harness({ overrides: { cronSecret: undefined } }).options);
  assert.equal(noSecret.status, 503);
  assert.equal((await noSecret.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankSecret = await handleWatchTick(harness({ overrides: { cronSecret: "  " } }).options);
  assert.equal(blankSecret.status, 503);

  const noSender = await handleWatchTick(harness({ overrides: { sender: undefined } }).options);
  assert.equal(noSender.status, 503);

  const noVault = await handleWatchTick(
    harness({ overrides: { encryptionSecret: undefined } }).options,
  );
  assert.equal(noVault.status, 503);
  const blankVault = await handleWatchTick(
    harness({ overrides: { encryptionSecret: " " } }).options,
  );
  assert.equal(blankVault.status, 503);

  const wrongBearer = await handleWatchTick(
    harness({ overrides: { request: tickRequest({ authorization: "Bearer other" }) } }).options,
  );
  assert.equal(wrongBearer.status, 401);
  assert.equal((await wrongBearer.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const noBearer = await handleWatchTick(
    harness({ overrides: { request: tickRequest({}) } }).options,
  );
  assert.equal(noBearer.status, 401);
});

test("a tick with nobody to watch forgets the ineligible and answers zeros", async () => {
  const { options, events } = harness({ accounts: [] });
  const response = await handleWatchTick(options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accounts: 0,
    notices: 0,
    delivered: 0,
    retired: 0,
    exhausted: false,
  });
  assert.deepEqual(events, ["forget"]);
});

test("an account's first pass seeds its memory silently", async () => {
  const sessions = [session("a", SESSION_STATUS.WAITING, { holdingForDeveloper: true })];
  const { options, sent, memories } = harness({ sessions: { "user-1": complete(sessions) } });

  const response = await handleWatchTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 1,
    notices: 0,
    delivered: 0,
    retired: 0,
    exhausted: false,
  });
  assert.deepEqual(sent, []);
  assert.deepEqual(memories.get("user-1"), { memory: memoryAfter(sessions), passedAt: NOW });
});

test("a session that starts holding for the developer reaches every phone, memory written first", async () => {
  const before = [session("a", SESSION_STATUS.WORKING)];
  const now = [
    session("a", SESSION_STATUS.WAITING, {
      title: "Fix the flaky test",
      workspace: "luke",
      holdingForDeveloper: true,
      activity: "Run pnpm test",
    }),
  ];
  const { options, sent, events, memories } = harness({
    accounts: [{ userId: "user-1", passedAt: NOW - 60_000 }],
    memory: { "user-1": JSON.parse(JSON.stringify(memoryAfter(before))) },
    sessions: { "user-1": complete(now) },
    devices: {
      "user-1": [
        { token: TOKEN_A, environment: PUSH_ENVIRONMENT.PRODUCTION },
        { token: TOKEN_B, environment: PUSH_ENVIRONMENT.SANDBOX },
      ],
    },
  });

  const response = await handleWatchTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 1,
    notices: 1,
    delivered: 2,
    retired: 0,
    exhausted: false,
  });
  assert.deepEqual(events, [
    "forget",
    "observe:user-1",
    "write:user-1",
    `send:${TOKEN_A}`,
    `send:${TOKEN_B}`,
  ]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], {
    token: TOKEN_A,
    environment: PUSH_ENVIRONMENT.PRODUCTION,
    collapseId: "a",
    payload: {
      aps: {
        alert: {
          title: "Fix the flaky test",
          subtitle: "luke",
          body: "Waiting on you: Run pnpm test",
        },
        sound: "default",
        "interruption-level": APNS_INTERRUPTION_LEVEL.TIME_SENSITIVE,
        "thread-id": "a",
      },
      custom: {
        [WATCH_PAYLOAD_KEY.PROVIDER_ID]: "conductor",
        [WATCH_PAYLOAD_KEY.SESSION_ID]: "a",
        [WATCH_PAYLOAD_KEY.CHANGE]: WATCH_CHANGE.NEEDS_INPUT,
      },
    },
  });
  assert.equal(sent[1]?.environment, PUSH_ENVIRONMENT.SANDBOX);
  const written = memories.get("user-1");
  assert.ok(written);
  assert.deepEqual(written.memory, [
    {
      providerId: "conductor",
      providerSessionId: "a",
      status: "waiting",
      noticedAt: [{ status: "waiting", at: NOW }],
    },
  ]);
});

test("a session that stops on an error says so, and a finish or an unheld wait says nothing", async () => {
  const before = [
    session("stopped", SESSION_STATUS.WORKING),
    session("finished", SESSION_STATUS.WORKING),
    session("paused", SESSION_STATUS.WORKING),
  ];
  const now = [
    session("stopped", SESSION_STATUS.ERROR, { error: "Rate   limit\nexceeded" }),
    session("finished", SESSION_STATUS.COMPLETE),
    session("paused", SESSION_STATUS.WAITING),
  ];
  const { options, sent } = harness({
    accounts: [{ userId: "user-1", passedAt: NOW - 60_000 }],
    memory: { "user-1": JSON.parse(JSON.stringify(memoryAfter(before))) },
    sessions: { "user-1": complete(now) },
  });

  const response = await handleWatchTick(options);

  assert.equal((await response.json()).notices, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.payload.aps.alert, {
    title: "Session stopped",
    body: "Stopped: Rate limit exceeded",
  });
  assert.equal(sent[0]?.payload.custom[WATCH_PAYLOAD_KEY.CHANGE], WATCH_CHANGE.FAILED);
});

test("a token Apple reports gone is retired and the others still hear", async () => {
  const before = [session("a", SESSION_STATUS.WORKING)];
  const now = [session("a", SESSION_STATUS.ERROR)];
  const { options, retired } = harness({
    accounts: [{ userId: "user-1", passedAt: NOW - 60_000 }],
    memory: { "user-1": JSON.parse(JSON.stringify(memoryAfter(before))) },
    sessions: { "user-1": complete(now) },
    devices: {
      "user-1": [
        { token: TOKEN_A, environment: PUSH_ENVIRONMENT.PRODUCTION },
        { token: TOKEN_B, environment: PUSH_ENVIRONMENT.PRODUCTION },
      ],
    },
    delivery: (notification) =>
      notification.token === TOKEN_A ? APNS_DELIVERY.TOKEN_GONE : APNS_DELIVERY.DELIVERED,
  });

  const response = await handleWatchTick(options);

  assert.deepEqual(await response.json(), {
    accounts: 1,
    notices: 1,
    delivered: 1,
    retired: 1,
    exhausted: false,
  });
  assert.deepEqual(retired, [TOKEN_A]);
});

test("a pass long after the last reseeds instead of announcing the gap", async () => {
  const before = [session("a", SESSION_STATUS.WORKING)];
  const now = [session("a", SESSION_STATUS.ERROR)];
  const { options, sent, memories } = harness({
    accounts: [{ userId: "user-1", passedAt: NOW - WATCH_TICK.GAP_MS - 1 }],
    memory: { "user-1": JSON.parse(JSON.stringify(memoryAfter(before))) },
    sessions: { "user-1": complete(now) },
  });

  await handleWatchTick(options);

  assert.deepEqual(sent, []);
  assert.deepEqual(memories.get("user-1")?.memory, memoryAfter(now));

  const inside = harness({
    accounts: [{ userId: "user-1", passedAt: NOW - WATCH_TICK.GAP_MS }],
    memory: { "user-1": JSON.parse(JSON.stringify(memoryAfter(before))) },
    sessions: { "user-1": complete(now) },
  });
  await handleWatchTick(inside.options);
  assert.equal(inside.sent.length, 1);
});

test("an account whose observation fails or is incomplete keeps its memory and its turn", async () => {
  const before = memoryAfter([session("a", SESSION_STATUS.WORKING)]);
  const unreadable: Array<() => Promise<WatchObservation>> = [
    async () => {
      throw new Error("provider down");
    },
    // The adapter's own answer to a refused or unanswered pass: its previous
    // snapshot, which for a pass built fresh is nothing at all.
    async () => ({ sessions: [], complete: false }),
    async () => ({ sessions: [session("a", SESSION_STATUS.ERROR)], complete: false }),
  ];
  for (const observe of unreadable) {
    const { options, sent, memories, events } = harness({
      accounts: [{ userId: "user-1", passedAt: NOW - 60_000 }],
      memory: { "user-1": JSON.parse(JSON.stringify(before)) },
      sessions: { "user-1": observe },
    });

    const response = await handleWatchTick(options);

    assert.equal(response.status, 200);
    assert.deepEqual(sent, []);
    assert.equal(memories.has("user-1"), false);
    assert.deepEqual(events, ["forget", "observe:user-1"]);
  }
});

test("an account with no usable phone is not observed at all", async () => {
  const { options, events } = harness({
    sessions: { "user-1": complete([session("a", SESSION_STATUS.WORKING)]) },
    devices: { "user-1": [{ token: TOKEN_A, environment: "staging" }] },
  });
  await handleWatchTick(options);
  assert.deepEqual(events, ["forget"]);
});

test("a tick stops on its budget and says so, leaving the rest for the next", async () => {
  let clock = NOW;
  const accounts = Array.from({ length: WATCH_TICK.CONCURRENCY * 3 }, (_, index) => ({
    userId: `user-${index}`,
    passedAt: undefined,
  }));
  const { options, events } = harness({
    accounts,
    now: () => clock,
    budgetMs: 1_000,
    overrides: {
      observeSessions: async (userId) => {
        events.push(`observe:${userId}`);
        clock += 300;
        return { sessions: [], complete: true };
      },
    },
  });

  const response = await handleWatchTick(options);
  const answer = await response.json();

  assert.equal(answer.exhausted, true);
  assert.equal(answer.accounts, WATCH_TICK.CONCURRENCY);
  assert.equal(
    events.filter((event) => event.startsWith("observe:")).length,
    WATCH_TICK.CONCURRENCY,
  );
});

test("a notification is composed only for a notice the phone should hear", () => {
  const device: WatchDevice = { token: TOKEN_A, environment: PUSH_ENVIRONMENT.PRODUCTION };
  const tracker = new SessionNoticeTracker();
  tracker.notices(
    [session("held", SESSION_STATUS.WORKING), session("done", SESSION_STATUS.WORKING)],
    NOW - 60_000,
  );
  const notices = tracker.notices(
    [
      session("held", SESSION_STATUS.WAITING, { holdingForDeveloper: true, title: "  " }),
      session("done", SESSION_STATUS.COMPLETE),
    ],
    NOW,
  );
  const [held, done] = notices;
  assert.ok(held && done);
  assert.equal(watchNotificationFor(done, device), undefined);
  assert.equal(watchNotificationFor(held, { ...device, environment: "staging" }), undefined);
  const composed = watchNotificationFor(held, device);
  assert.ok(composed);
  assert.equal(composed.payload.aps.alert.body, "Waiting on you.");
});
