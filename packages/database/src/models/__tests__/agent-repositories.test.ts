/**
 * agent-repositories.test.ts -- the repositories an agent works in, over a real dialect: its
 * primary first, then the extras its Start named in their order; one repository or none as an
 * agent in one or none was always stored, with no extra row; and none to another account. A
 * repository added once the agent stands goes after its extras, once, and only as its account.
 * Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { eq } from "drizzle-orm";
import { Effect, Option, Result } from "effect";
import { Database } from "../../core/query.js";
import { agentRepository } from "../../schemas/agent-repository.js";
import { user } from "../../schemas/auth.js";
import { CONVERSATION_RUNTIME } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  APPEND_REFUSAL,
  appendAgentRepository,
  readAgentRepositories,
} from "../agent-repositories.js";
import { createAgent, type NewAgentRepository } from "../agent-store.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** An agent of the account's in its workspace with no task, in the repository named and the extras beside it; its id. */
const startedIn = (
  userId: string,
  organizationId: string,
  repository: string | null,
  extraRepositories?: readonly NewAgentRepository[],
) =>
  Effect.map(
    createAgent(userId, {
      taskId: null,
      organizationId,
      descriptionSnapshot: null,
      prompt: "Bump the client in both",
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository,
      startBranch: repository === null ? undefined : "release",
      githubAccess: GITHUB_ACCESS.APP,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      ...(extraRepositories === undefined ? undefined : { extraRepositories }),
    }),
    (started) => Option.getOrThrow(started).agent.id,
  );

/** The rows the agent's extras stand in, as the table holds them. */
const extraRows = (agentId: string) =>
  Effect.flatMap(Database, (db) =>
    db.select().from(agentRepository).where(eq(agentRepository.agentId, agentId)),
  );

it.layer(getTestDB())("the repositories an agent works in", (it) => {
  it.effect("are its own first, then the extras its Start named, in their order", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const workspace = yield* openWorkspace(userId);
      const agentId = yield* startedIn(userId, workspace, "acme/api", [
        { repository: "acme/web" },
        { repository: "acme/docs", baseBranch: "next" },
      ]);

      assert.deepEqual(yield* readAgentRepositories(userId, agentId), [
        { repository: "acme/api", baseBranch: "release", headBranch: null, pullRequest: null },
        { repository: "acme/web", baseBranch: null, headBranch: null, pullRequest: null },
        { repository: "acme/docs", baseBranch: "next", headBranch: null, pullRequest: null },
      ]);
    }),
  );

  it.effect("are its one repository, or none, with no extra row written", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const workspace = yield* openWorkspace(userId);
      const inOne = yield* startedIn(userId, workspace, "acme/api");
      const inNone = yield* startedIn(userId, workspace, null);

      assert.deepEqual(yield* readAgentRepositories(userId, inOne), [
        { repository: "acme/api", baseBranch: "release", headBranch: null, pullRequest: null },
      ]);
      assert.deepEqual(yield* readAgentRepositories(userId, inNone), []);
      assert.deepEqual([...(yield* extraRows(inOne)), ...(yield* extraRows(inNone))], []);
    }),
  );

  it.effect("are none to an account outside the agent's workspace", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      const workspace = yield* openWorkspace(owner);
      const agentId = yield* startedIn(owner, workspace, "acme/api", [{ repository: "acme/web" }]);

      assert.deepEqual(yield* readAgentRepositories(other, agentId), []);
    }),
  );

  it.effect(
    "take a repository added later after the extras, once in any case, within the bound, and only as its account",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const other = yield* openAccount;
        const workspace = yield* openWorkspace(owner);
        const agentId = yield* startedIn(owner, workspace, "acme/api", [
          { repository: "acme/web" },
        ]);
        const inNone = yield* startedIn(owner, workspace, null);
        const full = yield* startedIn(
          owner,
          workspace,
          "acme/api",
          Array.from({ length: 9 }, (_, index) => ({ repository: `acme/lib-${index}` })),
        );

        const added = yield* appendAgentRepository(owner, agentId, {
          repository: "acme/docs",
          baseBranch: "next",
        });
        const refused = [
          yield* appendAgentRepository(owner, agentId, {
            repository: "Acme/API",
            baseBranch: null,
          }),
          yield* appendAgentRepository(owner, agentId, {
            repository: "ACME/docs",
            baseBranch: null,
          }),
          yield* appendAgentRepository(owner, full, { repository: "acme/cli", baseBranch: null }),
          yield* appendAgentRepository(other, agentId, {
            repository: "acme/cli",
            baseBranch: null,
          }),
          yield* appendAgentRepository(owner, inNone, { repository: "acme/cli", baseBranch: null }),
        ];

        assert.deepEqual(added, Result.succeed(2));
        assert.deepEqual(refused, [
          Result.fail(APPEND_REFUSAL.ALREADY),
          Result.fail(APPEND_REFUSAL.ALREADY),
          Result.fail(APPEND_REFUSAL.FULL),
          Result.fail(APPEND_REFUSAL.UNREACHED),
          Result.fail(APPEND_REFUSAL.UNREACHED),
        ]);
        assert.deepEqual(yield* readAgentRepositories(owner, agentId), [
          { repository: "acme/api", baseBranch: "release", headBranch: null, pullRequest: null },
          { repository: "acme/web", baseBranch: null, headBranch: null, pullRequest: null },
          { repository: "acme/docs", baseBranch: "next", headBranch: null, pullRequest: null },
        ]);
        assert.equal((yield* readAgentRepositories(owner, full)).length, 10);
      }),
  );
});
