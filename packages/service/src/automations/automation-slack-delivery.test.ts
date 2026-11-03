import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  attachRunAgent,
  createAutomation,
  recordAutomationRun,
} from "@repo/database/models/automation-store";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { SettledTurnListener } from "@repo/database/models/writer";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { RUN_STATUS } from "@repo/features/turn-run";
import { TURN_STATUS } from "@repo/wire";
import { Effect, Layer, Option } from "effect";
import { SlackBot, SlackBotFailure, type SlackWebApi, slackBotOver } from "../slack/slack-bot.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { endedAt } from "../testing/agent-turns.js";
import { deliverRunToSlack } from "./automation-slack-delivery.js";

/**
 * An automation run's result sent to its owner on Slack as the store writer
 * settles its agent's turn, over a real store and Slack a fake at the bot's
 * Web API, the writer told to hand each settled turn here as the
 * deployment's listener does. Synthetic accounts, workspaces, and Slack ids.
 */

const T0 = new Date("2026-11-03T09:00:00Z").getTime();

const SLACK_USER = "U0001";

/** A Slack that knows every member by their email and writes down each message posted, by its arguments. */
function recordingSlack() {
  const posted: Readonly<Record<string, string>>[] = [];
  const api: SlackWebApi = (method, args) => {
    switch (method) {
      case "users.lookupByEmail":
        return Effect.succeed({ ok: true, user: { id: SLACK_USER } });
      case "chat.postMessage":
        posted.push(args);
        return Effect.succeed({ ok: true, channel: "D0001", ts: "1700000000.000100" });
      default:
        return Effect.fail(new SlackBotFailure({ method }));
    }
  };
  return { api, posted };
}

/** A member of a fresh workspace whose Slack bot is connected, an automation of theirs that delivers to Slack, and the agent one run of it started. */
const openDeliveringRun = () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const member = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: member, name: "Test User", email: `${member}@app.test` });
    yield* connectAgentApiKeys(member);
    const organizationId = yield* openWorkspace(member);
    yield* linkSlackInstallation({
      organizationId,
      teamId: "T0001",
      teamName: "Team",
      userId: member,
    });
    const automation = Option.getOrThrow(
      yield* createAutomation(member, {
        organizationId,
        name: "Email digest",
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Digest my inbox." },
        guards: AUTOMATION_DEFAULT_GUARDS,
        nextRunAt: null,
        webhookSecretHash: null,
        slackDelivery: true,
      }),
    );
    const run = Option.getOrThrow(
      yield* recordAutomationRun(automation, {
        dedupeKey: randomUUID(),
        firing: { kind: AUTOMATION_FIRING.MANUAL },
        firedAt: new Date(T0 - 60_000),
      }),
    );
    const agent = Option.getOrThrow(
      yield* createAgent(member, {
        taskId: null,
        organizationId,
        planSnapshot: null,
        repository: null,
        prompt: "Digest my inbox.",
        idempotencyKey: randomUUID(),
        automationRunId: run.id,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        payer: AGENT_PAYER.API_KEY,
      }),
    ).agent;
    assert.ok(yield* attachRunAgent(run.id, agent.id));
    return agent;
  });

it.layer(getTestDB())("an automation run's result sent on Slack", (it) => {
  it.effect(
    "a run that delivers to Slack sends its agent's final message to its owner once, as mrkdwn with a link to the agent",
    () =>
      Effect.gen(function* () {
        const slack = recordingSlack();
        const bot = slackBotOver(slack.api);
        const agent = yield* openDeliveringRun();
        const delivering = Layer.succeed(SettledTurnListener, {
          heard: (turn) => deliverRunToSlack(turn).pipe(Effect.provideService(SlackBot, bot)),
        });

        const turnId = yield* endedAt(
          agent,
          RUN_STATUS.SUCCEEDED,
          T0,
          "**3 threads** need you. See [the plan](https://vespin.dev/acme/plan/1).",
        ).pipe(Effect.provide(delivering));

        const [message, ...more] = slack.posted;
        assert.equal(more.length, 0);
        assert.ok(message !== undefined);
        assert.equal(message.channel, SLACK_USER);
        assert.ok(message.text?.startsWith("Email digest: "), message.text);
        const blocks = JSON.stringify(JSON.parse(message.blocks ?? "[]"));
        assert.ok(
          blocks.includes("*3 threads* need you. See <https://vespin.dev/acme/plan/1|the plan>."),
          blocks,
        );
        assert.ok(blocks.includes(`/agent/${agent.id}|Open in Vespin>`), blocks);

        // The settle heard again, as a retried batch would, sends nothing twice.
        yield* deliverRunToSlack({
          userId: agent.userId,
          conversationId: agent.conversationId,
          turnId,
          status: TURN_STATUS.SETTLED,
          failure: null,
          ranMs: 1,
        }).pipe(Effect.provideService(SlackBot, bot));
        assert.equal(slack.posted.length, 1);
      }),
  );
});
