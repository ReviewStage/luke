import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { user } from "@luke/database/schemas/auth";
import { automation, automationRun } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { integrationConnection } from "@luke/database/schemas/integration";
import { conversations, turns } from "@luke/database/schemas/storage";
import { voiceSessions } from "@luke/database/schemas/voice";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openInstallationWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  type VoiceCloseReason,
} from "@luke/database/voice-vocabulary";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunReason,
  type AutomationRunStatus,
} from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE } from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { PROVIDER_KEY_PROVIDER, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import { TURN_ORIGIN } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { REPOSITORY_REFUSAL } from "../agents/repository-shell.js";
import { BRAIN_REQUEST_FAILURE, DAY_MS, TURN_STATUS, type TurnStatus } from "../core.js";
import { buildAdminReliability } from "./admin-reliability.js";
import { readAdminReliabilitySource } from "./admin-reliability-queries.js";
import { ADMIN_ATTENTION_KIND, ADMIN_METRICS_SCOPE, ADMIN_METRICS_WINDOW } from "./http.js";

/**
 * The Reliability read over a real dialect: ended work counted by kind
 * through the scope that hides the maintainers' own accounts, a coding
 * agent's failure classed by the coder host's reading of its turn, and the
 * accounts holding a broken key, integration, or GitHub installation listed
 * newest breakage first with their failed agents. Each suite stands on a
 * database of its own, since the read is the whole service's.
 *
 * Synthetic accounts throughout.
 */

/** Noon on the window's last day; the 7-day window opens at midnight on Oct 11. */
const NOW = Date.UTC(2026, 9, 17, 12);

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 9, day, hour));

const openAccount = (role: "user" | "admin" = "user") =>
  Effect.gen(function* () {
    const id = `user-${randomUUID()}`;
    yield* Database.use((db) =>
      db.insert(user).values({ id, name: `Account ${role}`, email: `${id}@luke.test`, role }),
    );
    return id;
  });

const openConversation = (
  userId: string,
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
  parentConversationId: string | null = null,
) =>
  Effect.map(
    Database.use((db) =>
      db
        .insert(conversations)
        .values({ userId, kind, parentConversationId })
        .returning({ id: conversations.id }),
    ),
    (rows) => rows[0]?.id ?? "",
  );

const endTurn = (
  userId: string,
  conversationId: string,
  status: TurnStatus,
  settledAt: Date | null,
  failure: { failure?: string; failureDetail?: string } = {},
) =>
  Database.use((db) =>
    db.insert(turns).values({
      userId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status,
      queuedAt: settledAt ?? at(17),
      settledAt,
      failure: failure.failure ?? null,
      failureDetail: failure.failureDetail ?? null,
    }),
  );

const openAgent = (userId: string, organizationId: string, createdAt: Date) =>
  Effect.gen(function* () {
    const conversationId = yield* openConversation(userId, CONVERSATION_KIND.CODING_AGENT);
    yield* Database.use((db) =>
      db.insert(codingAgent).values({
        organizationId,
        userId,
        conversationId,
        model: "anthropic/claude-test",
        effort: "high",
        repository: "acme/app",
        idempotencyKey: randomUUID(),
        createdAt,
      }),
    );
    return conversationId;
  });

const closeCall = (userId: string, closedAt: Date | null, closeReason: VoiceCloseReason | null) =>
  Database.use((db) =>
    db.insert(voiceSessions).values({
      userId,
      liveSessionId: randomUUID(),
      delegationMode: VOICE_DELEGATION_MODE.CLIENT,
      startedAt: at(10),
      closedAt,
      closeReason,
    }),
  );

const settleRun = (
  automationId: string,
  userId: string,
  status: AutomationRunStatus,
  reason: AutomationRunReason | null,
  settledAt: Date | null,
) =>
  Database.use((db) =>
    db.insert(automationRun).values({
      automationId,
      userId,
      dedupeKey: randomUUID(),
      firing: { kind: AUTOMATION_FIRING.MANUAL },
      status,
      reason,
      firedAt: at(12, 8),
      settledAt,
    }),
  );

const read = (scope: (typeof ADMIN_METRICS_SCOPE)[keyof typeof ADMIN_METRICS_SCOPE]) =>
  Effect.map(
    readAdminReliabilitySource({
      now: NOW,
      scope,
      windowDays: ADMIN_METRICS_WINDOW.WEEK,
      integrations: [],
    }),
    (source) => buildAdminReliability(source, NOW, ADMIN_METRICS_WINDOW.WEEK),
  );

it.layer(getTestDB())("the reliability read's failure counts", (it) => {
  it.effect(
    "counts ended work by kind inside the window, classes agent failures, and keeps admins out by default",
    () =>
      Effect.gen(function* () {
        const developer = yield* openAccount();
        const maintainer = yield* openAccount("admin");
        const workspace = yield* openWorkspace(developer);

        // Luke's own turns: two of six failed, one of them abandoned by the sweep.
        const main = yield* openConversation(developer, CONVERSATION_KIND.MAIN);
        for (const status of [TURN_STATUS.SETTLED, TURN_STATUS.SETTLED, TURN_STATUS.SETTLED]) {
          yield* endTurn(developer, main, status, at(16));
        }
        yield* endTurn(developer, main, TURN_STATUS.CANCELLED, at(16));
        yield* endTurn(developer, main, TURN_STATUS.FAILED, at(16), {
          failure: BRAIN_REQUEST_FAILURE.MODEL,
        });
        yield* endTurn(developer, main, TURN_STATUS.FAILED, at(17, 3), {
          failure: BRAIN_REQUEST_FAILURE.ABANDONED,
        });
        // Still running, and failed before the window opened: neither counts.
        yield* endTurn(developer, main, TURN_STATUS.RUNNING, null);
        yield* endTurn(developer, main, TURN_STATUS.FAILED, at(1), {
          failure: BRAIN_REQUEST_FAILURE.MODEL,
        });

        // A coding agent's runs: four of five failed, to the sandbox, the model, and two Starts that never ran.
        const agent = yield* openAgent(developer, workspace, at(14));
        yield* endTurn(developer, agent, TURN_STATUS.SETTLED, at(15));
        yield* endTurn(developer, agent, TURN_STATUS.FAILED, at(15), {
          failure: BRAIN_REQUEST_FAILURE.MODEL,
          failureDetail: `Sandbox: ${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE}`,
        });
        yield* endTurn(developer, agent, TURN_STATUS.FAILED, at(16), {
          failure: BRAIN_REQUEST_FAILURE.MODEL,
          failureDetail: "the provider answered 500",
        });
        yield* openAgent(developer, workspace, at(15));
        // Started two minutes before the window opened, its grace ran out inside it, so its failed Start counts there.
        yield* openAgent(developer, workspace, new Date(Date.UTC(2026, 9, 10, 23, 58)));
        // Started well before the window, its failed Start belongs to a window of its own.
        yield* openAgent(developer, workspace, at(9));
        // An agent started a minute ago is still inside its grace, so no run yet.
        yield* openAgent(developer, workspace, new Date(NOW - 60_000));
        // A subagent's turn runs inside its agent's, so it counts toward neither rate.
        const subagent = yield* openConversation(developer, CONVERSATION_KIND.CHILD, agent);
        yield* endTurn(developer, subagent, TURN_STATUS.FAILED, at(16), {
          failure: BRAIN_REQUEST_FAILURE.MODEL,
        });

        // Calls: one of three closed calls lost its connection; an open one has not ended.
        yield* closeCall(developer, at(13), VOICE_CLOSE_REASON.CLOSE_REQUESTED);
        yield* closeCall(developer, at(13), VOICE_CLOSE_REASON.REMOTE_HANGUP);
        yield* closeCall(developer, at(14), VOICE_CLOSE_REASON.CONNECTION_LOST);
        yield* closeCall(developer, null, null);

        // Automation runs: one of four settled failed and one was skipped; a queued one has not settled.
        const automationId = yield* Effect.map(
          Database.use((db) =>
            db
              .insert(automation)
              .values({
                userId: developer,
                organizationId: workspace,
                name: "Sweep",
                enabled: true,
                triggerKind: AUTOMATION_TRIGGER.WEBHOOK,
                trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
                action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Sweep the flakes" },
                guards: AUTOMATION_DEFAULT_GUARDS,
              })
              .returning({ id: automation.id }),
          ),
          (rows) => rows[0]?.id ?? "",
        );
        const { STARTED, SKIPPED, FAILED, QUEUED } = AUTOMATION_RUN_STATUS;
        yield* settleRun(automationId, developer, STARTED, null, at(12));
        yield* settleRun(automationId, developer, STARTED, null, at(12));
        yield* settleRun(
          automationId,
          developer,
          SKIPPED,
          AUTOMATION_RUN_REASON.CONCURRENCY,
          at(12),
        );
        yield* settleRun(
          automationId,
          developer,
          FAILED,
          AUTOMATION_RUN_REASON.UNAVAILABLE,
          at(13),
        );
        yield* settleRun(automationId, developer, QUEUED, null, null);

        // The maintainer's own failed turn, which only the explicit ask for every account counts.
        const maintainerMain = yield* openConversation(maintainer, CONVERSATION_KIND.MAIN);
        yield* endTurn(maintainer, maintainerMain, TURN_STATUS.FAILED, at(16), {
          failure: BRAIN_REQUEST_FAILURE.MODEL,
        });

        const answer = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS);
        assert.deepEqual(answer.headline, {
          lukeTurns: { failed: 2, total: 6 },
          agentRuns: { failed: 4, total: 5 },
          abandonedTurns: 1,
          calls: { failed: 1, total: 3 },
          automationRuns: { failed: 1, skipped: 1, total: 4 },
        });
        assert.deepEqual(
          [...answer.agentFailures].sort((left, right) =>
            left.failure.localeCompare(right.failure),
          ),
          [
            { failure: CODING_AGENT_FAILURE.MODEL, count: 1 },
            { failure: CODING_AGENT_FAILURE.NOT_STARTED, count: 2 },
            { failure: CODING_AGENT_FAILURE.SANDBOX, count: 1 },
          ],
        );
        assert.deepEqual(
          [...answer.automationReasons].sort((left, right) =>
            String(left.reason).localeCompare(String(right.reason)),
          ),
          [
            { reason: AUTOMATION_RUN_REASON.CONCURRENCY, skipped: 1, failed: 0 },
            { reason: AUTOMATION_RUN_REASON.UNAVAILABLE, skipped: 0, failed: 1 },
          ],
        );
        assert.equal(answer.daily.find((day) => day.day === "2026-10-14")?.calls, 1);
        assert.equal(answer.daily.find((day) => day.day === "2026-10-11")?.lukeTurns, null);
        assert.equal(answer.daily.find((day) => day.day === "2026-10-11")?.agentRuns, 1);
        assert.equal(answer.systemHealth.database.reachable, true);

        const everyone = yield* read(ADMIN_METRICS_SCOPE.ALL);
        assert.deepEqual(everyone.headline.lukeTurns, { failed: 3, total: 7 });
      }),
  );
});

it.layer(getTestDB())("the reliability read's accounts that need attention", (it) => {
  it.effect(
    "lists each account with a broken key, integration, or installation, newest first, by status alone",
    () =>
      Effect.gen(function* () {
        const keyHolder = yield* openAccount();
        const installer = yield* openAccount();
        const healthy = yield* openAccount();
        const maintainer = yield* openAccount("admin");

        const sealed = {
          keyVersion: 1,
          sealedDataKey: "sealed",
          sealedKey: "sealed",
          hint: "sk-…abcd",
        };
        yield* Database.use((db) =>
          db.insert(accountProviderKey).values([
            {
              userId: keyHolder,
              provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
              status: PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
              statusAt: at(10),
              createdAt: at(1),
              ...sealed,
            },
            {
              userId: keyHolder,
              provider: PROVIDER_KEY_PROVIDER.OPENAI,
              status: PROVIDER_KEY_STATUS.VERIFIED,
              statusAt: at(16),
              createdAt: at(1),
              ...sealed,
            },
            {
              userId: maintainer,
              provider: PROVIDER_KEY_PROVIDER.OPENAI,
              status: PROVIDER_KEY_STATUS.INVALID,
              statusAt: at(16),
              createdAt: at(1),
              ...sealed,
            },
          ]),
        );
        const connection = (userId: string, status: string, updatedAt: Date) => ({
          id: randomUUID(),
          userId,
          provider: INTEGRATION_PROVIDER.NOTION,
          connectSubject: randomUUID(),
          connectionName: INTEGRATION_PROVIDER.NOTION,
          label: "Acme notes",
          status,
          updatedAt,
        });
        yield* Database.use((db) =>
          db
            .insert(integrationConnection)
            .values([
              connection(keyHolder, INTEGRATION_ROW_STATUS.EXPIRED, at(12)),
              connection(healthy, INTEGRATION_ROW_STATUS.CONNECTED, at(12)),
            ]),
        );

        // The installer is a member of a workspace whose installation GitHub suspended.
        const owner = yield* openAccount();
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 41,
          accountId: 42,
          accountLogin: "acme",
        });
        yield* joinWorkspace(workspace, installer);
        yield* Database.use((db) =>
          db
            .update(githubInstallation)
            .set({ status: GITHUB_INSTALLATION_STATUS.SUSPENDED, updatedAt: at(14) })
            .where(eq(githubInstallation.installationId, 41)),
        );

        // The installer's agent failed two days ago; one that failed ten days ago is past the week.
        const recent = yield* openAgent(installer, workspace, at(14));
        yield* endTurn(installer, recent, TURN_STATUS.FAILED, new Date(NOW - 2 * DAY_MS));
        const older = yield* openAgent(installer, workspace, at(1));
        yield* endTurn(installer, older, TURN_STATUS.FAILED, new Date(NOW - 10 * DAY_MS));

        const answer = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS);
        const listed = answer.attention.accounts.map((row) => ({
          id: row.id,
          problems: row.problems.map((problem) => ({ ...problem })),
          failedAgents: row.failedAgents,
        }));
        assert.equal(answer.attention.total, 3);
        assert.deepEqual(
          listed.find((row) => row.id === keyHolder),
          {
            id: keyHolder,
            problems: [
              {
                kind: ADMIN_ATTENTION_KIND.INTEGRATION,
                provider: INTEGRATION_PROVIDER.NOTION,
                status: INTEGRATION_ROW_STATUS.EXPIRED,
                since: at(12).getTime(),
              },
              {
                kind: ADMIN_ATTENTION_KIND.PROVIDER_KEY,
                provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
                status: PROVIDER_KEY_STATUS.QUOTA_EXCEEDED,
                since: at(10).getTime(),
              },
            ],
            failedAgents: 0,
          },
        );
        assert.deepEqual(
          listed.find((row) => row.id === installer),
          {
            id: installer,
            problems: [
              {
                kind: ADMIN_ATTENTION_KIND.GITHUB_INSTALLATION,
                status: GITHUB_INSTALLATION_STATUS.SUSPENDED,
                since: at(14).getTime(),
              },
            ],
            failedAgents: 1,
          },
        );
        // Newest breakage first: the installation's members, then the key holder.
        assert.equal(listed.at(-1)?.id, keyHolder);
        assert.ok(!listed.some((row) => row.id === healthy || row.id === maintainer));

        const everyone = yield* read(ADMIN_METRICS_SCOPE.ALL);
        assert.equal(everyone.attention.accounts[0]?.id, maintainer);
      }),
  );
});
