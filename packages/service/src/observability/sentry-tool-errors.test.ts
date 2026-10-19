/**
 * sentry-tool-errors.test.ts -- an agent's tool call that is refused is answered
 * to the model, and Sentry keeps it as a breadcrumb rather than an issue; one
 * that fails beneath the tool is still an issue.
 * Sentry is started as an eve root starts it, over the recording transport;
 * the model is a script. It stands in a file of its own because eve's start
 * installs process-wide integrations the web suite's tests do not expect.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Sentry from "@sentry/effect";
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { recordingEveSentry, sentOfType } from "../testing/sentry-transport.js";

/** The message of the error each error event sent reports, its causes left out (Sentry lists the error itself last). */
function exceptionValues(sent: ReturnType<typeof recordingEveSentry>["sent"]): string[] {
  return sentOfType(sent, "event").map(
    (item) => item.payload.exception?.values?.at(-1)?.value ?? "",
  );
}

/** A failure beneath a tool, of a class of its own, as the sandbox client's API error is. */
class SandboxApiError extends Error {}

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
  "a tool call that is refused and answered to the model is a breadcrumb, not an issue; a later crash still is",
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

/** A refusal explained `links` times over, each a bare `Error` whose cause is the one before. */
function refusalChain(links: number, words: string): Error {
  let failure = new Error(`${words} (1 of ${links})`);
  for (let link = 2; link <= links; link += 1)
    failure = new Error(`${words} (${link} of ${links})`, { cause: failure });
  return failure;
}

/** A model that calls each named tool once, then answers in words once it has read their results. */
function modelCalling(toolNames: readonly string[]) {
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      return {
        content:
          calls === 1
            ? toolNames.map((toolName, at) => ({
                type: "tool-call" as const,
                toolCallId: `call-${at}`,
                toolName,
                input: "{}",
              }))
            : [{ type: "text" as const, text: "Read it first, then wrote it." }],
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

it.effect("a tool's refusal is not an issue, and a failure beneath a tool still is", () =>
  Effect.gen(function* () {
    const sentry = recordingEveSentry();
    const refused = new Error("You must read file /workspace/plan.md before overwriting it.");
    const missing = new SandboxApiError("Status code 404 is not ok");
    // Note that a cause may loop back on its error, which must not keep the error from Sentry.
    const looping = new Error("The connection answered in circles.");
    looping.cause = looping;
    const throwing = (failure: Error) => async (): Promise<string> => {
      throw failure;
    };
    // Note that a refusal explained in a bare `Error` of its own, as `coder-host/files.ts` explains one, is a refusal still.
    const tools = {
      write_file: throwing(refused),
      apply_patch: throwing(new Error("Re-read the file.", { cause: refused })),
      bash: throwing(missing),
      read_file: throwing(new Error("The sandbox could not be read.", { cause: missing })),
      connection_execute: throwing(looping),
      // Note that the causes are read 5 deep: a refusal of 5 bare errors is a refusal, and one of 6 is reported.
      edit_file: throwing(refusalChain(5, "Patch contains overlapping file operations.")),
      grep: throwing(refusalChain(6, "The pattern did not parse.")),
      // Note that a bare `Error` carrying fields of its own is a failure beneath the tool, as `@vercel/sandbox` and undici throw one.
      glob: throwing(
        Object.assign(new Error("Status code 404 is not ok: sandbox not found"), {
          response: new Response(null, { status: 404 }),
        }),
      ),
      list_files: throwing(
        new Error("The listing was cut short.", {
          cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
        }),
      ),
    };
    const input = jsonSchema<Record<string, never>>({ type: "object", properties: {} });
    const answer = yield* Effect.promise(() =>
      generateText({
        model: modelCalling(Object.keys(tools)),
        prompt: "Write the plan down.",
        stopWhen: stepCountIs(3),
        tools: Object.fromEntries(
          Object.entries(tools).map(([name, execute]) => [
            name,
            tool({ inputSchema: input, execute }),
          ]),
        ),
      }),
    ).pipe(Effect.provide(sentry.layer));
    assert.equal(answer.text, "Read it first, then wrote it.");
    assert.deepEqual([...new Set(exceptionValues(sentry.sent))].sort(), [
      "Status code 404 is not ok",
      "Status code 404 is not ok: sandbox not found",
      "The connection answered in circles.",
      "The listing was cut short.",
      "The pattern did not parse. (6 of 6)",
      "The sandbox could not be read.",
    ]);
  }),
);
