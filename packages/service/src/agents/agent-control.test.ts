import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { createCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { recordRepositoryReads } from "@luke/database/models/github-repository-reads";
import { createTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { DateTime, Effect, Option, Redacted } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import { NO_GITHUB, openGithubUser, openTokenMember } from "../testing/github-app-fake.js";
import { EVE_MOUNT, type EveTypedTurn, eveSessions } from "./brain-host/eve-sessions.js";
import { startFromOf } from "./coder-host/replay.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

/**
 * Who controls a coding agent that runs on its starter's own GitHub token,
 * over a real dialect: a teammate whose own verified token reads its
 * repository reaches it, but its messages and a start from it, continued or
 * forked, are refused before eve, GitHub, or its sandbox is asked; a
 * teammate who keeps no token reaches nothing. Synthetic accounts, tasks,
 * and words throughout; eve and GitHub answer nothing.
 */

/** An agent on its starter's own token, with a teammate whose token reads its repository and one who keeps none. */
const openTokenAgent = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const reader = yield* openTokenMember({ token: "fixture-reader-token" });
  const tokenless = yield* openGithubUser();
  const workspace = yield* openWorkspace(owner);
  for (const each of [reader, tokenless]) yield* joinWorkspace(workspace, each);
  const now = yield* DateTime.nowAsDate;
  yield* recordRepositoryReads(reader, [{ repository: "octo-member/side", readable: true }], now);
  const task = yield* createTask(owner, {
    organizationId: workspace,
    repository: "octo-member/side",
    githubAccess: GITHUB_ACCESS.TOKEN,
  });
  const started = yield* createCodingAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Side\n",
    prompt: null,
    repository: "octo-member/side",
    githubAccess: GITHUB_ACCESS.TOKEN,
  });
  return { owner, reader, tokenless, task, agent: Option.getOrThrow(started).agent };
});

it.layer(getTestDB())("an agent on its starter's own GitHub token", (it) => {
  it.effect(
    "a teammate who sees it is refused its messages and a start from it, and a teammate who keeps no token reaches it not at all",
    () =>
      Effect.gen(function* () {
        const { reader, tokenless, task, agent } = yield* openTokenAgent;
        const eve = yield* eveSessions<EveTypedTurn>({
          origin: "https://luke.test",
          caller: { secret: Redacted.make("fixture-deployment-secret"), account: reader },
          mount: EVE_MOUNT.CODER,
        });
        const steer = (userId: string) =>
          steerCodingAgent(eve, storeWriter({ tools: CODER_TOOL_SET }), userId, agent, {
            text: "Carry on.",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId },
          });
        const startFrom = (userId: string, messageId?: string) =>
          startFromOf(
            userId,
            task.id,
            { agentId: agent.id, ...(messageId === undefined ? undefined : { messageId }) },
            [],
            randomUUID(),
          );

        assert.ok(Option.isSome(yield* readCodingAgent(reader, agent.id)));
        assert.ok(Option.isNone(yield* readCodingAgent(tokenless, agent.id)));
        assert.deepEqual(yield* Effect.flip(steer(reader)), HOSTED_REFUSAL.NOT_PERMITTED);
        assert.deepEqual(yield* Effect.flip(startFrom(reader)), HOSTED_REFUSAL.NOT_PERMITTED);
        assert.deepEqual(
          yield* Effect.flip(startFrom(reader, randomUUID())),
          HOSTED_REFUSAL.NOT_PERMITTED,
        );
        assert.deepEqual(yield* Effect.flip(startFrom(tokenless)), HOSTED_REFUSAL.NOT_FOUND);
      }).pipe(Effect.provide(NO_GITHUB)),
  );
});
