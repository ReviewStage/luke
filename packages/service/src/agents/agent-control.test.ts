import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { createCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { recordRepositoryReads } from "@luke/database/models/github-repository-reads";
import { readGitHubTokenRow } from "@luke/database/models/github-token-store";
import { createTask } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { DateTime, Effect, Option, Redacted } from "effect";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
  openGithubUser,
  openTokenMember,
} from "../testing/github-app-fake.js";
import { agentPullRequestReach } from "./coder-host/published.js";
import { startFromOf } from "./coder-host/replay.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { EVE_MOUNT, type EveTypedTurn, eveSessions } from "./eve-host/eve-sessions.js";

/**
 * Who controls a coding agent that runs on its starter's own GitHub token,
 * over a real dialect: a teammate whose own verified token reads its
 * repository reaches it, but its messages and a start from it, continued or
 * forked, are refused before eve, GitHub, or its sandbox is asked; a
 * teammate who keeps no token reaches nothing. And an agent the App reaches,
 * on a task on its owner's token, takes no message from a teammate who
 * reaches the agent but not the task, nor reads its pull requests. Synthetic accounts, tasks, and words
 * throughout; eve and GitHub answer nothing.
 */

/** An agent on its starter's own token, with a teammate whose token reads its repository and one who keeps none. */
const openTokenAgent = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const reader = yield* openTokenMember({ token: "fixture-reader-token" });
  const tokenless = yield* openGithubUser();
  const workspace = yield* openWorkspace(owner);
  for (const each of [reader, tokenless]) yield* joinWorkspace(workspace, each);
  const now = yield* DateTime.nowAsDate;
  const sealed = (yield* readGitHubTokenRow(reader))?.sealedToken ?? "";
  const side = [{ repository: "octo-member/side", readable: true }];
  yield* recordRepositoryReads(reader, sealed, side, now);
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
  return { owner, reader, tokenless, workspace, task, agent: Option.getOrThrow(started).agent };
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
            { taskId: task.id },
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

  it.effect(
    "a teammate who reaches the agent but not its task's GitHub visibility is refused its messages and its pull requests",
    () =>
      Effect.gen(function* () {
        const { owner, tokenless, workspace, task } = yield* openTokenAgent;
        // Note that a native runtime with no payer asks for no API key, so the send reaches the task's gate.
        const repository = "octo-member/app-side";
        const started = yield* createCodingAgent(owner, {
          taskId: task.id,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          planSnapshot: "# Side\n",
          prompt: null,
          repository,
          githubAccess: GITHUB_ACCESS.APP,
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        });
        const agent = Option.getOrThrow(started).agent;
        const eve = yield* eveSessions<EveTypedTurn>({
          origin: "https://luke.test",
          caller: { secret: Redacted.make("fixture-deployment-secret"), account: tokenless },
          mount: EVE_MOUNT.CODER,
        });

        assert.ok(Option.isSome(yield* readCodingAgent(tokenless, agent.id)));
        const refused = yield* Effect.flip(
          steerCodingAgent(eve, storeWriter({ tools: CODER_TOOL_SET }), tokenless, agent, {
            text: "Carry on.",
            clientKey: randomUUID(),
            sender: { kind: MESSAGE_SENDER.MEMBER, userId: tokenless },
          }),
        );
        assert.deepEqual(refused, HOSTED_REFUSAL.NOT_FOUND);
        // The workspace's installation reaches the agent's repository, so only the task's visibility refuses the read.
        const installation: InstallationFixture = {
          id: 300,
          login: "octo-member",
          repositories: [{ owner: "octo-member", name: "app-side" }],
        };
        yield* connectWorkspaceGitHub(workspace, installation);
        const unreached = yield* Effect.flip(
          agentPullRequestReach(tokenless, { ...agent, repository }).pipe(
            Effect.provide(githubReaching([installation]).layer),
          ),
        );
        assert.equal(unreached._tag, "RepositoryNotReachable");
      }).pipe(Effect.provide(NO_GITHUB)),
  );
});
