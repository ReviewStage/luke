import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { conversations, turns } from "@luke/database/schemas/storage";
import { hostedUsage, voiceSessionUsage } from "@luke/database/schemas/usage";
import { voiceAvatarSessions, voiceSessions } from "@luke/database/schemas/voice";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { VOICE_DELEGATION_MODE } from "@luke/database/voice-vocabulary";
import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { Effect } from "effect";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { USER_ROLE } from "./admin-access.js";
import { readAdminCost, readAdminCostUsage } from "./admin-cost-queries.js";
import { COST_SOURCE } from "./admin-cost-wire.js";
import { ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW } from "./http.js";

/**
 * admin-cost-queries.test.ts -- the Cost screen's reads over a real dialect:
 * a turn's tokens land under its UTC day, its account, its source, and each
 * model its by-model breakdown names, a coding agent's workers counted as
 * the agent's; seconds and merged pull requests land by day and account;
 * the scope leaves admins out and a read naming one account reads no other's.
 *
 * Synthetic accounts, models, and instants throughout.
 */

/** Noon on the window's last day; every instant below is placed against it. */
const NOW = Date.UTC(2026, 9, 17, 12);
const TODAY = "2026-10-17";
const YESTERDAY = "2026-10-16";
const AT_TODAY = new Date(Date.UTC(2026, 9, 17, 9));
const AT_YESTERDAY = new Date(Date.UTC(2026, 9, 16, 9));
/** Before the 7-day window's prior week began, so nothing read reaches it. */
const AT_LONG_AGO = new Date(Date.UTC(2026, 8, 1, 9));

const MODEL = { OPUS: "anthropic/claude-opus-test", MINI: "openai/gpt-mini-test" } as const;

const WEEK = ADMIN_METRICS_WINDOW.WEEK;

const counts = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});

const openAccount = (role: string = USER_ROLE.USER) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test`, role });
    return id;
  });

const openConversation = (
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
  parentConversationId?: string,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(conversations)
      .values({ userId, kind, parentConversationId: parentConversationId ?? null })
      .returning({ id: conversations.id });
    if (row === undefined) throw new Error("no conversation was written");
    return row.id;
  });

const settleTurn = (
  userId: string,
  conversationId: string,
  turn: {
    model: string | null;
    usage: typeof turns.$inferInsert.usage;
    settledAt: Date;
    fastRefused?: boolean;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db.insert(turns).values({
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      model: turn.model,
      usage: turn.usage,
      queuedAt: turn.settledAt,
      settledAt: turn.settledAt,
      fastRefused: turn.fastRefused ?? false,
    });
  });

/** The rows a read answered, without the zeros nothing here sets, in an order a comparison can hold. */
function tokenRows(usage: Effect.Success<ReturnType<typeof readAdminCostUsage>>) {
  return usage.tokens
    .map((row) => ({
      day: row.day,
      source: row.source,
      model: row.model,
      fastRefused: row.fastRefused,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    }))
    .sort((left, right) =>
      `${left.day}${left.source}${left.model}`.localeCompare(
        `${right.day}${right.source}${right.model}`,
      ),
    );
}

it.layer(getTestDB())("the Cost screen's reads", (it) => {
  it.effect(
    "sum a turn's tokens by day, source, and each model it ran on, a coding agent's workers as its own",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount();
        const main = yield* openConversation(owner, CONVERSATION_KIND.MAIN);
        const lukeWorker = yield* openConversation(owner, CONVERSATION_KIND.CHILD, main);
        const agent = yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT);
        const agentWorker = yield* openConversation(owner, CONVERSATION_KIND.CHILD, agent);

        // Luke's own turn ran on two models, which its breakdown names apart.
        yield* settleTurn(owner, main, {
          model: MODEL.MINI,
          usage: {
            ...counts(150, 15),
            byModel: [
              { model: MODEL.OPUS, ...counts(100, 10) },
              { model: MODEL.MINI, ...counts(50, 5) },
            ],
          },
          settledAt: AT_TODAY,
        });
        yield* settleTurn(owner, lukeWorker, {
          model: MODEL.MINI,
          usage: counts(7, 1),
          settledAt: AT_TODAY,
        });
        // A row from before the breakdown ran every step on the model it names.
        yield* settleTurn(owner, agent, {
          model: MODEL.OPUS,
          usage: counts(200, 20),
          settledAt: AT_YESTERDAY,
          fastRefused: true,
        });
        yield* settleTurn(owner, agentWorker, {
          model: MODEL.OPUS,
          usage: counts(30, 3),
          settledAt: AT_TODAY,
        });
        // No usage recorded, and a turn settled before the read reaches back: neither is read.
        yield* settleTurn(owner, agent, { model: MODEL.OPUS, usage: null, settledAt: AT_TODAY });
        yield* settleTurn(owner, main, {
          model: MODEL.OPUS,
          usage: counts(9_999, 9_999),
          settledAt: AT_LONG_AGO,
        });

        const usage = yield* readAdminCostUsage({
          now: NOW,
          windowDays: WEEK,
          scope: ADMIN_METRICS_SCOPE.ALL,
          userId: owner,
        });

        assert.deepEqual(tokenRows(usage), [
          {
            day: YESTERDAY,
            source: COST_SOURCE.CODING_AGENTS,
            model: MODEL.OPUS,
            fastRefused: true,
            inputTokens: 200,
            outputTokens: 20,
          },
          {
            day: TODAY,
            source: COST_SOURCE.CODING_AGENTS,
            model: MODEL.OPUS,
            fastRefused: false,
            inputTokens: 30,
            outputTokens: 3,
          },
          {
            day: TODAY,
            source: COST_SOURCE.LUKE,
            model: MODEL.OPUS,
            fastRefused: false,
            inputTokens: 100,
            outputTokens: 10,
          },
          {
            day: TODAY,
            source: COST_SOURCE.LUKE,
            model: MODEL.MINI,
            fastRefused: false,
            inputTokens: 57,
            outputTokens: 6,
          },
        ]);
        assert.ok(usage.tokens.every((row) => row.userId === owner));
      }),
  );

  it.effect("sum each ledger's seconds and the merged pull requests by day and account", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const owner = yield* openAccount();

      const liveSessionId = randomUUID();
      yield* db.insert(voiceSessionUsage).values([
        { sessionId: liveSessionId, userId: owner, seconds: 45, recordedAt: AT_TODAY.getTime() },
        { sessionId: randomUUID(), userId: owner, seconds: 90, recordedAt: AT_TODAY.getTime() },
        { sessionId: randomUUID(), userId: owner, seconds: 30, recordedAt: AT_TODAY.getTime() },
        { sessionId: randomUUID(), userId: owner, seconds: 500, recordedAt: AT_LONG_AGO.getTime() },
      ]);
      yield* db.insert(hostedUsage).values([
        { userId: owner, day: YESTERDAY, calls: 3, dictationSeconds: 42 },
        { userId: owner, day: TODAY, calls: 3, dictationSeconds: 0 },
      ]);
      const [call] = yield* db
        .insert(voiceSessions)
        .values({
          userId: owner,
          liveSessionId,
          delegationMode: VOICE_DELEGATION_MODE.CLIENT,
          model: "gpt-live-test",
        })
        .returning({ id: voiceSessions.id });
      yield* db.insert(voiceAvatarSessions).values([
        {
          voiceSessionId: call?.id ?? "",
          userId: owner,
          personaId: "persona-test",
          startedAt: AT_TODAY,
          endedAt: AT_TODAY,
          seconds: 61,
        },
        // Still open: no seconds written yet, so nothing to price.
        {
          voiceSessionId: call?.id ?? "",
          userId: owner,
          personaId: "persona-test",
          startedAt: AT_TODAY,
        },
      ]);

      const workspace = yield* openWorkspace(owner);
      const agentConversation = yield* openConversation(owner, CONVERSATION_KIND.CODING_AGENT);
      const agentRow = {
        organizationId: workspace,
        userId: owner,
        conversationId: agentConversation,
        model: MODEL.OPUS,
        effort: "high",
        repository: "owner/name",
      };
      const pullRequest: CodingAgentPullRequest = {
        number: 1,
        title: "Synthetic",
        url: "https://github.test/pull/1",
        state: PULL_REQUEST_STATE.MERGED,
        checks: CHECK_SUMMARY.PASSING,
        additions: 1,
        deletions: 1,
        changedFiles: 1,
      };
      yield* db.insert(codingAgent).values([
        {
          ...agentRow,
          idempotencyKey: randomUUID(),
          published: { ...pullRequest, mergedAt: AT_YESTERDAY.getTime() },
        },
        {
          ...agentRow,
          idempotencyKey: randomUUID(),
          published: { ...pullRequest, mergedAt: AT_YESTERDAY.getTime() },
        },
        // Open, never merged.
        {
          ...agentRow,
          idempotencyKey: randomUUID(),
          published: { ...pullRequest, state: PULL_REQUEST_STATE.OPEN },
        },
      ]);

      const usage = yield* readAdminCostUsage({
        now: NOW,
        windowDays: WEEK,
        scope: ADMIN_METRICS_SCOPE.ALL,
        userId: owner,
      });

      const seconds = [...usage.seconds].sort((left, right) =>
        `${left.source}${left.model}`.localeCompare(`${right.source}${right.model}`),
      );
      // The session whose row names its Live model is told apart from those whose rows are gone.
      assert.deepEqual(seconds, [
        { day: TODAY, source: COST_SOURCE.AVATAR, userId: owner, model: null, seconds: 61 },
        { day: YESTERDAY, source: COST_SOURCE.DICTATION, userId: owner, model: null, seconds: 42 },
        {
          day: TODAY,
          source: COST_SOURCE.VOICE,
          userId: owner,
          model: "gpt-live-test",
          seconds: 45,
        },
        { day: TODAY, source: COST_SOURCE.VOICE, userId: owner, model: null, seconds: 120 },
      ]);
      assert.deepEqual(usage.merged, [{ day: YESTERDAY, userId: owner, merged: 2 }]);
    }),
  );

  it.effect("leave admins out by default, and read only the one account a read names", () =>
    Effect.gen(function* () {
      const admin = yield* openAccount(USER_ROLE.ADMIN);
      const member = yield* openAccount();
      const other = yield* openAccount();
      for (const id of [admin, member, other]) {
        const main = yield* openConversation(id, CONVERSATION_KIND.MAIN);
        yield* settleTurn(id, main, {
          model: MODEL.MINI,
          usage: counts(10, 1),
          settledAt: AT_TODAY,
        });
      }

      const accountsRead = (
        scope: (typeof ADMIN_METRICS_SCOPE)[keyof typeof ADMIN_METRICS_SCOPE],
      ) =>
        Effect.map(
          readAdminCostUsage({ now: NOW, windowDays: WEEK, scope }),
          (usage) => new Set(usage.tokens.map((row) => row.userId)),
        );
      const withoutAdmins = yield* accountsRead(ADMIN_METRICS_SCOPE.NON_ADMINS);
      const everyone = yield* accountsRead(ADMIN_METRICS_SCOPE.ALL);
      assert.ok(!withoutAdmins.has(admin));
      assert.ok(withoutAdmins.has(member) && withoutAdmins.has(other));
      assert.ok(everyone.has(admin));

      const one = yield* readAdminCostUsage({
        now: NOW,
        windowDays: WEEK,
        scope: ADMIN_METRICS_SCOPE.ALL,
        userId: member,
      });
      assert.deepEqual(
        one.tokens.map((row) => row.userId),
        [member],
      );
    }),
  );

  it.effect(
    "price the read at the catalog, naming the most expensive accounts and leaving an unlisted model unpriced",
    () =>
      Effect.gen(function* () {
        // A fresh window far from the other tests' instants, so only these rows fall in it.
        const now = Date.UTC(2027, 0, 10, 12);
        const at = new Date(Date.UTC(2027, 0, 10, 9));
        const spender = yield* openAccount();
        const main = yield* openConversation(spender, CONVERSATION_KIND.MAIN);
        yield* settleTurn(spender, main, {
          model: MODEL.OPUS,
          usage: counts(1_000_000, 0),
          settledAt: at,
        });
        yield* settleTurn(spender, main, {
          model: "openai/unlisted-test",
          usage: counts(500, 500),
          settledAt: at,
        });

        const cost = yield* readAdminCost({
          now,
          windowDays: WEEK,
          scope: ADMIN_METRICS_SCOPE.ALL,
        }).pipe(
          Effect.provide(
            modelCatalogOf([
              {
                id: MODEL.OPUS,
                name: "Opus",
                provider: "anthropic",
                efforts: ["high"],
                pricing: { inputUsd: 0.000_003, outputUsd: 0.000_015 },
              },
            ]),
          ),
        );

        assert.equal(cost.catalogAvailable, true);
        assert.equal(cost.totals.spendUsd, 3);
        assert.equal(cost.totals.unpricedTokens, 1_000);
        assert.deepEqual(
          cost.topAccounts.map((account) => [account.id, account.spendUsd, account.unpricedTokens]),
          [[spender, 3, 1_000]],
        );
        assert.equal(cost.topAccounts[0]?.email, `${spender}@luke.test`);
      }),
  );
});
