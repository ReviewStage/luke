import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { accountExperimentOn } from "@repo/database/models/account-store";
import { listWorkspaceAgents, readAgentRouting } from "@repo/database/models/agent-store";
import { hostBySecret, hostsOf } from "@repo/database/models/host-store";
import { openProviderKey, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { listAccountProviderKeyRows } from "@repo/database/models/provider-key-store";
import { readRunsOnPick } from "@repo/database/models/runs-on-pick";
import { listTasks } from "@repo/database/models/task-store";
import { listWorkspaces } from "@repo/database/models/workspace-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  openMigratedPglite,
  sqlClientOverPglite,
  syncListenerOverPglite,
} from "@repo/database/testing";
import { AGENT_KIND, AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { INBOX_CURSOR_START } from "@repo/features/inbox-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { agentRuntimeChoice } from "../agents/coder-host/agent-runtime-choice.js";
import { accountInboxPast } from "../agents/coder-host/inbox-page.js";
import { hostSecretHash } from "../auth/device-secret.js";
import { AGENT_KEY_RING } from "../testing/agent-credentials.js";
import { DEMO_DATABASE_REFUSAL, demoDatabaseUrl } from "./demo-database.js";
import {
  DEMO_DEAN,
  DEMO_HOST,
  type DemoCredential,
  type DemoHost,
  demoAuth,
  demoHostSecret,
  seedDemoWorld,
} from "./demo-seed.js";

/**
 * The demo seed over a migrated PGlite of each test's own, with the
 * seed's Better Auth over the same database, as the command builds it over
 * Postgres: what Dean reads back through the reads a route answers, and
 * the ids the seed chose, the same for two fresh databases. Synthetic
 * accounts; the credential is a fixture sealed under the suites' ring.
 * Note that a seed takes about five seconds, since it opens a migrated
 * PGlite and writes the whole world into it, a few thousand statements, so
 * the file, which seeds three times, takes about fifteen.
 */

const SEEDED_AT = Date.parse("2026-11-02T21:00:00Z");

const CLAUDE_TOKEN = "demo-claude-token-fixture";

/** The seed run over a fresh migrated PGlite, at a fixed instant, and what the reads under it answer. */
const seededThen = <A, E, R>(
  credential: Option.Option<DemoCredential>,
  host: Option.Option<DemoHost>,
  read: (seeded: Effect.Success<ReturnType<typeof seedDemoWorld>>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
      Effect.promise(() => opened.close()),
    );
    yield* TestClock.setTime(SEEDED_AT);
    const database = Layer.provideMerge(syncListenerOverPglite, sqlClientOverPglite(client));
    return yield* Effect.flatMap(
      seedDemoWorld(demoAuth(drizzle({ client })), credential, host),
      read,
    ).pipe(Effect.provide(database));
  });

/** The secret the host's record holds, minted once for the suite as the seed's runner mints it. */
const HOST_SECRET = demoHostSecret();

it.effect("Dean reads back acme, its tasks, his Inbox, and his agents' credential and host", () =>
  seededThen(
    Option.some({
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key: Redacted.make(CLAUDE_TOKEN),
      ring: AGENT_KEY_RING,
    }),
    Option.some({ secretHash: HOST_SECRET.hash }),
    (seeded) =>
      Effect.gen(function* () {
        const workspaces = yield* listWorkspaces(DEMO_DEAN.id);
        const tasks = yield* listTasks(DEMO_DEAN.id);
        const inbox = yield* accountInboxPast(DEMO_DEAN.id, INBOX_CURSOR_START);
        const choice = yield* agentRuntimeChoice(DEMO_DEAN.id, "anthropic/claude-opus-5.5");
        const [kept] = yield* listAccountProviderKeyRows(DEMO_DEAN.id);
        const hosts = yield* hostsOf(DEMO_DEAN.id);
        const caller = yield* hostBySecret(hostSecretHash(HOST_SECRET.secret));
        const pick = yield* readRunsOnPick(DEMO_DEAN.id);
        const ownHosts = yield* accountExperimentOn(DEMO_DEAN.id, EXPERIMENT.BRING_YOUR_OWN_HOST);
        const agents = yield* listWorkspaceAgents(DEMO_DEAN.id, seeded.workspaceId, { limit: 10 });
        const payers = yield* Effect.forEach(agents, (agent) =>
          Effect.map(readAgentRouting(DEMO_DEAN.id, agent.id), (routing) =>
            Option.getOrUndefined(Option.map(routing, (row) => row.payer)),
          ),
        );
        const ring = Result.getOrThrow(parseKeyRing(AGENT_KEY_RING));
        const owner = {
          userId: DEMO_DEAN.id,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        };

        assert.deepEqual(
          new Set(workspaces.map((workspace) => workspace.name)),
          new Set(["Dean Stratakos", "acme"]),
        );
        assert.equal(
          workspaces.find((workspace) => workspace.id === seeded.workspaceId)?.role,
          "owner",
        );
        assert.equal(tasks.length, 21);
        const invitations = tasks.find((task) => task.name === "Teammate invitations");
        assert.equal(invitations?.status, TASK_STATUS.IN_PROGRESS);
        assert.equal(invitations?.repository, null);
        assert.equal(
          tasks.find((task) => task.name === "Webhook retries")?.status,
          TASK_STATUS.DONE,
        );
        // The pilot's four sub-tasks stand under the task it broke down, and the tasks waiting on an open one read blocked.
        const billing = tasks.find((task) => task.name === "Usage-based billing");
        assert.deepEqual(
          new Set(
            tasks.filter((task) => task.parentTaskId === billing?.id).map((task) => task.name),
          ),
          new Set([
            "Record usage events per workspace",
            "Daily usage rollup",
            "Report usage to Stripe",
            "Usage on Settings › Billing",
          ]),
        );
        assert.deepEqual(
          new Set(tasks.filter((task) => task.blocked === true).map((task) => task.name)),
          new Set([
            "Report usage to Stripe",
            "Usage on Settings › Billing",
            "Invite emails through Postmark",
            "Handle Postmark bounces",
            "Resend an expired invite",
          ]),
        );
        // The asks and notices waiting on Dean, those he and his teammates answered or nodded away no longer among them.
        assert.deepEqual(
          new Set(
            inbox.items.filter((item) => item.waitsOn === DEMO_DEAN.id).map((item) => item.title),
          ),
          new Set([
            "Should invite links last 7 days or 14?",
            "Add the Postmark token to the preview environment",
            "What should the invite email say?",
            "Pending invites now show on Settings › Members",
            "Who may hide the checklist for the whole workspace?",
            "How far back should the rollup backfill?",
            "What should the rotation email tell customers?",
            "Add Stripe's test keys to the preview",
            "Where usage-based billing stands",
            "Promote the chart hotfix to production",
          ]),
        );
        assert.equal(inbox.plans.find((plan) => plan.planId === invitations?.id)?.toDo, 3);
        assert.deepEqual(choice, {
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
        });
        assert.ok(kept !== undefined);
        const opened = openProviderKey(ring, owner, kept);
        assert.equal(Result.isSuccess(opened) && Redacted.value(opened.success), CLAUDE_TOKEN);
        // The host the run starts is Dean's, its record's secret calls in as it, and his pick runs on it.
        assert.deepEqual(
          hosts.map((host) => host.id),
          [DEMO_HOST.id],
        );
        assert.deepEqual(
          Option.getOrUndefined(
            Option.map(caller, ({ deviceId, userId }) => ({ deviceId, userId })),
          ),
          { deviceId: DEMO_HOST.id, userId: DEMO_DEAN.id },
        );
        assert.deepEqual(Option.getOrUndefined(pick), {
          machine: AGENT_MACHINE.DEVICE,
          deviceId: DEMO_HOST.id,
        });
        // Bring your own host stays off, since with it on the app would enroll the Mac's own account install with the demo's server.
        assert.equal(ownHosts, false);
        // The seeded agents are Dean's on that host, paid for by his plan, so a follow-up to one runs there, those his pilot started among them.
        assert.deepEqual(
          agents.map((agent) => [agent.userId, agent.machine, agent.deviceId]),
          Array.from({ length: 8 }, () => [DEMO_DEAN.id, AGENT_MACHINE.DEVICE, DEMO_HOST.id]),
        );
        assert.deepEqual(
          payers,
          Array.from({ length: 8 }, () => AGENT_PAYER.CLAUDE_SUBSCRIPTION),
        );
        const pilot = agents.find((agent) => agent.kind === AGENT_KIND.PILOT);
        assert.equal(pilot?.taskId, billing?.id);
        assert.deepEqual(
          new Set(
            agents
              .filter((agent) => agent.startedByAgentId === pilot?.id)
              .map((agent) => agent.title),
          ),
          new Set(["Meter API calls per workspace", "Roll usage up by day"]),
        );
      }),
  ),
);

it.effect("two seeds of two fresh databases choose the same ids", () =>
  Effect.gen(function* () {
    const first = yield* seededThen(Option.none(), Option.none(), Effect.succeed);
    const second = yield* seededThen(Option.none(), Option.none(), Effect.succeed);

    assert.deepEqual(second, first);
    assert.equal(first.deanId, DEMO_DEAN.id);
  }),
);

it("the seed's database is a Postgres on loopback, and nothing else", () => {
  assert.equal(
    Result.getOrUndefined(demoDatabaseUrl("postgresql://luke@127.0.0.1:54329/demo")),
    "postgresql://luke@127.0.0.1:54329/demo",
  );
  assert.equal(
    Option.getOrUndefined(
      Result.getFailure(demoDatabaseUrl("postgresql://luke@ep-cool-name.neon.tech/neondb")),
    ),
    DEMO_DATABASE_REFUSAL.NOT_LOOPBACK,
  );
  // A `host` parameter overrides the address's host in node-postgres, so it cannot carry the seed elsewhere.
  assert.equal(
    Option.getOrUndefined(
      Result.getFailure(demoDatabaseUrl("postgresql://luke@localhost/demo?host=db.example.com")),
    ),
    DEMO_DATABASE_REFUSAL.NOT_LOOPBACK,
  );
});
