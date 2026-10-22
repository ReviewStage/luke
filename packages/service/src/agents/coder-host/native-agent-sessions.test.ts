import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INPUT_LINE, type InputLine } from "@luke/agent-runner/protocol";
import { Database } from "@luke/database/core/query";
import {
  type CodingAgent,
  createCodingAgent,
  recordCodingAgentNativeSession,
} from "@luke/database/models/coding-agent-store";
import { parseKeyRing, sealProviderKey } from "@luke/database/models/provider-key-seal";
import { saveProviderKey } from "@luke/database/models/provider-key-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { afterEach, vi } from "vitest";
import { TURN_ORIGIN } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { GITHUB_APP_WITH_TOKENS } from "../../testing/github-app-fake.js";
import { fixtureToken, linesOf, runnerSandboxApi } from "../../testing/runner-sandbox-fake.js";
import { AgentSandboxImage } from "../agent-sandbox-image.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import { EVE_SEND_OUTCOME } from "../brain-host/eve-sessions.js";
import { runnerEnded } from "./claude-code-sessions.js";
import { nativeAgentSessionsLayer } from "./native-agent-sessions.js";
import { RunnerBundle } from "./runner-bundle.js";
import { NativeAgentSessions } from "./runtime-sessions.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * The conversation so far a native agent's fresh CLI session is handed, as
 * the deployment composes its sessions, over a real store and a fake of
 * Vercel Sandbox's API: nothing on a first launch over a conversation with
 * nothing said, nothing to a runner that runs, and what was said once the
 * snapshot expired and the CLI's own session went with it. Synthetic
 * accounts, tokens, and snapshot ids throughout.
 */

const RING = `1:${Buffer.alloc(32, 5).toString("base64")}`;
const CLI_SESSION = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const SEED_MARKER = "[conversation so far]";

const NO_KEYS: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
};

/** The deployment's native sessions over the fake Vercel given. */
function sessionsLayer(api: ReturnType<typeof runnerSandboxApi>) {
  const services = Layer.mergeAll(
    api.layer,
    GITHUB_APP_WITH_TOKENS,
    Layer.succeed(HostedEnvironment, NO_KEYS),
    Layer.succeed(AgentSandboxImage, {
      snapshotId: Effect.succeed(Option.some("snap_fixture_image")),
      snapshotGone: () => Effect.void,
    }),
    Layer.succeed(RunnerBundle, {
      contents: Effect.succeed(new TextEncoder().encode("// runner")),
    }),
  );
  return nativeAgentSessionsLayer({
    run: (effect) => Effect.runPromise(effect),
    origin: () => "https://luke.test",
  }).pipe(Layer.provide(services));
}

/** An account on its Claude plan with one agent on a task with no repository. */
const openAgent = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
  );
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    repository: null,
  });
  const ring = parseKeyRing(Redacted.make(RING));
  assert.ok(Result.isSuccess(ring));
  const owner = {
    userId,
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  };
  yield* saveProviderKey(
    userId,
    owner.provider,
    owner.kind,
    sealProviderKey(ring.success, owner, Redacted.make("sk-ant-oat01-fixture-plan-token")),
    "sk-ant-oat…oken",
    null,
    new Date(0),
  );
  return { userId, agent: Option.getOrThrow(started).agent };
});

/** The words a turn took, as the store keeps them once the runner's events have: a turn queued and the line taken into it. */
const said = (userId: string, agent: CodingAgent, text: string) =>
  Effect.gen(function* () {
    const target = { userId, conversationId: agent.conversationId };
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED });
    yield* writer.writeAwaitingLine(
      target,
      { text, clientKey: randomUUID(), sender: { kind: MESSAGE_SENDER.MEMBER, userId } },
      Effect.succeed(true),
    );
    yield* writer.takeAwaitingLine(target, { text, turnId });
  });

/** What each message line of every launch opened with, its first text block, in order. */
function openings(api: ReturnType<typeof runnerSandboxApi>): string[] {
  return api.commands.flatMap((command) =>
    (linesOf(command) as InputLine[]).flatMap((each) => {
      if (each.type !== INPUT_LINE.MESSAGE) return [];
      const [first] = each.content;
      return [first?.type === "text" ? first.text : ""];
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("a native agent's fresh session, as the deployment composes it", (it) => {
  it.effect(
    "a CLI session opened afresh after the snapshot expired is handed what was said, the line it opens on left out, and nothing is seeded before",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = runnerSandboxApi();
        const { userId, agent } = yield* openAgent;
        const native = yield* NativeAgentSessions.pipe(Effect.provide(sessionsLayer(api)));
        const sessions = yield* Option.getOrThrow(
          native.sessions(CONVERSATION_RUNTIME.CLAUDE_CODE, userId),
        );
        const typed = (text: string) => ({
          conversationId: agent.conversationId,
          turn: BRAIN_HOST_TURN.TYPED,
          message: text,
        });

        const opened = yield* sessions.open(typed("Fix the invitations."));
        assert.ok(opened.outcome === EVE_SEND_OUTCOME.ACCEPTED);
        yield* said(userId, agent, "Fix the invitations.");
        assert.equal(yield* recordCodingAgentNativeSession(userId, agent.id, CLI_SESSION), true);
        assert.equal(
          (yield* sessions.send(opened.sessionId, typed("Also the emails."))).outcome,
          EVE_SEND_OUTCOME.ACCEPTED,
        );
        yield* said(userId, agent, "Also the emails.");
        // The snapshot expires while the sandbox is stopped: the CLI's session is gone with it.
        yield* runnerEnded({
          target: { userId, conversationId: agent.conversationId },
          sessionId: opened.sessionId,
          sequence: 0,
        }).pipe(Effect.provide(api.layer));
        const [expired] = api.sandboxes;
        assert.ok(expired !== undefined);
        expired.snapshotExpired = true;
        assert.equal(
          (yield* sessions.send(opened.sessionId, typed("And the docs."))).outcome,
          EVE_SEND_OUTCOME.ACCEPTED,
        );

        const [first = "", emails = "", docs = ""] = openings(api);
        // Nothing was said before the first launch, and a running runner remembers for itself.
        assert.equal(first, "Fix the invitations.");
        assert.equal(emails, "Also the emails.");
        assert.ok(docs.startsWith(SEED_MARKER), docs);
        assert.ok(docs.includes("Fix the invitations.") && docs.includes("Also the emails."), docs);
        assert.ok(!docs.includes("And the docs."), docs);
      }),
  );
});
