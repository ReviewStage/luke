import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listAccountProviderKeyRows } from "@luke/database/models/provider-key-store";
import { listTasks } from "@luke/database/models/task-store";
import { listWorkspaces } from "@luke/database/models/workspace-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import {
  openMigratedPglite,
  sqlClientOverPglite,
  syncListenerOverPglite,
} from "@luke/database/testing";
import { AGENT_PAYER } from "@luke/features/agent-wire";
import { INBOX_CURSOR_START } from "@luke/features/inbox-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { TASK_STATUS } from "@luke/features/task-wire";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { agentRuntimeChoice } from "../agents/coder-host/agent-runtime-choice.js";
import { accountInboxPast } from "../agents/coder-host/inbox-page.js";
import { AGENT_KEY_RING } from "../testing/agent-credentials.js";
import { DEMO_DATABASE_REFUSAL, demoDatabaseUrl } from "./demo-database.js";
import { DEMO_DEAN, type DemoCredential, demoAuth, seedDemoWorld } from "./demo-seed.js";

/**
 * The demo seed over a migrated PGlite of each test's own, with the
 * seed's Better Auth over the same database, as the command builds it over
 * Postgres: what Dean reads back through the reads a route answers, and
 * the ids the seed chose, the same for two fresh databases. Synthetic
 * accounts; the credential is a fixture sealed under the suites' ring.
 * Note that a seed takes about two seconds, since it opens a migrated
 * PGlite and writes the whole world into it, a few hundred statements.
 */

const SEEDED_AT = Date.parse("2026-11-02T21:00:00Z");

const CLAUDE_TOKEN = "demo-claude-token-fixture";

/** The seed run over a fresh migrated PGlite, at a fixed instant, and what the reads under it answer. */
const seededThen = <A, E, R>(
  credential: Option.Option<DemoCredential>,
  read: (seeded: Effect.Success<ReturnType<typeof seedDemoWorld>>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
      Effect.promise(() => opened.close()),
    );
    yield* TestClock.setTime(SEEDED_AT);
    const database = Layer.provideMerge(syncListenerOverPglite, sqlClientOverPglite(client));
    return yield* Effect.flatMap(
      seedDemoWorld(demoAuth(drizzle({ client })), credential),
      read,
    ).pipe(Effect.provide(database));
  });

it.effect("Dean reads back acme, its tasks, his Inbox, and a credential his agents run on", () =>
  seededThen(
    Option.some({
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key: Redacted.make(CLAUDE_TOKEN),
      ring: AGENT_KEY_RING,
    }),
    (seeded) =>
      Effect.gen(function* () {
        const workspaces = yield* listWorkspaces(DEMO_DEAN.id);
        const tasks = yield* listTasks(DEMO_DEAN.id);
        const inbox = yield* accountInboxPast(DEMO_DEAN.id, INBOX_CURSOR_START);
        const choice = yield* agentRuntimeChoice(DEMO_DEAN.id, "anthropic/claude-opus-5.5");
        const [kept] = yield* listAccountProviderKeyRows(DEMO_DEAN.id);
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
        assert.equal(tasks.length, 7);
        const invitations = tasks.find((task) => task.name === "Teammate invitations");
        assert.equal(invitations?.status, TASK_STATUS.IN_PROGRESS);
        assert.equal(invitations?.repository, null);
        assert.equal(
          tasks.find((task) => task.name === "Webhook retries")?.status,
          TASK_STATUS.DONE,
        );
        // The three asks and the notice waiting on Dean, the ask he answered no longer among them.
        assert.deepEqual(
          new Set(
            inbox.items.filter((item) => item.waitsOn === DEMO_DEAN.id).map((item) => item.title),
          ),
          new Set([
            "Should invite links last 7 days or 14?",
            "Add the Postmark token to the preview environment",
            "What should the invite email say?",
            "Pending invites now show on Settings › Members",
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
      }),
  ),
);

it.effect("two seeds of two fresh databases choose the same ids", () =>
  Effect.gen(function* () {
    const first = yield* seededThen(Option.none(), Effect.succeed);
    const second = yield* seededThen(Option.none(), Effect.succeed);

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
