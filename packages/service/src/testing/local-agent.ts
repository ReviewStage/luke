/**
 * local-agent.ts -- a local agent over the test's real store, and the Claude Code sessions that reach it through its Mac's lines.
 *
 * Synthetic accounts, agents, and Macs throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { createAgent } from "@luke/database/models/agent-store";
import { registerDevice } from "@luke/database/models/device-store";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import type { ConversationRuntime } from "@luke/database/storage-vocabulary";
import { DEVICE_LAYOUT, startTask } from "@luke/database/testing";
import { AGENT_MACHINE, AGENT_PAYER } from "@luke/features/agent-wire";
import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { AgentSandboxImage } from "../agents/agent-sandbox-image.js";
import { claudeCodeSessions } from "../agents/coder-host/claude-code-sessions.js";
import { RunnerBundle } from "../agents/coder-host/runner-bundle.js";
import { AgentMachine } from "../agents/machine/agent-machine.js";
import { deviceMachine } from "../agents/machine/device-machine.js";
import type { HostedEnvironment } from "../environment.js";
import { LINK_OUTCOME } from "../github/github-installations.js";
import { connectWorkspaceGitHub, type InstallationFixture, NO_GITHUB } from "./github-app-fake.js";

/** How a local agent is opened: in the repository the installation given reaches, on the harness given, and on its Mac's own Claude Code login where asked. */
export interface LocalAgentOptions {
  /** The installation reaching the repository it works in, connected to its task's workspace; none for an agent in no repository. */
  readonly installation?: InstallationFixture;
  /** The harness its conversation runs on, as Start records it; the store's own where none is named. */
  readonly runtime?: ConversationRuntime;
  /** Whether its Mac is signed in to Claude Code itself, and the agent started to run on that login, as Start chooses it there. */
  readonly onMacLogin?: boolean;
}

/**
 * An account with a Mac that just registered, and an agent pinned to it
 * whose conversation runs in a session: its starter, its Mac, the agent,
 * and the session.
 */
export const openLocalAgent = (options: LocalAgentOptions = {}) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const deviceId = randomUUID();
    yield* registerDevice(userId, {
      id: deviceId,
      name: "Studio",
      ...DEVICE_LAYOUT,
      ...(options.onMacLogin === true ? { signedIn: { claudeCode: true } } : undefined),
    });
    const { installation } = options;
    const reached = installation?.repositories[0];
    const repository = reached === undefined ? null : `${reached.owner}/${reached.name}`;
    const task = yield* startTask(userId, { name: "Invitations", repository });
    if (installation !== undefined) {
      assert.equal(
        yield* connectWorkspaceGitHub(task.workspaceId, installation),
        LINK_OUTCOME.LINKED,
      );
    }
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository,
      machine: AGENT_MACHINE.DEVICE,
      deviceId,
      ...(options.runtime === undefined ? undefined : { runtime: options.runtime }),
      ...(options.onMacLogin === true ? { payer: AGENT_PAYER.MAC_SIGN_IN } : undefined),
    });
    const { agent } = Option.getOrThrow(started);
    const session = `cc-${randomUUID()}`;
    yield* db
      .update(conversations)
      .set({ runtimeSessionId: session })
      .where(eq(conversations.id, agent.conversationId));
    return { userId, deviceId, agent, session };
  });

/** What the sessions reach beside the store and the deployment's environment: the Mac's machine, and no GitHub, image, or bundle, which a Mac's launch in no repository never asks. */
const LOCAL_AGENT_SERVICES = Layer.mergeAll(
  Layer.effect(AgentMachine, deviceMachine),
  NO_GITHUB,
  Layer.succeed(AgentSandboxImage, {
    snapshotId: Effect.succeed(Option.none()),
    snapshotGone: () => Effect.void,
    prepared: Effect.succeed(true),
  }),
  Layer.succeed(RunnerBundle, { contents: Effect.succeed(new Uint8Array()) }),
);

/**
 * The account's Claude Code sessions over its Macs alone, which launch a
 * local agent's runner and write its messages as lines its Mac follows,
 * each launch numbering its events from naught.
 */
export const localAgentSessions = (userId: string) =>
  claudeCodeSessions({
    userId,
    eventsUrl: "https://luke.test/api/agents/runner/events",
    linesUrl: "https://luke.test/api/agents/runner-lines",
    mcpUrl: "https://luke.test/api/agents/mcp",
    integrations: () => Effect.succeed([]),
    instructions: () => Effect.succeed("You are a Luke coding agent."),
    nextSequence: () => Effect.succeed(0),
  }).pipe(Effect.provide(LOCAL_AGENT_SERVICES)) satisfies Effect.Effect<
    unknown,
    never,
    DatabaseServices | HostedEnvironment
  >;
