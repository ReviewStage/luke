import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent, readCodingAgent } from "@luke/database/models/coding-agent-store";
import { messages } from "@luke/database/schemas/storage";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { AUTOMATION_FIRING, GITHUB_TRIGGER_EVENT } from "@luke/features/automation-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { MockLanguageModelV4 } from "ai/test";
import { Effect, Option } from "effect";
import { openGithubUser } from "../../testing/github-app-fake.js";
import { titleCodingAgent } from "./title.js";

/**
 * title.test.ts -- an automation's run is named from the automation's prompt
 * alone, without the lines Luke adds of the firing, and the subject of the
 * GitHub event that fired it; the model's answer is the agent's title. The
 * model is a script that keeps what it was asked; the store is PGlite.
 * Synthetic throughout.
 */

/** The automation's prompt, long enough to fill the title model's excerpt by itself. */
const PROMPT = `Find the flakiest test in CI this week and fix it. ${"Read every failed run. ".repeat(120)}`;

/** What the agent was handed: the prompt, then what Luke adds of the firing. */
const HANDED = `${PROMPT}\n\n---\n\nLuke started this run for the automation "Flaky-test sweep" because commits were pushed on GitHub.`;

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

it.layer(getTestDB())("an agent's title", (it) => {
  it.effect(
    "an automation's run is named from the automation's prompt alone and the event's subject, never Luke's lines",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const organizationId = yield* openWorkspace(owner);
        const started = Option.getOrThrow(
          yield* createCodingAgent(owner, {
            planId: null,
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
        const titled = Option.getOrThrow(yield* readCodingAgent(owner, started.agent.id));

        assert.equal(asked.length, 1);
        assert.match(asked[0] ?? "", /Find the flakiest test in CI this week/u);
        assert.match(asked[0] ?? "", /release\/2\.4/u, "the subject survives a long prompt");
        assert.doesNotMatch(asked[0] ?? "", /Luke started this run/u);
        assert.equal(titled.title, "Fix the flakiest CI test");
      }),
  );
});
