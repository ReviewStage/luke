import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { type Agent, createAgent, readAgent, renameAgent } from "@repo/database/models/agent-store";
import { createTask, readTask } from "@repo/database/models/task-store";
import { storeWriter } from "@repo/database/models/writer";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { firstMessageText, REPLAY_STEP_KIND } from "@repo/features/agent-replay";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { AUTOMATION_FIRING, GITHUB_TRIGGER_EVENT } from "@repo/features/automation-wire";
import { sessionKey } from "@repo/runtime/vocabulary";
import { MESSAGE_ROLE } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { MockLanguageModelV4 } from "ai/test";
import { Clock, Effect, Option, Result } from "effect";
import {
  AssistantMessageBuilder,
  MESSAGE_CHANNEL,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  TURN_ORIGIN,
  TURN_TRIGGER,
  userMetadataOf,
} from "../../core.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { titleNativeAgent } from "../native-events/native-title.js";
import { titleAgent } from "./title.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/**
 * title.test.ts -- an automation's run is named from the automation's prompt
 * alone, without the lines we add of the firing, and the subject of the
 * GitHub event that fired it; an agent started from another is named from
 * its brief and note, never the replay between them; the model's answer is
 * the agent's title, and the name of its task where that still stands
 * untitled; a message to the Slack bot is named from its member's words
 * alone; and an account with no API key is titled from its opening's
 * first words, with no model. The
 * model is a script that keeps what it was asked; the store is PGlite.
 * Synthetic throughout.
 */

/** The automation's prompt, long enough to fill the title model's excerpt by itself. */
const PROMPT = `Find the flakiest test in CI this week and fix it. ${"Read every failed run. ".repeat(120)}`;

/** What the agent was handed: the prompt, then what we add of the firing. */
const HANDED = `${PROMPT}\n\n---\n\nLuke started this run for the automation "Flaky-test sweep" because commits were pushed on GitHub.`;

/** The deployment's environment, which holds no model key of ours for a title to spend. */
const DEPLOYMENT_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
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
        descriptionSnapshot: null,
        prompt,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: "acme/relay",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      }),
    );
    return yield* openedOn(owner, started.agent, prompt);
  });

/** The agent titled by a model answering `title`. */
const titledAs = (owner: string, agent: Agent, title: string) =>
  titleAgent(
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
          yield* titleAgent(
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
    "a native agent of an account that saved no API key is titled from its opening's first words, never on Vespin's key",
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
    "an automation's run is named from the automation's prompt alone and the event's subject, never Vespin's lines",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const organizationId = yield* openWorkspace(owner);
        const started = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: null,
            organizationId,
            descriptionSnapshot: null,
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
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
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

        yield* titleAgent(
          model,
          { userId: owner, conversationId: started.agent.conversationId },
          started.agent,
        );
        const titled = Option.getOrThrow(yield* readAgent(owner, started.agent.id));

        assert.match(asked[0] ?? "", /Find the flakiest test in CI this week/u);
        assert.match(asked[0] ?? "", /release\/2\.4/u, "the subject survives a long prompt");
        assert.doesNotMatch(asked[0] ?? "", /Vespin started this run/u);
        assert.equal(titled.title, "Fix the flakiest CI test");
      }),
  );

  it.effect(
    "a message to the Slack bot is named from its member's words alone, never the thread or what the agent is told of the reply",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const words = "Fix the flaky invite test";
        const handed = `${words}\n\n---\n\nA member wrote this to Vespin's Slack bot in a Slack thread.\n\n<slack-thread>\n<@U01>: the billing export is broken too\n</slack-thread>`;
        const { agent } = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: null,
            organizationId: yield* openWorkspace(owner),
            descriptionSnapshot: null,
            prompt: handed,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          }),
        );
        // The opening carries the Slack line the bot wrote, as a Start from Slack does.
        yield* Database.use((db) =>
          db.insert(messages).values({
            userId: owner,
            conversationId: agent.conversationId,
            seq: 1,
            clientId: randomUUID(),
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: handed }],
            metadata: { channel: MESSAGE_CHANNEL.SLACK, words },
            placedAt: new Date(),
          }),
        );
        const { model, asked } = scriptedTitleModel("Fix the flaky invite test");

        yield* titleAgent(model, { userId: owner, conversationId: agent.conversationId }, agent);

        assert.match(asked[0] ?? "", /Fix the flaky invite test/u);
        assert.doesNotMatch(asked[0] ?? "", /billing export|Slack bot/u);
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
            descriptionSnapshot: null,
            prompt: handed,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: "acme/relay",
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
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

        yield* titleAgent(
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

/** The developer's description, which an agent's first turn opens on. */
const DESCRIPTION_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

/** Another agent's message as `message_agent` steers one in: its words, which are no task of the developer's. */
const AGENT_MESSAGE =
  "Message · [@Invite emails](https://vespin.dev/acme/agent/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f) to you:\n\nThe invite table is mine, leave it.";

/** The agent that sends `AGENT_MESSAGE`, as its line's row keeps it. */
const MESSAGE_SENDING_AGENT = {
  kind: MESSAGE_SENDER.AGENT,
  agentId: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
  name: "Invite emails",
  model: "anthropic/claude-opus-5.5",
} as const;

/**
 * An agent of the owner's on Claude Code, and its conversation journaled as
 * the store writer journals a native harness's turns: lines written
 * awaiting their turn, taken by the turn that opens on them or one under
 * way, the agent's answers, and each turn's end.
 */
const journaledAgent = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const organizationId = yield* openWorkspace(owner);
  const started = yield* createAgent(owner, {
    taskId: null,
    organizationId,
    descriptionSnapshot: null,
    prompt: DESCRIPTION_TEXT,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });
  const agent = Option.getOrThrow(started).agent;
  const target = { userId: owner, conversationId: agent.conversationId };
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  let lines = 0;
  const sequences = new Map<string, number>();
  const next = (turnId: string) => {
    const sequence = (sequences.get(turnId) ?? 0) + 1;
    sequences.set(turnId, sequence);
    return { conversationId: sessionKey(target.conversationId), turnId, sequence };
  };
  /** A line written awaiting its turn, the developer's or another agent's message: its id. */
  const line = (sender: "developer" | "agent") =>
    Effect.gen(function* () {
      lines += 1;
      const clientKey = `line-${lines}`;
      const written = yield* writer.writeAwaitingLine(
        target,
        sender === "developer"
          ? {
              text: DESCRIPTION_TEXT,
              clientKey,
              sender: { kind: MESSAGE_SENDER.MEMBER, userId: owner },
            }
          : {
              text: AGENT_MESSAGE,
              clientKey,
              sender: MESSAGE_SENDING_AGENT,
              metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
            },
        Effect.succeed(true),
      );
      assert.ok(Result.isSuccess(written) && Option.isSome(written.success));
      return sentLineId(clientKey);
    });
  /** A turn opened, taking the line given first, which opens it. */
  const opened = (turnId: string, lineId: string) =>
    Effect.gen(function* () {
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: turnId });
      yield* writer.consume(target, {
        ...next(turnId),
        kind: RUN_EVENT.TURN_STARTED,
        origin: RUN_TURN_ORIGIN.TYPED,
        trigger: TURN_TRIGGER.ASK,
        at: 0,
      });
      yield* taken(turnId, lineId);
    });
  /** A line taken by the turn under way. */
  const taken = (turnId: string, lineId: string) =>
    Effect.map(writer.takeAwaitingLine(target, { clientId: lineId, turnId }), (took) =>
      assert.equal(Result.getOrUndefined(took)?.length, 1),
    );
  /** The turn's answer, a step for each of the words given, and its end. */
  const answered = (turnId: string, words: readonly string[]) =>
    Effect.gen(function* () {
      const answer = new AssistantMessageBuilder();
      for (const said of words) {
        answer.stepStart();
        answer.text(said);
      }
      yield* writer.consume(target, {
        ...next(turnId),
        kind: RUN_EVENT.MESSAGE_COMPLETED,
        message: answer.finish(randomUUID()),
      });
      yield* writer.consume(target, {
        ...next(turnId),
        kind: RUN_EVENT.TURN_ENDED,
        status: RUN_STATUS.SUCCEEDED,
        responseIds: [],
        at: 0,
      });
    });
  /** The agent's first turn: the developer's description, read and answered. */
  const firstTurn = Effect.gen(function* () {
    const turnId = randomUUID();
    yield* opened(turnId, yield* line("developer"));
    yield* answered(turnId, [
      "Read the guide first.",
      "The guide is read; the plan fits the code.",
    ]);
  });
  /** What a title model was asked when it named the agent. */
  const askedTitling = Effect.gen(function* () {
    const { model, asked } = scriptedTitleModel("Teammate invitations by email");
    yield* titleAgent(model, target, agent);
    return asked.join("\n");
  });
  return { owner, agent, line, opened, taken, answered, firstTurn, askedTitling };
});

it.layer(getTestDB())("a title named from the recent exchange", (it) => {
  it.effect(
    "another agent's message opening a turn of its own leaves the agent named from the developer's words and the answer to them alone",
    () =>
      Effect.gen(function* () {
        const journal = yield* journaledAgent;
        yield* journal.firstTurn;
        const noticed = randomUUID();
        yield* journal.opened(noticed, yield* journal.line("agent"));
        yield* journal.answered(noticed, ["Understood."]);

        const asked = yield* journal.askedTitling;

        assert.ok(asked.includes("Invite a teammate by email."), asked);
        assert.ok(!asked.includes("the invite table is mine"), asked);
        assert.ok(asked.includes("The guide is read; the plan fits the code."), asked);
        assert.ok(!asked.includes("Understood."), asked);
        const titled = Option.getOrThrow(yield* readAgent(journal.owner, journal.agent.id));
        assert.equal(titled.title, "Teammate invitations by email");
      }),
  );

  it.effect(
    "another agent's message steered into the developer's own turn leaves that turn's answer to name the agent from",
    () =>
      Effect.gen(function* () {
        const journal = yield* journaledAgent;
        const turnId = randomUUID();
        yield* journal.opened(turnId, yield* journal.line("developer"));
        yield* journal.taken(turnId, yield* journal.line("agent"));
        yield* journal.answered(turnId, ["The guide is read; the plan fits the code."]);

        const asked = yield* journal.askedTitling;

        assert.ok(asked.includes("The guide is read; the plan fits the code."), asked);
      }),
  );

  it.effect(
    "a title's recent window opening on agents' messages steered into the developer's turn keeps that turn's answer",
    () =>
      Effect.gen(function* () {
        const journal = yield* journaledAgent;
        const turnId = randomUUID();
        yield* journal.opened(turnId, yield* journal.line("developer"));
        // Eight messages steered in leave the developer's line before the recent window of eight.
        for (let at = 0; at < 8; at += 1) {
          yield* journal.taken(turnId, yield* journal.line("agent"));
        }
        yield* journal.answered(turnId, ["The guide is read; the plan fits the code."]);

        const asked = yield* journal.askedTitling;

        assert.ok(asked.includes("The guide is read; the plan fits the code."), asked);
      }),
  );

  it.effect(
    "a title's recent window opening on another agent's message leaves the answer to it out",
    () =>
      Effect.gen(function* () {
        const journal = yield* journaledAgent;
        yield* journal.firstTurn;
        // The second turn takes five messages in, the third one more, so the recent window of eight opens on a message.
        const second = randomUUID();
        yield* journal.opened(second, yield* journal.line("agent"));
        for (let at = 0; at < 4; at += 1) {
          yield* journal.taken(second, yield* journal.line("agent"));
        }
        yield* journal.answered(second, ["Understood."]);
        const third = randomUUID();
        yield* journal.opened(third, yield* journal.line("agent"));
        yield* journal.answered(third, ["Understood."]);

        const asked = yield* journal.askedTitling;

        assert.ok(asked.includes("Invite a teammate by email."), asked);
        assert.ok(!asked.includes("Understood."), asked);
      }),
  );

  it.effect(
    "a title leaves out the answer to a turn another agent's message opened, though the messages it took in push that message out of the recent window",
    () =>
      Effect.gen(function* () {
        const journal = yield* journaledAgent;
        yield* journal.firstTurn;
        // A message opens the second turn, and the eight it takes in mid-run leave it before the recent window of eight.
        const second = randomUUID();
        yield* journal.opened(second, yield* journal.line("agent"));
        for (let at = 0; at < 8; at += 1) {
          yield* journal.taken(second, yield* journal.line("agent"));
        }
        yield* journal.answered(second, ["Understood."]);

        const asked = yield* journal.askedTitling;

        assert.ok(asked.includes("Invite a teammate by email."), asked);
        assert.ok(!asked.includes("Understood."), asked);
      }),
  );
});
