/**
 * local-agent.ts -- a local agent over the test's real store, the Claude Code sessions that reach it through its Mac's lines, and one whose runner its Mac took and left warm past its first turn.
 *
 * Synthetic accounts, agents, Macs, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { type Agent, createAgent } from "@repo/database/models/agent-store";
import { deviceAgentLinesWaiting } from "@repo/database/models/device-agent-store";
import { registerDevice } from "@repo/database/models/device-store";
import { user } from "@repo/database/schemas/auth";
import { conversations, messages, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, startTask } from "@repo/database/testing";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@repo/features/device-agent-wire";
import type { GitHubAccess } from "@repo/features/github-repositories-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Option } from "effect";
import { AgentImage } from "../agents/coder-host/agent-image.js";
import { claudeCodeSessions } from "../agents/coder-host/claude-code-sessions.js";
import { claimedDeviceAgentLine } from "../agents/device-agent.js";
import { EVE_SEND_OUTCOME } from "../agents/eve-host/eve-sessions.js";
import { AgentMachine } from "../agents/machine/agent-machine.js";
import { deviceMachine } from "../agents/machine/device-machine.js";
import { HostedEnvironment } from "../environment.js";
import { LINK_OUTCOME } from "../github/github-installations.js";
import { AGENT_KEY_RING, connectAgentApiKeys } from "./agent-credentials.js";
import { connectWorkspaceGitHub, type InstallationFixture, NO_GITHUB } from "./github-app-fake.js";

/** How a local agent is opened: in the repository the installation given reaches, on the harness given, and on its starter's own Anthropic API key where asked. */
export interface LocalAgentOptions {
  /** The installation reaching the repository it works in, connected to its task's workspace; none for an agent in no repository. */
  readonly installation?: InstallationFixture;
  /** The harness its conversation runs on, as Start records it; the store's own where none is named. */
  readonly runtime?: ConversationRuntime;
  /** Whether its starter saved an Anthropic API key, and the agent started to run on it, as Start chooses it then. */
  readonly onApiKey?: boolean;
  /** How its repository is reached, as Start records it; the App's where none is named. */
  readonly githubAccess?: GitHubAccess;
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
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    const deviceId = randomUUID();
    yield* registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });
    if (options.onApiKey === true) {
      yield* connectAgentApiKeys(userId, { providers: [PROVIDER_KEY_PROVIDER.ANTHROPIC] });
    }
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
      descriptionSnapshot: "# Invitations\n",
      prompt: null,
      repository,
      machine: AGENT_MACHINE.DEVICE,
      deviceId,
      runtime: options.runtime ?? CONVERSATION_RUNTIME.CLAUDE_CODE,
      ...(options.onApiKey === true ? { payer: AGENT_PAYER.API_KEY } : undefined),
      githubAccess: options.githubAccess,
    });
    const { agent } = Option.getOrThrow(started);
    const session = `cc-${randomUUID()}`;
    yield* db
      .update(conversations)
      .set({ runtimeSessionId: session })
      .where(eq(conversations.id, agent.conversationId));
    return { userId, deviceId, agent, session };
  });

/** What the sessions reach beside the store and the deployment's environment: the Mac's machine, and no GitHub or image, which a Mac's launch in no repository never asks. */
const LOCAL_AGENT_SERVICES = Layer.mergeAll(
  Layer.effect(AgentMachine, deviceMachine),
  NO_GITHUB,
  Layer.succeed(AgentImage, { reference: Effect.die(new Error("a Mac opens no image")) }),
);

/**
 * The account's Claude Code sessions over its Macs alone, which launch a
 * local agent's runner and write its messages as lines its Mac follows,
 * each launch numbering its events from naught.
 */
export const localAgentSessions = (userId: string) =>
  claudeCodeSessions({
    userId,
    eventsUrl: "https://app.test/api/agents/runner/events",
    linesUrl: "https://app.test/api/agents/runner-lines",
    mcpUrl: "https://app.test/api/agents/mcp",
    integrations: () => Effect.succeed([]),
    instructions: () => Effect.succeed("You are a Vespin coding agent."),
    nextSequence: () => Effect.succeed(0),
  }).pipe(Effect.provide(LOCAL_AGENT_SERVICES)) satisfies Effect.Effect<
    unknown,
    never,
    DatabaseServices | HostedEnvironment
  >;

/** The deployment's environment a local agent's launch is sealed under, and its saved keys opened with: a key ring, and nothing else. */
export const LOCAL_AGENT_ENVIRONMENT = Layer.succeed(HostedEnvironment, {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: AGENT_KEY_RING,
  titleAnthropicApiKey: undefined,
});

/** The developer's message as the store hands it to the agent's sessions. */
export const typedMessage = (agent: Agent, text: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
});

/**
 * A local agent on its starter's API key whose Start launched its runner,
 * which its Mac took, and whose first turn then settled, as its IDLE's
 * batch writes it: the agent, its sessions, the session its Start claimed,
 * and the turn that settled.
 */
export const warmLocalAgent = Effect.gen(function* () {
  const db = yield* Database;
  const opened = yield* openLocalAgent({
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    onApiKey: true,
  });
  const { userId, deviceId, agent } = opened;
  const sessions = yield* localAgentSessions(userId);
  const started = yield* sessions.open(typedMessage(agent, "Fix the invitations."));
  assert.ok(started.outcome === EVE_SEND_OUTCOME.ACCEPTED);
  const { sessionId } = started;
  // The agent's record names the session, as its Start claims it.
  yield* db
    .update(conversations)
    .set({ runtimeSessionId: sessionId })
    .where(eq(conversations.id, agent.conversationId));
  const [launch] = yield* deviceAgentLinesWaiting(userId, deviceId);
  assert.equal(launch?.kind, DEVICE_AGENT_LINE_KIND.LAUNCH);
  yield* claimedDeviceAgentLine(userId, deviceId, launch.id);
  const settledAt = yield* DateTime.nowAsDate;
  const [settled] = yield* db
    .insert(turns)
    .values({
      userId,
      conversationId: agent.conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: settledAt,
      settledAt,
    })
    .returning({ id: turns.id });
  assert.ok(settled !== undefined);
  return { ...opened, sessions, sessionId, turnId: settled.id };
});

export type WarmLocalAgent = Effect.Success<typeof warmLocalAgent>;

/** A line of the developer's that no turn took yet, written as the store writes it before it hands the line to the agent's sessions. */
export const lineWritten = (warm: WarmLocalAgent, text: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(messages).values({
      id: randomUUID(),
      userId: warm.userId,
      conversationId: warm.agent.conversationId,
      seq: 1,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text }],
      createdAt: now,
      placedAt: now,
    });
  });

/** What the agent's Mac has yet to take, line by line: a message line by the text it carries, any other by its kind. */
export const linesWaiting = (warm: WarmLocalAgent) =>
  Effect.map(deviceAgentLinesWaiting(warm.userId, warm.deviceId), (lines) =>
    lines.map((line) =>
      line.kind === DEVICE_AGENT_LINE_KIND.MESSAGE ? String(line.payload.text) : line.kind,
    ),
  );

/** Whether the newest launch line waiting for the agent's Mac carries the text given among its first lines, which its sealed secrets hold and its Mac's claim opens. */
export const launchCarries = (warm: WarmLocalAgent, text: string) =>
  Effect.gen(function* () {
    const waiting = yield* deviceAgentLinesWaiting(warm.userId, warm.deviceId);
    const launch = waiting.filter((line) => line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH).at(-1);
    if (launch === undefined) return false;
    const claimed = yield* claimedDeviceAgentLine(warm.userId, warm.deviceId, launch.id);
    const opened = Option.map(claimed, (line) => ("secrets" in line ? line.secrets : null));
    return JSON.stringify(Option.getOrNull(opened)).includes(text);
  });
