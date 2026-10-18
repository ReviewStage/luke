import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Sentry from "@sentry/effect";
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { recordingEveSentry, sentOfType } from "../testing/sentry-transport.js";

/**
 * sentry-tool-errors.test.ts -- an agent's tool call that fails is answered
 * to the model, and Sentry keeps it as a breadcrumb rather than an issue.
 * Sentry is started as an eve root starts it, over the recording transport;
 * the model is a script. It stands in a file of its own because eve's start
 * installs process-wide integrations the web suite's tests do not expect.
 */

/** The exception values of every error event sent, by type. */
function exceptionTypes(sent: ReturnType<typeof recordingEveSentry>["sent"]): string[] {
  return sentOfType(sent, "event").flatMap((item) =>
    (item.payload.exception?.values ?? []).map((value) => value.type ?? ""),
  );
}

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that calls `read_file` once, then answers in words once it has read the call's result. */
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
                  input: JSON.stringify({ path: "/tmp/shots/compare.png" }),
                },
              ]
            : [{ type: "text" as const, text: "That file is not there." }],
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

it.effect(
  "a tool call that fails and is answered to the model is a breadcrumb, not an issue; a later crash still is",
  () =>
    Effect.gen(function* () {
      const sentry = recordingEveSentry();
      const answer = yield* Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          generateText({
            model: modelCallingReadFile(),
            prompt: "Show me the screenshot.",
            stopWhen: stepCountIs(3),
            tools: {
              read_file: tool({
                inputSchema: jsonSchema<{ path: string }>({
                  type: "object",
                  properties: { path: { type: "string" } },
                  required: ["path"],
                }),
                execute: async ({ path }): Promise<string> => {
                  throw new Error(`File not found: ${path}`);
                },
              }),
            },
          }),
        );
        // Note that an event is processed asynchronously, so the crash waits for the tool call's report to settle, as a crash seconds later would.
        yield* Effect.promise(() => Sentry.flush(1_000));
        Sentry.captureException(new RangeError("no such row"));
        return result.text;
      }).pipe(Effect.provide(sentry.layer));
      assert.equal(answer, "That file is not there.");
      assert.deepEqual(exceptionTypes(sentry.sent), ["RangeError"]);
      const [crash] = sentOfType(sentry.sent, "event");
      assert.ok(
        (crash?.payload.breadcrumbs ?? []).some(
          (crumb) =>
            crumb.category === "ai.tool" &&
            crumb.message === "read_file failed: Error: File not found: /tmp/shots/compare.png",
        ),
      );
    }),
);
