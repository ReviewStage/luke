import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { session, user } from "@luke/database/schemas/auth";
import { automation, automationRun } from "@luke/database/schemas/automation";
import { codingAgent, type StoredPullRequest } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { integrationConnection } from "@luke/database/schemas/integration";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import { accountPreference } from "@luke/database/schemas/preferences";
import { conversations, turns } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { voiceSessionUsage } from "@luke/database/schemas/usage";
import { voiceSessions } from "@luke/database/schemas/voice";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@luke/database/testing";
import { VOICE_CLOSE_REASON } from "@luke/database/voice-vocabulary";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CONTEXT_WINDOW,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  FAST_ACCESS,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { EXPERIMENT } from "@luke/settings";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { Effect } from "effect";
import { BRAIN_REQUEST_FAILURE, DAY_MS } from "../core.js";
import { buildAdminAccountSupport } from "./admin-account.js";
import { readAdminAccountSource } from "./admin-account-queries.js";
import {
  ADMIN_FAILURE_KIND,
  ADMIN_PULL_REQUEST,
  ADMIN_WORKSPACE_KIND,
} from "./admin-account-wire.js";
import { ADMIN_METRICS_WINDOW } from "./http.js";

/**
 * admin-account.test.ts -- one account's support sections, read over a real
 * dialect and folded: the window's tasks, agents, pull requests, and call
 * minutes; its newest agents with the status and failure class the panel
 * would draw and their pull request's state; its workspaces by name, role,
 * size, and GitHub installation; its keys and connections; its defaults and
 * experiments; and the window's failures, newest first, each an enumerated
 * word. A second account's rows stand beside every one of the first's and
 * are never read into it.
 *
 * Synthetic accounts throughout, at a fixed instant handed to the read.
 */

const NOW = Date.UTC(2026, 9, 21, 12);
const WINDOW_START = Date.UTC(2026, 8, 22);

const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS);

const pullRequest = (state: PullRequestState): StoredPullRequest => ({
  number: 7,
  title: "A title the page never reads",
  url: "https://github.com/acme/relay/pull/7",
  state,
  checks: CHECK_SUMMARY.PASSING,
  additions: 1,
  deletions: 1,
  changedFiles: 1,
});

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const id = `user-${randomUUID()}`;
    yield* Database.use((db) =>
      db.insert(user).values({ id, name, email: `${id}@luke.test`, createdAt: at(200) }),
    );
    return id;
  });

/** An agent of the account's, started `daysAgo`, its one turn ended as `turn` where it ran one. */
const startAgent = (
  userId: string,
  organizationId: string,
  daysAgo: number,
  options: {
    turn?: { status: TurnStatus; failure?: string; failureDetail?: string };
    published?: PullRequestState;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [conversation] = yield* db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT, createdAt: at(daysAgo) })
      .returning({ id: conversations.id });
    const conversationId = conversation?.id ?? "";
    const [agent] = yield* db
      .insert(codingAgent)
      .values({
        userId,
        organizationId,
        conversationId,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        contextWindow: CONTEXT_WINDOW.STANDARD,
        repository: "acme/relay",
        prompt: "A prompt the page never reads",
        title: "A title the page never reads",
        published: options.published === undefined ? null : pullRequest(options.published),
        idempotencyKey: randomUUID(),
        createdAt: at(daysAgo),
      })
      .returning({ id: codingAgent.id });
    if (options.turn !== undefined) {
      yield* db.insert(turns).values({
        userId,
        conversationId,
        origin: TURN_ORIGIN.TYPED,
        status: options.turn.status,
        failure: options.turn.failure ?? null,
        failureDetail: options.turn.failureDetail ?? null,
        queuedAt: at(daysAgo),
        startedAt: at(daysAgo),
        settledAt: at(daysAgo - 0.5),
      });
    }
    return agent?.id ?? "";
  });

/** Every kind of row the page reads, written for `userId` in its own workspace. */
const seedAccount = (userId: string, sharedWorkspace: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const own = yield* openWorkspace(userId);
    yield* db.insert(personalWorkspace).values({ userId, organizationId: own, createdAt: at(200) });
    yield* db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId,
      expiresAt: at(-30),
      createdAt: at(10),
      updatedAt: at(0.25),
    });
    yield* db.insert(task).values([
      {
        userId,
        organizationId: own,
        name: "A task the page never names",
        document: "",
        createdAt: at(1),
      },
      { userId, organizationId: own, name: "Older", document: "", createdAt: at(45) },
    ]);
    const merged = yield* startAgent(userId, own, 1, {
      turn: { status: TURN_STATUS.SETTLED },
      published: PULL_REQUEST_STATE.MERGED,
    });
    const overflowed = yield* startAgent(userId, sharedWorkspace, 2, {
      turn: {
        status: TURN_STATUS.FAILED,
        failure: BRAIN_REQUEST_FAILURE.MODEL,
        failureDetail: "prompt is too long: 1368155 tokens > 1000000 maximum",
      },
      published: PULL_REQUEST_STATE.DRAFT,
    });
    const neverStarted = yield* startAgent(userId, own, 3, {});
    const older = yield* startAgent(userId, own, 40, {
      turn: { status: TURN_STATUS.SETTLED },
      published: PULL_REQUEST_STATE.CLOSED,
    });
    yield* db.insert(voiceSessionUsage).values([
      { sessionId: randomUUID(), userId, seconds: 600, recordedAt: at(2).getTime() },
      { sessionId: randomUUID(), userId, seconds: 1230, recordedAt: at(5).getTime() },
      { sessionId: randomUUID(), userId, seconds: 6000, recordedAt: at(60).getTime() },
    ]);
    const call = (
      closeReason: (typeof VOICE_CLOSE_REASON)[keyof typeof VOICE_CLOSE_REASON],
      daysAgo: number,
    ) => ({
      userId,
      liveSessionId: randomUUID(),
      delegationMode: "client" as const,
      startedAt: at(daysAgo + 0.01),
      closedAt: at(daysAgo),
      closeReason,
    });
    yield* db
      .insert(voiceSessions)
      .values([
        call(VOICE_CLOSE_REASON.CONNECTION_LOST, 3),
        call(VOICE_CLOSE_REASON.CLOSE_REQUESTED, 4),
        call(VOICE_CLOSE_REASON.CONNECTION_LOST, 50),
      ]);
    const key = (
      provider: (typeof PROVIDER_KEY_PROVIDER)[keyof typeof PROVIDER_KEY_PROVIDER],
      status: (typeof PROVIDER_KEY_STATUS)[keyof typeof PROVIDER_KEY_STATUS],
      daysAgo: number,
    ) => ({
      userId,
      provider,
      keyVersion: 1,
      sealedDataKey: "sealed",
      sealedKey: "sealed",
      hint: "sk-…abcd",
      status,
      statusAt: at(daysAgo),
      fastAccess: provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? FAST_ACCESS.ENABLED : null,
      createdAt: at(100),
    });
    yield* db
      .insert(accountProviderKey)
      .values([
        key(PROVIDER_KEY_PROVIDER.ANTHROPIC, PROVIDER_KEY_STATUS.INVALID, 5),
        key(PROVIDER_KEY_PROVIDER.OPENAI, PROVIDER_KEY_STATUS.VERIFIED, 1),
      ]);
    const connection = (
      provider: (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER],
      status: string,
      daysAgo: number,
    ) => ({
      id: randomUUID(),
      userId,
      provider,
      connectSubject: `${userId}-${provider}`,
      connectionName: provider,
      label: "A label the page never reads",
      status,
      updatedAt: at(daysAgo),
    });
    yield* db
      .insert(integrationConnection)
      .values([
        connection(INTEGRATION_PROVIDER.NOTION, INTEGRATION_ROW_STATUS.EXPIRED, 4),
        connection(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_ROW_STATUS.CONNECTED, 9),
      ]);
    yield* db.insert(accountPreference).values({
      userId,
      codingAgentModel: "anthropic/claude-opus-5.5",
      codingAgentEffort: "high",
      experiments: { [EXPERIMENT.CHAT]: true, [EXPERIMENT.BROWSER]: false },
    });
    const [made] = yield* db
      .insert(automation)
      .values({
        userId,
        organizationId: own,
        name: "A name the page never reads",
        enabled: true,
        triggerKind: AUTOMATION_TRIGGER.SCHEDULE,
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "A prompt the page never reads" },
        guards: AUTOMATION_DEFAULT_GUARDS,
      })
      .returning({ id: automation.id });
    yield* db.insert(automationRun).values({
      automationId: made?.id ?? "",
      userId,
      dedupeKey: randomUUID(),
      firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: at(6).getTime() },
      status: AUTOMATION_RUN_STATUS.FAILED,
      reason: AUTOMATION_RUN_REASON.MODEL,
      firedAt: at(6),
      settledAt: at(6),
    });
    return { own, merged, overflowed, neverStarted, older };
  });

const read = (userId: string) =>
  Effect.map(
    readAdminAccountSource({ userId, now: NOW, windowDays: ADMIN_METRICS_WINDOW.MONTH }),
    (source) => buildAdminAccountSupport(source, NOW, WINDOW_START, null),
  );

it.layer(getTestDB())("one account's support sections", (it) => {
  it.effect("count the window's work and read each agent as the panel would", () =>
    Effect.gen(function* () {
      const lin = yield* openAccount("Lin Chen");
      const shared = yield* openWorkspace(lin);
      const ada = yield* openAccount("Ada Lovelace");
      yield* joinWorkspace(shared, ada, WORKSPACE_ROLE.MEMBER);
      yield* Database.use((db) =>
        db.insert(githubInstallation).values({
          installationId: 41,
          organizationId: shared,
          accountId: 42,
          accountLogin: "acme",
          accountType: "Organization",
          status: GITHUB_INSTALLATION_STATUS.SUSPENDED,
          createdAt: at(30),
          updatedAt: at(30),
        }),
      );
      const agents = yield* seedAccount(ada, shared);
      // Lin's own rows stand beside Ada's everywhere, and none is read into hers.
      yield* seedAccount(lin, shared);

      const support = yield* read(ada);

      assert.equal(support.lastSeenAt, at(0.25).getTime());
      assert.deepEqual(support.totals, {
        tasksCreated: 1,
        agentsStarted: 3,
        agentsFailed: 2,
        agentsRead: 3,
        pullRequestsOpened: 2,
        pullRequestsMerged: 1,
        callMinutes: 31,
      });
      assert.deepEqual(
        support.recentAgents.map((agent) => [
          agent.id,
          agent.status,
          agent.failure,
          agent.pullRequest,
        ]),
        [
          [agents.merged, CODING_AGENT_STATUS.COMPLETED, null, ADMIN_PULL_REQUEST.MERGED],
          [
            agents.overflowed,
            CODING_AGENT_STATUS.FAILED,
            CODING_AGENT_FAILURE.CONTEXT_OVERFLOW,
            ADMIN_PULL_REQUEST.OPEN,
          ],
          [
            agents.neverStarted,
            CODING_AGENT_STATUS.FAILED,
            CODING_AGENT_FAILURE.NOT_STARTED,
            ADMIN_PULL_REQUEST.NONE,
          ],
          [agents.older, CODING_AGENT_STATUS.COMPLETED, null, ADMIN_PULL_REQUEST.CLOSED],
        ],
      );
      assert.deepEqual(
        { ...support.recentAgents[0], id: undefined, createdAt: undefined },
        {
          id: undefined,
          createdAt: undefined,
          repository: "acme/relay",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          contextWindow: CONTEXT_WINDOW.STANDARD,
          status: CODING_AGENT_STATUS.COMPLETED,
          failure: null,
          pullRequest: ADMIN_PULL_REQUEST.MERGED,
        },
      );
    }),
  );

  it.effect("name the account's workspaces, keys, connections, and defaults", () =>
    Effect.gen(function* () {
      const lin = yield* openAccount("Lin Chen");
      const shared = yield* openWorkspace(lin);
      const ada = yield* openAccount("Ada Lovelace");
      yield* joinWorkspace(shared, ada, WORKSPACE_ROLE.MEMBER);
      yield* Database.use((db) =>
        db.insert(githubInstallation).values({
          installationId: 51,
          organizationId: shared,
          accountId: 52,
          accountLogin: "acme",
          accountType: "Organization",
          status: GITHUB_INSTALLATION_STATUS.SUSPENDED,
          createdAt: at(30),
          updatedAt: at(30),
        }),
      );
      const { own } = yield* seedAccount(ada, shared);
      yield* seedAccount(lin, shared);

      const support = yield* read(ada);

      assert.deepEqual(
        [...support.workspaces].sort((left, right) => left.kind.localeCompare(right.kind)),
        [
          {
            id: own,
            name: "Test Workspace",
            kind: ADMIN_WORKSPACE_KIND.PERSONAL,
            role: WORKSPACE_ROLE.OWNER,
            memberCount: 1,
            github: [],
          },
          {
            id: shared,
            name: "Test Workspace",
            kind: ADMIN_WORKSPACE_KIND.SHARED,
            role: WORKSPACE_ROLE.MEMBER,
            memberCount: 2,
            github: [GITHUB_INSTALLATION_STATUS.SUSPENDED],
          },
        ],
      );
      assert.deepEqual(support.providerKeys, [
        {
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          status: PROVIDER_KEY_STATUS.INVALID,
          statusAt: at(5).getTime(),
          fastAccess: FAST_ACCESS.ENABLED,
        },
        {
          provider: PROVIDER_KEY_PROVIDER.OPENAI,
          status: PROVIDER_KEY_STATUS.VERIFIED,
          statusAt: at(1).getTime(),
          fastAccess: null,
        },
      ]);
      assert.deepEqual(support.connections, [
        {
          provider: INTEGRATION_PROVIDER.LINEAR,
          status: INTEGRATION_ROW_STATUS.CONNECTED,
          at: at(9).getTime(),
        },
        {
          provider: INTEGRATION_PROVIDER.NOTION,
          status: INTEGRATION_ROW_STATUS.EXPIRED,
          at: at(4).getTime(),
        },
      ]);
      assert.deepEqual(support.defaults, {
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        contextWindow: null,
        experiments: [{ key: EXPERIMENT.CHAT, name: "Chat" }],
      });
    }),
  );

  it.effect("list the window's failures newest first, each by its enumerated word", () =>
    Effect.gen(function* () {
      const lin = yield* openAccount("Lin Chen");
      const shared = yield* openWorkspace(lin);
      const ada = yield* openAccount("Ada Lovelace");
      yield* seedAccount(ada, shared);
      yield* seedAccount(lin, shared);

      const support = yield* read(ada);

      assert.deepEqual(
        support.failures.map((failure) => ({ ...failure, at: (NOW - failure.at) / DAY_MS })),
        [
          {
            kind: ADMIN_FAILURE_KIND.AGENT,
            at: 1.5,
            reason: CODING_AGENT_FAILURE.CONTEXT_OVERFLOW,
          },
          { kind: ADMIN_FAILURE_KIND.AGENT, at: 3, reason: CODING_AGENT_FAILURE.NOT_STARTED },
          { kind: ADMIN_FAILURE_KIND.CALL, at: 3, reason: VOICE_CLOSE_REASON.CONNECTION_LOST },
          {
            kind: ADMIN_FAILURE_KIND.CONNECTION,
            at: 4,
            provider: INTEGRATION_PROVIDER.NOTION,
            reason: INTEGRATION_ROW_STATUS.EXPIRED,
          },
          {
            kind: ADMIN_FAILURE_KIND.KEY,
            at: 5,
            provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
            reason: PROVIDER_KEY_STATUS.INVALID,
          },
          { kind: ADMIN_FAILURE_KIND.AUTOMATION, at: 6, reason: AUTOMATION_RUN_REASON.MODEL },
        ],
      );
    }),
  );

  it.effect("read an account with no rows as empty", () =>
    Effect.gen(function* () {
      const ada = yield* openAccount("Ada Lovelace");

      const support = yield* read(ada);

      assert.deepEqual(support, {
        lastSeenAt: null,
        totals: {
          tasksCreated: 0,
          agentsStarted: 0,
          agentsFailed: 0,
          agentsRead: 0,
          pullRequestsOpened: 0,
          pullRequestsMerged: 0,
          callMinutes: 0,
        },
        recentAgents: [],
        workspaces: [],
        providerKeys: [],
        connections: [],
        defaults: { model: null, effort: null, contextWindow: null, experiments: [] },
        failures: [],
      });
    }),
  );
});
