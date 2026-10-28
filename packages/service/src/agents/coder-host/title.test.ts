import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { type Agent, createAgent, readAgent, renameAgent } from "@luke/database/models/agent-store";
import { createTask, readTask } from "@luke/database/models/task-store";
import { messages } from "@luke/database/schemas/storage";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { firstMessageText, REPLAY_STEP_KIND } from "@luke/features/agent-replay";
import { AGENT_KIND } from "@luke/features/agent-wire";
import { AUTOMATION_FIRING, GITHUB_TRIGGER_EVENT } from "@luke/features/automation-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { MockLanguageModelV4 } from "ai/test";
import { Clock, Effect, Option } from "effect";
import { TURN_TRIGGER, userMetadataOf } from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { titleNativeAgent } from "../native-events/native-title.js";
import { titleCodingAgent } from "./title.js";

/**
 * title.test.ts -- an automation's run is named from the automation's prompt
 * alone, without the lines Luke adds of the firing, and the subject of the
 * GitHub event that fired it; an agent started from another is named from
 * its brief and note, never the replay between them; the model's answer is
 * the agent's title, and the name of its task where that still stands
 * untitled; and an account with no API key is titled from its opening's
 * first words, with no model. The
 * model is a script that keeps what it was asked; the store is PGlite.
 * Synthetic throughout.
 */

/** The automation's prompt, long enough to fill the title model's excerpt by itself. */
const PROMPT = `Find the flakiest test in CI this week and fix it. ${"Read every failed run. ".repeat(120)}`;

/** What the agent was handed: the prompt, then what Luke adds of the firing. */
const HANDED = `${PROMPT}\n\n---\n\nLuke started this run for the automation "Flaky-test sweep" because commits were pushed on GitHub.`;

/** The deployment's environment, which holds no model key of Luke's for a title to spend. */
const DEPLOYMENT_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

/** A model answering every call with `title`, keeping each prompt it was asked. */
function scriptedTitleModel(title: string) {
  const asked: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      asked.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: title }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, asked };
}

/** The agent's session opened on `prompt`, as eve records it. */
const openedOn = (owner: string, agent: Agent, prompt: string) =>
  Effect.gen(function* () {
    const placedAt = new Date(yield* Clock.currentTimeMillis);
    yield* Database.use((db) =>
      db.insert(messages).values({
        userId: owner,
        conversationId: agent.conversationId,
        seq: 1,
        clientId: randomUUID(),
        role: MESSAGE_ROLE.USER,
        parts: [{ type: "text", text: prompt }],
        metadata: userMetadataOf(TURN_TRIGGER.ASK),
        placedAt,
      }),
    );
    return agent;
  });

/** An agent started on the task with `prompt`, its session opened on the prompt as eve records it. */
const startOnTask = (owner: string, taskId: string, prompt: string) =>
  Effect.gen(function* () {
    const started = Option.getOrThrow(
      yield* createAgent(owner, {
        taskId,
        planSnapshot: null,
        prompt,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: "acme/relay",
      }),
    );
    return yield* openedOn(owner, started.agent, prompt);
  });

/** The agent titled by a model answering `title`. */
const titledAs = (owner: string, agent: Agent, title: string) =>
  titleCodingAgent(
    scriptedTitleModel(title).model,
    { userId: owner, conversationId: agent.conversationId },
    agent,
  );

/** The task's name as the account reads it. */
const taskName = (owner: string, taskId: string) =>
  Effect.map(readTask(owner, taskId), (read) => Option.getOrThrow(read).task.name);

it.layer(getTestDB())("an untitled task's name", (it) => {
  it.effect("an untitled task takes its first titled agent's title, and keeps it", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const organizationId = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId });
      const first = yield* startOnTask(owner, task.id, "Expire teammate invitations after a week.");
      const second = yield* startOnTask(owner, task.id, "Send a reminder the day before.");

      yield* titledAs(owner, first, "Expire teammate invitations");
      yield* titledAs(owner, second, "Send invitation reminders");

      assert.equal(yield* taskName(owner, task.id), "Expire teammate invitations");
      const secondTitled = Option.getOrThrow(yield* readAgent(owner, second.id));
      assert.equal(secondTitled.title, "Send invitation reminders");
    }),
  );

  it.effect("a model answering the untitled name names neither the agent nor its task", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const organizationId = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId });
      const first = yield* startOnTask(owner, task.id, "Expire teammate invitations after a week.");
      const second = yield* startOnTask(owner, task.id, "Send a reminder the day before.");

      yield* titledAs(owner, first, "<Untitled>.");
      yield* titledAs(owner, second, "Send invitation reminders");

      assert.equal(Option.getOrThrow(yield* readAgent(owner, first.id)).title, null);
      assert.equal(yield* taskName(owner, task.id), "Send invitation reminders");
    }),
  );

  it.effect("a task named by a member keeps its name when its agent is titled", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const organizationId = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId, name: "Invitations" });
      const agent = yield* startOnTask(owner, task.id, "Expire teammate invitations after a week.");

      yield* titledAs(owner, agent, "Expire teammate invitations");

      assert.equal(yield* taskName(owner, task.id), "Invitations");
    }),
  );

  it.effect("an agent the developer titled by hand meanwhile names no task", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const organizationId = yield* openWorkspace(owner);
      const task = yield* createTask(owner, { organizationId });
      const agent = yield* startOnTask(owner, task.id, "Expire teammate invitations after a week.");
      yield* renameAgent(owner, agent.id, "My invitations agent");

      // The agent as the host read it before the developer's title landed.
      yield* titledAs(owner, agent, "Expire teammate invitations");

      assert.equal(yield* taskName(owner, task.id), "Untitled");
    }),
  );
});

it.layer(getTestDB())("an operator's title", (it) => {
  it.effect("an operator is never titled, so no read that takes the plain title names it", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const organizationId = yield* openWorkspace(owner);
      const started = Option.getOrThrow(
        yield* createAgent(owner, {
          taskId: null,
          organizationId,
          planSnapshot: null,
          prompt: null,
          kind: AGENT_KIND.OPERATOR,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: null,
        }),
      );
      const operator = yield* openedOn(
        owner,
        started.agent,
        "Read my open work and say what stands.",
      );

      yield* titledAs(owner, operator, "Review open work");

      const read = Option.getOrThrow(yield* readAgent(owner, operator.id));
      assert.equal(read.title, null);
    }),
  );
});

it.layer(getTestDB())("an agent's title", (it) => {
  it.effect(
    "an account that saved no API key is titled with no model, from the first words of its opening's first line, its Markdown marks and links' addresses left out, opening on a capital and the rest as written, and its task named with it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const organizationId = yield* openWorkspace(owner);
        const task = yield* createTask(owner, { organizationId });
        const prompted = yield* startOnTask(
          owner,
          task.id,
          "Expire teammate invitations after one week, and email the inviter.",
        );
        const planned = yield* startOnTask(
          owner,
          task.id,
          "\n# Teammate [invitations](https://example.test/plan) by **email**\n\n## Goal\n\nInvite a teammate.",
        );
        const lowered = yield* startOnTask(
          owner,
          task.id,
          "fix the `invite` link in **README** and the docs",
        );

        for (const agent of [prompted, planned, lowered]) {
          yield* titleCodingAgent(
            undefined,
            { userId: owner, conversationId: agent.conversationId },
            agent,
          );
        }

        const titleOf = (agent: Agent) =>
          Effect.map(readAgent(owner, agent.id), (read) => Option.getOrThrow(read).title);
        assert.equal(yield* titleOf(prompted), "Expire teammate invitations after one week");
        assert.equal(yield* titleOf(planned), "Teammate invitations by email");
        assert.equal(yield* titleOf(lowered), "Fix the invite link in README");
        assert.equal(yield* taskName(owner, task.id), "Expire teammate invitations after one week");
      }),
  );

  it.effect(
    "a native agent of an account that saved no API key is titled from its opening's first words, never on Luke's key",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const organizationId = yield* openWorkspace(owner);
        const task = yield* createTask(owner, { organizationId });
        const agent = yield* startOnTask(
          owner,
          task.id,
          "Retry [the invite email](https://example.test/mail_(draft)) when the provider times out.",
        );

        yield* titleNativeAgent(
          { userId: owner, conversationId: agent.conversationId },
          agent,
        ).pipe(Effect.provideService(HostedEnvironment, DEPLOYMENT_ENVIRONMENT));

        const titled = Option.getOrThrow(yield* readAgent(owner, agent.id));
        assert.equal(titled.title, "Retry the invite email when the");
      }),
  );

  it.effect(
    "an automation's run is named from the automation's prompt alone and the event's subject, never Luke's lines",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const organizationId = yield* openWorkspace(owner);
        const started = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: null,
            organizationId,
            planSnapshot: null,
            prompt: HANDED,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            automationOrigin: {
              name: "Flaky-test sweep",
              firing: {
                kind: AUTOMATION_FIRING.GITHUB,
                event: GITHUB_TRIGGER_EVENT.PUSH,
                repository: "acme/relay",
                branch: "release/2.4",
              },
              prompt: PROMPT,
            },
          }),
        );
        // The session opened on the handed prompt, as eve records an agent's first message.
        yield* Database.use((db) =>
          db.insert(messages).values({
            userId: owner,
            conversationId: started.agent.conversationId,
            seq: 1,
            clientId: randomUUID(),
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: HANDED }],
            placedAt: new Date(),
          }),
        );
        const { model, asked } = scriptedTitleModel("Fix the flakiest CI test");

        yield* titleCodingAgent(
          model,
          { userId: owner, conversationId: started.agent.conversationId },
          started.agent,
        );
        const titled = Option.getOrThrow(yield* readAgent(owner, started.agent.id));

        assert.match(asked[0] ?? "", /Find the flakiest test in CI this week/u);
        assert.match(asked[0] ?? "", /release\/2\.4/u, "the subject survives a long prompt");
        assert.doesNotMatch(asked[0] ?? "", /Luke started this run/u);
        assert.equal(titled.title, "Fix the flakiest CI test");
      }),
  );

  it.effect(
    "an agent started from another is named from its brief and the note after the replay, never the replay",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const organizationId = yield* openWorkspace(owner);
        const handed = firstMessageText(
          "Expire teammate invitations after a week.",
          {
            agentId: randomUUID(),
            preamble: "You continue the work of another agent.",
            steps: [
              {
                kind: REPLAY_STEP_KIND.SAID,
                summary: "Said: Rewrote billing.",
                words: "Rewrote billing.",
              },
            ],
            totalSteps: 1,
          },
          "Also send a reminder the day before.",
        );
        const started = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: null,
            organizationId,
            planSnapshot: null,
            prompt: handed,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
          }),
        );
        yield* Database.use((db) =>
          db.insert(messages).values({
            userId: owner,
            conversationId: started.agent.conversationId,
            seq: 1,
            clientId: randomUUID(),
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: handed }],
            metadata: userMetadataOf(TURN_TRIGGER.ASK),
            placedAt: new Date(),
          }),
        );
        const { model, asked } = scriptedTitleModel("Expire invitations with a reminder");

        yield* titleCodingAgent(
          model,
          { userId: owner, conversationId: started.agent.conversationId },
          started.agent,
        );

        const titled = Option.getOrThrow(yield* readAgent(owner, started.agent.id));
        assert.equal(titled.title, "Expire invitations with a reminder");
        assert.match(asked[0] ?? "", /Expire teammate invitations after a week/u);
        assert.match(asked[0] ?? "", /Also send a reminder the day before/u);
        assert.doesNotMatch(asked[0] ?? "", /billing|luke:replay|You continue the work/u);
      }),
  );
});
