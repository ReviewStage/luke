import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
} from "@luke/features/brain";
import { PROVIDER_KEY_PROVIDER, PROVIDER_KEY_STATUS } from "@luke/features/provider-key-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { DRIZZLE_MIGRATIONS, EFFECT_MIGRATIONS_TABLE } from "../../core/migrator.js";
import { Database } from "../../core/query.js";
import { accountProviderKey } from "../../schemas/account-provider-key.js";
import {
  account,
  member,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  session,
  user,
  verification,
} from "../../schemas/auth.js";
import { automation, automationRun } from "../../schemas/automation.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { macCommand, macCommandListener } from "../../schemas/mac-command.js";
import { personalWorkspace } from "../../schemas/personal-workspace.js";
import { sandboxTerminalLease } from "../../schemas/sandbox-terminal-lease.js";
import { sessionSandboxCleanup } from "../../schemas/session-sandbox.js";
import { conversations } from "../../schemas/storage.js";
import { voiceAvatarSessions, voiceSessions } from "../../schemas/voice.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { VOICE_DELEGATION_MODE } from "../../voice-vocabulary.js";
import { createAutomation, recordAutomationRun } from "../automation-store.js";
import { latestTurnsOfReached } from "../coding-agent-store.js";
import { PREVIEW_FORK_OUTCOME, preparePreviewFork } from "../preview-fork.js";
import { createTask } from "../task-store.js";
import { type ConversationTarget, type StoreWriter, storeWriter } from "../writer.js";

/**
 * A Preview's copy of production's database made the Preview's own, over a
 * real dialect: the team's workspaces and accounts kept and every other one
 * removed with its rows, the copy's credentials removed, what was in flight
 * settled and switched off, and all of it once per branch.
 *
 * Each case runs on a database of its own, since a run removes every account
 * outside the workspaces it keeps. Synthetic accounts, workspaces, and runs
 * throughout.
 */

const TEAM_SLUG = "team";

const NOW = 1_800_000_000_000;

/** Production's Neon endpoint, as the deployment names it. */
const PRODUCTION_ENDPOINT = "ep-production-123456";

/** A run keeping the workspaces under these slugs, at the instant given. */
const prepare = (writer: StoreWriter, slugs: readonly string[], now = NOW) =>
  preparePreviewFork(
    { writer },
    { keepWorkspaceSlugs: slugs, productionEndpoint: PRODUCTION_ENDPOINT, now },
  );

/** A new account with its own first workspace, as every account is made; answers both ids. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  const workspaceId = randomUUID();
  const at = new Date(NOW);
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  yield* db
    .insert(organization)
    .values({ id: workspaceId, name: "Test User", slug: `personal-${userId}`, createdAt: at });
  yield* db.insert(member).values({
    id: randomUUID(),
    organizationId: workspaceId,
    userId,
    role: "owner",
    createdAt: at,
  });
  yield* db
    .insert(personalWorkspace)
    .values({ userId, organizationId: workspaceId, createdAt: at });
  return { userId, workspaceId };
});

/** A workspace under the slug, its members the accounts given, the first its owner; answers its id. */
const openWorkspace = (slug: string, ...members: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const at = new Date(NOW);
    yield* db.insert(organization).values({ id, name: "Test Workspace", slug, createdAt: at });
    for (const [index, userId] of members.entries()) {
      yield* db.insert(member).values({
        id: randomUUID(),
        organizationId: id,
        userId,
        role: index === 0 ? "owner" : "member",
        createdAt: at,
      });
    }
    return id;
  });

/** A coding agent of the account's in the workspace, its one turn running as eve began it; answers its id and conversation. */
const openRunningAgent = (writer: StoreWriter, userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    const [agent] = yield* db
      .insert(codingAgent)
      .values({
        organizationId,
        userId,
        conversationId,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: "acme/api",
        idempotencyKey: randomUUID(),
      })
      .returning({ id: codingAgent.id });
    const target: ConversationTarget = { userId, conversationId };
    yield* runningTurnIn(writer, target);
    return { agentId: agent?.id ?? "", target };
  });

/** A turn of the conversation's, begun by eve and still running. */
const runningTurnIn = (writer: StoreWriter, target: ConversationTarget) =>
  Effect.gen(function* () {
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      conversationId: sessionKey(target.conversationId),
      turnId,
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: BRAIN_TURN_ORIGIN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      at: NOW,
    });
  });

/**
 * What production holds for an account mid-flight: a signed-in session, the
 * desktop's OAuth tokens and the consent they were granted under, a
 * provider's tokens and a key of its own, a sign-in under way, a command
 * queued for its Mac and the Mac listening, an open call with its avatar,
 * the agent's sandbox held for a terminal and another session's queued for
 * deletion.
 */
const leaveInFlight = (target: ConversationTarget) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const at = new Date(NOW);
    const { userId } = target;
    yield* db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      expiresAt: new Date(NOW + 86_400_000),
      updatedAt: at,
      userId,
    });
    const clientId = `client-${randomUUID()}`;
    yield* db
      .insert(oauthClient)
      .values({ id: randomUUID(), clientId, redirectUris: ["http://127.0.0.1/callback"] });
    yield* db
      .insert(oauthConsent)
      .values({ id: randomUUID(), clientId, userId, scopes: ["openid"] });
    // Note that the access token stands alone, since one minted under a refresh token goes with it.
    yield* db
      .insert(oauthRefreshToken)
      .values({ id: randomUUID(), token: randomUUID(), clientId, userId, scopes: ["openid"] });
    yield* db.insert(oauthAccessToken).values({
      id: randomUUID(),
      token: randomUUID(),
      clientId,
      userId,
      scopes: ["openid"],
    });
    yield* db.insert(account).values({
      id: randomUUID(),
      accountId: "1234",
      providerId: "github",
      userId,
      accessToken: "sealed-access",
      refreshToken: "sealed-refresh",
      password: "scrypt-hash",
      updatedAt: at,
    });
    yield* db.insert(accountProviderKey).values({
      userId,
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      keyVersion: 1,
      sealedDataKey: "sealed",
      sealedKey: "sealed",
      hint: "sk-…abcd",
      status: PROVIDER_KEY_STATUS.VERIFIED,
      statusAt: at,
      createdAt: at,
    });
    yield* db
      .insert(verification)
      .values({ id: randomUUID(), identifier: "state", value: "{}", expiresAt: at });
    yield* db.insert(macCommand).values({
      id: randomUUID(),
      userId,
      command: "git status",
      timeoutSeconds: 60,
      queuedAt: at,
    });
    yield* db.insert(macCommandListener).values({ userId, seenAt: at });
    const [call] = yield* db
      .insert(voiceSessions)
      .values({
        userId,
        liveSessionId: randomUUID(),
        delegationMode: VOICE_DELEGATION_MODE.CLIENT,
      })
      .returning({ id: voiceSessions.id });
    yield* db.insert(voiceAvatarSessions).values({
      voiceSessionId: call?.id ?? "",
      userId,
      personaId: "persona",
      startedAt: at,
    });
    yield* db
      .insert(sandboxTerminalLease)
      .values({ conversationId: target.conversationId, heldUntil: new Date(NOW + 60_000) });
    yield* db.insert(sessionSandboxCleanup).values({ sessionId: `session-${randomUUID()}` });
  });

/** A scheduled automation of the account's on a task in the workspace, due, with a firing queued. */
const openDueAutomation = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const made = yield* createTask(userId, {
      organizationId,
      name: "Nightly",
      repository: "acme/api",
    });
    const scheduled = Option.getOrThrow(
      yield* createAutomation(userId, {
        taskId: made.id,
        name: "Nightly flaky-test sweep",
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix one flaky test." },
        guards: AUTOMATION_DEFAULT_GUARDS,
        nextRunAt: new Date(NOW),
        webhookSecretHash: null,
      }),
    );
    yield* recordAutomationRun(scheduled, {
      dedupeKey: randomUUID(),
      firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: NOW },
      firedAt: new Date(NOW),
    });
    return scheduled.id;
  });

/** How many rows the table holds. */
const countOf = (table: PgTable) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db.select({ count: sql<number>`count(*)::int` }).from(table);
    return Number(row?.count ?? 0);
  });

/** The ids the table holds, sorted. */
const idsOf = Effect.gen(function* () {
  const db = yield* Database;
  const users = yield* db.select({ id: user.id }).from(user);
  const workspaces = yield* db.select({ id: organization.id }).from(organization);
  return {
    users: users.map(({ id }) => id).sort(),
    workspaces: workspaces.map(({ id }) => id).sort(),
  };
});

/** The conversation's newest turn as the agents' reads see it: its status and failure word. */
const newestTurnOf = (target: ConversationTarget) =>
  Effect.map(latestTurnsOfReached([target.conversationId]), (latest) => {
    const turn = latest.get(target.conversationId);
    return [turn?.status, turn?.failure];
  });

it.layer(getTestDB())("a Preview's copy made its own", (it) => {
  it.effect(
    "keeps the named workspaces and their members, removes every other account and the copy's credentials, settles what was in flight, and does it once",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const writer = yield* storeWriter({ tools: {} });
        const lead = yield* openAccount;
        const teammate = yield* openAccount;
        const customer = yield* openAccount;
        const team = yield* openWorkspace(TEAM_SLUG, lead.userId, teammate.userId);
        const customers = yield* openWorkspace("acme", customer.userId, lead.userId);

        const leads = yield* openRunningAgent(writer, lead.userId, team);
        yield* openRunningAgent(writer, customer.userId, customers);
        yield* leaveInFlight(leads.target);
        const nightly = yield* openDueAutomation(lead.userId, team);
        const cleared = yield* openRunningAgent(writer, lead.userId, team);
        yield* db
          .update(conversations)
          .set({ deletedAt: new Date(NOW) })
          .where(eq(conversations.id, cleared.target.conversationId));

        const outcome = yield* prepare(writer, [TEAM_SLUG], NOW + 1_000);

        assert.deepEqual(outcome, {
          kind: PREVIEW_FORK_OUTCOME.PREPARED,
          keptWorkspaces: 3,
          keptAccounts: 2,
          removedWorkspaces: 2,
          removedAccounts: 1,
          settledTurns: 1,
          archivedAgents: 1,
        });
        assert.deepEqual(yield* idsOf, {
          users: [lead.userId, teammate.userId].sort(),
          workspaces: [team, lead.workspaceId, teammate.workspaceId].sort(),
        });

        assert.deepEqual(yield* newestTurnOf(leads.target), [
          TURN_STATUS.FAILED,
          BRAIN_REQUEST_FAILURE.SESSION_ENDED,
        ]);
        const [agent] = yield* db
          .select({ archivedAt: codingAgent.archivedAt })
          .from(codingAgent)
          .where(eq(codingAgent.id, leads.agentId));
        assert.notEqual(agent?.archivedAt ?? null, null, "the copied agent is archived");

        for (const [name, table] of [
          ["sessions", session],
          ["OAuth access tokens", oauthAccessToken],
          ["OAuth refresh tokens", oauthRefreshToken],
          ["OAuth consents", oauthConsent],
          ["verifications", verification],
          ["provider keys", accountProviderKey],
          ["Mac commands", macCommand],
          ["Mac listeners", macCommandListener],
          ["terminal leases", sandboxTerminalLease],
          ["sandbox deletions", sessionSandboxCleanup],
        ] as const) {
          assert.equal(yield* countOf(table), 0, `no ${name} stand`);
        }
        const linked = yield* db
          .select({
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
            password: account.password,
          })
          .from(account)
          .where(eq(account.userId, lead.userId));
        assert.deepEqual(linked, [{ accessToken: null, refreshToken: null, password: null }]);
        const standing = yield* db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, cleared.target.conversationId));
        assert.deepEqual(standing, [], "a cleared conversation, its running turn with it, is gone");

        const [call] = yield* db.select({ closedAt: voiceSessions.closedAt }).from(voiceSessions);
        assert.notEqual(call?.closedAt ?? null, null, "the open call is closed");
        const [avatar] = yield* db
          .select({ endedAt: voiceAvatarSessions.endedAt })
          .from(voiceAvatarSessions);
        assert.notEqual(avatar?.endedAt ?? null, null, "its avatar is ended");

        const [paused] = yield* db
          .select({ enabled: automation.enabled, nextRunAt: automation.nextRunAt })
          .from(automation)
          .where(eq(automation.id, nightly));
        assert.deepEqual(paused, { enabled: false, nextRunAt: null });
        const runs = yield* db
          .select({ status: automationRun.status, reason: automationRun.reason })
          .from(automationRun)
          .where(eq(automationRun.automationId, nightly));
        assert.deepEqual(runs, [
          { status: AUTOMATION_RUN_STATUS.SKIPPED, reason: AUTOMATION_RUN_REASON.PAUSED },
        ]);

        // A turn begun on the Preview after it was made its own, and a newcomer: a later build leaves both.
        const onPreview = yield* openRunningAgent(writer, teammate.userId, team);
        const newcomer = yield* openAccount;
        assert.deepEqual(yield* prepare(writer, [TEAM_SLUG], NOW + 2_000), {
          kind: PREVIEW_FORK_OUTCOME.ALREADY_PREPARED,
        });
        assert.deepEqual(yield* newestTurnOf(onPreview.target), [TURN_STATUS.RUNNING, null]);
        assert.ok((yield* idsOf).users.includes(newcomer.userId));
      }),
  );
});

it.layer(getTestDB())("a Preview whose named workspaces keep no member", (it) => {
  it.effect("changes nothing until a run names a workspace with a member", () =>
    Effect.gen(function* () {
      const writer = yield* storeWriter({ tools: {} });
      const customer = yield* openAccount;
      yield* openWorkspace("empty");
      const before = yield* idsOf;

      for (const slugs of [["missing"], ["empty"]]) {
        assert.deepEqual(yield* prepare(writer, slugs), {
          kind: PREVIEW_FORK_OUTCOME.NO_WORKSPACE,
        });
        assert.deepEqual(yield* idsOf, before);
      }

      const team = yield* openWorkspace(TEAM_SLUG, customer.userId);
      const prepared = yield* prepare(writer, [TEAM_SLUG]);
      assert.equal(prepared.kind, PREVIEW_FORK_OUTCOME.PREPARED);
      assert.deepEqual((yield* idsOf).workspaces, [team, customer.workspaceId].sort());
    }),
  );
});

it.layer(getTestDB())("a run connected to production's database", (it) => {
  it.effect("touches nothing when the server says it is production's endpoint", () =>
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient;
      const writer = yield* storeWriter({ tools: {} });
      const customer = yield* openAccount;
      yield* openWorkspace(TEAM_SLUG, (yield* openAccount).userId);
      const before = yield* idsOf;

      // Note that the setting is the transaction's own, as Neon's is the compute's, so the run reads it on the connection it holds.
      const outcome = yield* client.withTransaction(
        Effect.gen(function* () {
          yield* client`select set_config('neon.endpoint_id', ${PRODUCTION_ENDPOINT}, true)`;
          return yield* prepare(writer, [TEAM_SLUG]);
        }),
      );

      assert.deepEqual(outcome, { kind: PREVIEW_FORK_OUTCOME.PRODUCTION });
      assert.deepEqual(yield* idsOf, before);
      assert.ok(before.users.includes(customer.userId));
    }),
  );
});

/**
 * The tables a Preview's run leaves outside the accounts and workspaces it
 * removes, each with why that is safe: emptied by the run itself, dropped by
 * the build's seed where this deployment cannot open it, or holding no
 * account's data.
 */
const OUTSIDE_ANY_ACCOUNT = {
  jwks: "the build's seed drops every key this deployment cannot open",
  oauth_client_assertion: "assertion ids and their expiry, no account's",
  oauth_resource: "the OAuth resources the service declares",
  preview_fork: "the row the run writes",
  session_sandbox_cleanup: "emptied by the run",
  verification: "emptied by the run",
} as const;

it.layer(getTestDB())("every table a Preview's run reaches", (it) => {
  it.effect(
    "goes with an account or a workspace by a cascading foreign key, or is one the run accounts for by name",
    () =>
      Effect.gen(function* () {
        const client = yield* SqlClient.SqlClient;
        const tables = yield* client<{ readonly name: string }>`
          select table_name as name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`;
        const cascades = yield* client<{ readonly child: string; readonly parent: string }>`
          select child.relname as child, parent.relname as parent
          from pg_constraint fk
          join pg_class child on child.oid = fk.conrelid
          join pg_class parent on parent.oid = fk.confrelid
          join pg_namespace ns on ns.oid = child.relnamespace
          where fk.contype = 'f' and fk.confdeltype = 'c' and ns.nspname = 'public'`;
        const reached = new Set(["user", "organization"]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const { child, parent } of cascades) {
            if (reached.has(parent) && !reached.has(child)) {
              reached.add(child);
              grew = true;
            }
          }
        }
        const bookkeeping = new Set<string>([DRIZZLE_MIGRATIONS.TABLE, EFFECT_MIGRATIONS_TABLE]);
        const outside = tables
          .map(({ name }) => name)
          .filter((name) => !reached.has(name) && !bookkeeping.has(name))
          .sort();
        assert.deepEqual(
          outside,
          Object.keys(OUTSIDE_ANY_ACCOUNT).sort(),
          "a table no account or workspace takes with it must be emptied by `preparePreviewFork` or hold no account's data, and be named here",
        );
      }),
  );
});
