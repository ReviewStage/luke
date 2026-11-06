import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  type Automation,
  attachRunAgent,
  createAutomation,
  recordAutomationRun,
} from "@repo/database/models/automation-store";
import {
  linkSlackInstallation,
  slackAgentThreadAt,
} from "@repo/database/models/slack-installation-store";
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
import { postTurnToSlack } from "../slack/slack-agent-starts.js";
import { SlackBot, SlackBotFailure, type SlackWebApi, slackBotOver } from "../slack/slack-bot.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { endedAt } from "../testing/agent-turns.js";

/**
 * An automation run's result sent to its owner on Slack as the store writer
 * settles its agent's turn, and the DM's thread kept as the agent's, over a
 * real store and Slack a fake at the bot's Web API, the writer told to hand
 * each settled turn to the Slack poster as the deployment's listener does.
 * Synthetic accounts, workspaces, and Slack ids.
 */

const T0 = new Date("2026-11-03T09:00:00Z").getTime();

const SLACK_USER = "U0001";

/** The DM conversation the bot writes the member in. */
const DM_CHANNEL = "D0001";

/** A Slack that knows every member by their email and writes down each message posted, by its arguments, each under a timestamp of its own. */
function recordingSlack() {
  const posted: Readonly<Record<string, string>>[] = [];
  const api: SlackWebApi = (method, args) => {
    switch (method) {
      case "users.lookupByEmail":
        return Effect.succeed({ ok: true, user: { id: SLACK_USER } });
      case "chat.postMessage":
        posted.push(args);
        return Effect.succeed({
          ok: true,
          channel: DM_CHANNEL,
          ts: `1700000000.${String(posted.length).padStart(6, "0")}`,
        });
      default:
        return Effect.fail(new SlackBotFailure({ method }));
    }
  };
  return { api, posted };
}

/** A started run of the automation, fired at the time given, sent to the agent. */
const runOn = (automation: Pick<Automation, "id" | "userId">, agentId: string, firedAt: number) =>
  Effect.gen(function* () {
    const run = Option.getOrThrow(
      yield* recordAutomationRun(automation, {
        dedupeKey: randomUUID(),
        firing: { kind: AUTOMATION_FIRING.MANUAL },
        firedAt: new Date(firedAt),
      }),
    );
    assert.ok(yield* attachRunAgent(run.id, agentId));
  });

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
        descriptionSnapshot: null,
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
    return { agent, automation, organizationId };
  });

it.layer(getTestDB())("an automation run's result sent on Slack", (it) => {
  it.effect(
    "a run that delivers to Slack sends its agent's final message to its owner once, as a markdown block with a link to the agent",
    () =>
      Effect.gen(function* () {
        const slack = recordingSlack();
        const bot = slackBotOver(slack.api);
        const { agent } = yield* openDeliveringRun();
        const delivering = Layer.succeed(SettledTurnListener, {
          heard: (turn) => postTurnToSlack(turn).pipe(Effect.provideService(SlackBot, bot)),
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
        assert.match(message.text ?? "", /^Email digest: /u);
        const blocks = JSON.parse(message.blocks ?? "[]");
        assert.deepEqual(blocks[1], {
          type: "markdown",
          text: "**3 threads** need you. See [the plan](https://vespin.dev/acme/plan/1).",
        });
        assert.ok(JSON.stringify(blocks).includes(`/agent/${agent.id}|Open in Vespin>`));

        // The settle heard again, as a retried batch would, sends nothing twice.
        yield* postTurnToSlack({
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

  it.effect(
    "a run's result DM is kept as its agent's thread, so the turn a reply there starts is answered under it and the next run is sent as a DM of its own",
    () =>
      Effect.gen(function* () {
        const slack = recordingSlack();
        const bot = slackBotOver(slack.api);
        const { agent, automation, organizationId } = yield* openDeliveringRun();
        const posting = Layer.succeed(SettledTurnListener, {
          heard: (turn) => postTurnToSlack(turn).pipe(Effect.provideService(SlackBot, bot)),
        });

        yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0, "Nothing needs you today.").pipe(
          Effect.provide(posting),
        );
        // The fake Slack answers the first message posted under this timestamp.
        const digest = "1700000000.000001";
        const kept = yield* slackAgentThreadAt(organizationId, DM_CHANNEL, digest);
        // The member's reply in the DM's thread starts a turn that is no run's.
        yield* endedAt(
          agent,
          RUN_STATUS.SUCCEEDED,
          T0 + 60_000,
          "Yes, black cold brew counts.",
        ).pipe(Effect.provide(posting));
        yield* runOn(automation, agent.id, T0 + 86_400_000);
        yield* endedAt(agent, RUN_STATUS.SUCCEEDED, T0 + 86_460_000, "Two threads need you.").pipe(
          Effect.provide(posting),
        );

        assert.deepEqual(
          Option.map(kept, (thread) => thread.agentId),
          Option.some(agent.id),
        );
        const [, answer, nextDigest, ...more] = slack.posted;
        assert.equal(more.length, 0);
        assert.equal(answer?.channel, DM_CHANNEL);
        assert.equal(answer?.thread_ts, digest);
        assert.match(answer?.text ?? "", /black cold brew/u);
        assert.equal(nextDigest?.channel, SLACK_USER);
        assert.equal(nextDigest?.thread_ts, undefined);
        assert.match(nextDigest?.text ?? "", /^Email digest: Two threads/u);
      }),
  );
});
