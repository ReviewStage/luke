import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, joinWorkspace, openWorkspace } from "../../testing/index.js";
import {
  createCodingAgent,
  listCodingAgents,
  listWorkspaceCodingAgents,
  readCodingAgent,
} from "../coding-agent-store.js";
import { recordRepositoryReads, unaskedTokenRepositories } from "../github-repository-reads.js";
import {
  readGitHubTokenRow,
  saveGitHubToken,
  setGitHubTokenStatus,
} from "../github-token-store.js";
import { createTask, listTasks, readTask } from "../task-store.js";

/**
 * A task and a coding agent reached on their owner's own GitHub token, over
 * a real dialect: seen by their owner, by a teammate whose verified token
 * the service last found reading the repository, and by no other member,
 * while a task on the workspace's App is every member's. And the
 * repositories the service asks GitHub about for a member: those of
 * teammates' token tasks and agents not answered within the window.
 *
 * Synthetic accounts, repositories, and sealed values throughout; no token.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A token the member keeps, as a save leaves it: verified, its seal synthetic. */
const keepToken = (userId: string) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* saveGitHubToken(
      userId,
      { keyVersion: 1, sealedDataKey: "sealed-key", sealedToken: `sealed-${randomUUID()}` },
      { hint: "fixture…abcd", githubUserId: "4242", githubLogin: "octo-member", expiresAt: null },
      now,
    );
  });

/** A workspace of the owner's with a task and an agent on the owner's token, and a task on the App. */
const tokenWorkspace = Effect.gen(function* () {
  const owner = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  const tokenTask = yield* createTask(owner, {
    organizationId: workspace,
    repository: "Octo-Member/Side",
    githubAccess: GITHUB_ACCESS.TOKEN,
  });
  const appTask = yield* createTask(owner, { organizationId: workspace, repository: "acme/api" });
  const started = yield* createCodingAgent(owner, {
    taskId: tokenTask.id,
    planSnapshot: "# Side",
    prompt: null,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "Octo-Member/Side",
    githubAccess: GITHUB_ACCESS.TOKEN,
  });
  const agent = Option.getOrThrow(started).agent;
  return { owner, workspace, tokenTask, appTask, agent };
});

it.layer(getTestDB())("a task and an agent on their owner's own GitHub token", (it) => {
  it.effect(
    "the owner and a teammate whose verified token reads the repository see them, a teammate without one sees only the App's task, and a token refused or replaced since sees them no more",
    () =>
      Effect.gen(function* () {
        const { owner, workspace, tokenTask, appTask, agent } = yield* tokenWorkspace;
        const reader = yield* openAccount;
        const tokenless = yield* openAccount;
        const refused = yield* openAccount;
        for (const each of [reader, tokenless, refused]) yield* joinWorkspace(workspace, each);
        yield* keepToken(reader);
        yield* keepToken(refused);
        const now = yield* DateTime.nowAsDate;
        yield* recordRepositoryReads(
          reader,
          [{ repository: "octo-member/side", readable: true }],
          now,
        );
        yield* recordRepositoryReads(
          refused,
          [{ repository: "octo-member/side", readable: false }],
          now,
        );
        const taskIds = (userId: string) =>
          Effect.map(listTasks(userId), (tasks) => tasks.map((each) => each.id).sort());
        const sees = (userId: string) =>
          Effect.gen(function* () {
            const listed = yield* listWorkspaceCodingAgents(userId, workspace, { limit: 10 });
            return {
              tasks: yield* taskIds(userId),
              task: Option.isSome(yield* readTask(userId, tokenTask.id)),
              agent: Option.isSome(yield* readCodingAgent(userId, agent.id)),
              listedAgents: listed.length,
            };
          });
        const both = [tokenTask.id, appTask.id].sort();
        const seesAll = { tasks: both, task: true, agent: true, listedAgents: 1 };
        const seesAppOnly = { tasks: [appTask.id], task: false, agent: false, listedAgents: 0 };

        assert.deepEqual(yield* sees(owner), seesAll);
        assert.deepEqual(yield* sees(reader), seesAll);
        assert.deepEqual(yield* sees(tokenless), seesAppOnly);
        assert.deepEqual(yield* sees(refused), seesAppOnly);
        assert.equal(
          Option.getOrThrow(yield* readTask(owner, tokenTask.id)).githubAccess,
          GITHUB_ACCESS.TOKEN,
        );

        const row = yield* readGitHubTokenRow(reader);
        assert.ok(row !== undefined);
        yield* setGitHubTokenStatus(reader, row.sealedToken, GITHUB_TOKEN_STATUS.INVALID, now);
        assert.deepEqual(yield* sees(reader), seesAppOnly);
        yield* keepToken(reader);
        assert.deepEqual(yield* sees(reader), seesAppOnly);
      }),
  );

  it.effect(
    "an agent on its owner's token on a task every member sees is seen by its owner alone among those without a read",
    () =>
      Effect.gen(function* () {
        const { owner, workspace, appTask } = yield* tokenWorkspace;
        const teammate = yield* openAccount;
        yield* joinWorkspace(workspace, teammate);
        const started = yield* createCodingAgent(owner, {
          taskId: appTask.id,
          planSnapshot: "# API",
          prompt: null,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "octo-member/side",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const onToken = Option.getOrThrow(started).agent;

        const agentsOf = (userId: string) =>
          Effect.map(listCodingAgents(userId, appTask.id), (agents) => agents.map((a) => a.id));
        assert.deepEqual(yield* agentsOf(owner), [onToken.id]);
        assert.deepEqual(yield* agentsOf(teammate), []);
      }),
  );

  it.effect(
    "the repositories asked about for a member are those of teammates' token tasks and agents, each once and lowercased, until an answer stands within the window",
    () =>
      Effect.gen(function* () {
        const { owner, workspace } = yield* tokenWorkspace;
        const teammate = yield* openAccount;
        yield* joinWorkspace(workspace, teammate);
        // The teammate's own token task is theirs to see, so nothing is asked about it.
        yield* createTask(teammate, {
          organizationId: workspace,
          repository: "teammate/own",
          githubAccess: GITHUB_ACCESS.TOKEN,
        });
        const now = yield* DateTime.nowAsDate;
        const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        assert.deepEqual(yield* unaskedTokenRepositories(teammate, hourAgo), ["octo-member/side"]);
        assert.deepEqual(yield* unaskedTokenRepositories(owner, hourAgo), ["teammate/own"]);
        yield* recordRepositoryReads(
          teammate,
          [{ repository: "Octo-Member/Side", readable: false }],
          now,
        );
        assert.deepEqual(yield* unaskedTokenRepositories(teammate, hourAgo), []);
        const later = new Date(now.getTime() + 1);
        assert.deepEqual(yield* unaskedTokenRepositories(teammate, later), ["octo-member/side"]);
      }),
  );
});
