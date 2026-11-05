import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { githubRepositoryRead } from "../../schemas/github-repository-read.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { readAgentRepositories } from "../agent-repositories.js";
import { createAgent, readAgent } from "../agent-store.js";
import { createAutomation, readAutomation } from "../automation-store.js";
import { noteGitHubRepository } from "../github-repositories.js";
import {
  claimChapterGeneration,
  latestPullRequestChapters,
} from "../pull-request-chapters-store.js";
import { listRepositoryPins, setRepositoryPin } from "../repository-pin-store.js";
import { createTask, readTask } from "../task-store.js";
import {
  addWorkspaceTokenRepository,
  listWorkspaceTokenRepositories,
} from "../workspace-token-repository-store.js";

/**
 * A GitHub repository renamed: every name the store keeps of it, in every
 * account and in any case, follows GitHub's id to its new name, each table
 * still holding one row where it holds one per name, and another
 * repository's names stay where they stood.
 *
 * Synthetic accounts, ids, and repositories throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** A fresh id for a repository, so no other test's sighting of it is in the way. */
const repositoryId = () => Math.floor(Math.random() * 1_000_000_000) + 1;

/** A fresh repository name under `owner`, so no other test's rows carry it. */
const repositoryName = (owner: string, name: string) =>
  `${owner}/${name}-${randomUUID().slice(0, 8)}`;

/** GitHub's `updated_at` for a sighting, by the minute of an hour it names. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 12, minute));

const taskRepository = (userId: string, taskId: string) =>
  Effect.map(readTask(userId, taskId), (read) => Option.getOrThrow(read).task.repository);

it.layer(getTestDB())("GitHub's repositories by their id", (it) => {
  it.effect(
    "a repository seen under a new name relabels every stored name of it, in every account and any case, keeps one pin where both names were pinned, and leaves another repository's alone",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const now = yield* DateTime.nowAsDate;
        const id = repositoryId();
        const relay = repositoryName("Acme", "Relay");
        const rocket = repositoryName("Acme", "Rocket");
        const other = repositoryName("acme", "other");
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const stranger = yield* openAccount;
        const strangerWorkspace = yield* openWorkspace(stranger);

        const relayTask = yield* createTask(owner, {
          organizationId: workspace,
          repository: relay,
        });
        const otherTask = yield* createTask(owner, {
          organizationId: workspace,
          repository: other,
        });
        const strangerTask = yield* createTask(stranger, {
          organizationId: strangerWorkspace,
          repository: relay.toLowerCase(),
        });
        const agent = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: relayTask.id,
            planSnapshot: "# Relay",
            prompt: null,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: relay,
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          }),
        ).agent;
        const alsoInRelay = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: otherTask.id,
            planSnapshot: "# Other",
            prompt: null,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: other,
            extraRepositories: [{ repository: relay.toLowerCase() }],
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          }),
        ).agent;
        const automation = Option.getOrThrow(
          yield* createAutomation(owner, {
            organizationId: workspace,
            repositories: [relay],
            name: "Nightly sweep",
            trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
            action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Sweep." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          }),
        );
        yield* setRepositoryPin(owner, relay, true);
        yield* setRepositoryPin(stranger, relay.toLowerCase(), true);
        yield* setRepositoryPin(stranger, rocket, true);
        yield* addWorkspaceTokenRepository(stranger, strangerWorkspace, relay.toLowerCase(), now);
        yield* db.insert(githubRepositoryRead).values({
          userId: stranger,
          repository: relay.toLowerCase(),
          readable: true,
          checkedAt: now,
        });
        yield* claimChapterGeneration({
          organizationId: workspace,
          repository: relay,
          pullRequestNumber: 7,
          baseSha: "base",
          headSha: "head",
          requestedBy: owner,
          now,
        });

        yield* noteGitHubRepository({ id, fullName: relay, updatedAt: at(0) });
        assert.equal(yield* taskRepository(owner, relayTask.id), relay);
        yield* noteGitHubRepository({ id, fullName: rocket, updatedAt: at(5) });

        assert.equal(yield* taskRepository(owner, relayTask.id), rocket);
        assert.equal(yield* taskRepository(stranger, strangerTask.id), rocket);
        assert.equal(yield* taskRepository(owner, otherTask.id), other);
        assert.equal(Option.getOrThrow(yield* readAgent(owner, agent.id)).repository, rocket);
        assert.deepEqual(
          (yield* readAgentRepositories(owner, alsoInRelay.id)).map((each) => each.repository),
          [other, rocket],
        );
        assert.deepEqual(
          Option.getOrThrow(yield* readAutomation(owner, automation.id)).repositories,
          [rocket],
        );
        assert.deepEqual(
          (yield* listRepositoryPins(owner)).map((pin) => pin.repository),
          [rocket],
        );
        assert.deepEqual(
          (yield* listRepositoryPins(stranger)).map((pin) => pin.repository),
          [rocket],
        );
        assert.deepEqual(
          (yield* listWorkspaceTokenRepositories(stranger, strangerWorkspace)).map(
            (row) => row.repository,
          ),
          [rocket],
        );
        assert.deepEqual(
          (yield* db
            .select({ repository: githubRepositoryRead.repository })
            .from(githubRepositoryRead)
            .where(eq(githubRepositoryRead.userId, stranger))).map((row) => row.repository),
          [rocket.toLowerCase()],
        );
        assert.ok(Option.isSome(yield* latestPullRequestChapters(workspace, rocket, 7)));
      }),
  );

  it.effect(
    "a rename's delivery relabels by the old name it carries, for a repository the store never saw before",
    () =>
      Effect.gen(function* () {
        const relay = repositoryName("acme", "relay");
        const rocket = repositoryName("acme", "rocket");
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const renamed = yield* createTask(owner, {
          organizationId: workspace,
          repository: relay,
        });

        yield* noteGitHubRepository({
          id: repositoryId(),
          fullName: rocket,
          updatedAt: at(5),
          formerly: relay,
        });

        assert.equal(yield* taskRepository(owner, renamed.id), rocket);
      }),
  );

  it.effect(
    "a delivery late or redelivered under the name a repository left behind moves nothing back",
    () =>
      Effect.gen(function* () {
        const id = repositoryId();
        const relay = repositoryName("acme", "relay");
        const rocket = repositoryName("acme", "rocket");
        const owner = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const renamed = yield* createTask(owner, { organizationId: workspace, repository: relay });
        yield* noteGitHubRepository({ id, fullName: rocket, updatedAt: at(5), formerly: relay });

        yield* noteGitHubRepository({ id, fullName: relay, updatedAt: at(1) });
        yield* noteGitHubRepository({ id, fullName: relay, updatedAt: at(1), formerly: rocket });

        assert.equal(yield* taskRepository(owner, renamed.id), rocket);
      }),
  );
});
