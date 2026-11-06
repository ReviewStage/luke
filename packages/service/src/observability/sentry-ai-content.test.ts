import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Sentry from "@sentry/effect";
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { recordingEveSentry, sentOfType } from "../testing/sentry-transport.js";

const CONTENT = {
  INSTRUCTIONS: "fixture-instructions-amber",
  PROMPT: "fixture-prompt-cobalt",
  TOOL_INPUT: "fixture-tool-input-jade",
  TOOL_RESULT: "fixture-tool-result-ochre",
  REPLY: "fixture-reply-umber",
} as const;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function modelCallingReadFile() {
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      return {
        content:
          calls === 1
            ? [
                {
                  type: "tool-call" as const,
                  toolCallId: "call-1",
                  toolName: "read_file",
                  input: JSON.stringify({ path: CONTENT.TOOL_INPUT }),
                },
              ]
            : [{ type: "text" as const, text: CONTENT.REPLY }],
        finishReason:
          calls === 1
            ? { unified: "tool-calls" as const, raw: "tool_use" }
            : { unified: "stop" as const, raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

it.effect("an agent's turn sends its spans to Sentry without the model's inputs or outputs", () =>
  Effect.gen(function* () {
    const sentry = recordingEveSentry();
    const answer = yield* Effect.gen(function* () {
      const result = yield* Effect.promise(() =>
        generateText({
          model: modelCallingReadFile(),
          system: CONTENT.INSTRUCTIONS,
          prompt: CONTENT.PROMPT,
          stopWhen: stepCountIs(3),
          experimental_telemetry: { isEnabled: true, recordInputs: true, recordOutputs: true },
          tools: {
            read_file: tool({
              inputSchema: jsonSchema<{ path: string }>({
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              }),
              execute: async (): Promise<string> => CONTENT.TOOL_RESULT,
            }),
          },
        }),
      );
      yield* Effect.promise(() => Sentry.flush(1_000));
      return result.text;
    }).pipe(Effect.provide(sentry.layer));
    assert.equal(answer, CONTENT.REPLY);
    const spans = sentOfType(sentry.sent, "span").map((item) => item.text);
    assert.ok(spans.some((text) => text.includes("read_file")));
    const leaked = Object.values(CONTENT).filter((words) =>
      sentry.sent.some((item) => item.text.includes(words)),
    );
    assert.deepEqual(leaked, []);
  }),
);
