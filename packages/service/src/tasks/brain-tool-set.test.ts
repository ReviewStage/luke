import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import { readStoredUIMessagesEither } from "@luke/wire/ui-messages";
import { Effect, Result } from "effect";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";

/** A turn's journal holding one answered start call, under the tool's name or the one it had, with the input given. */
function startedWith(input: Record<string, string>, tool: string = AGENT_TOOL.START_AGENT) {
  return {
    id: "journal-1",
    role: "assistant",
    metadata: { author: "brain" },
    parts: [
      {
        type: `tool-${tool}`,
        toolCallId: "call-1",
        state: "output-available",
        input,
        output: { status: "accepted" },
      },
    ],
  };
}

it.effect(
  "a start journaled with its prompt reads back as stored, and so do one journaled before the prompt had its name, its task kept for the desktop to name it by, and one journaled under the tool's earlier name",
  () =>
    Effect.gen(function* () {
      const read = yield* readStoredUIMessagesEither(
        [
          startedWith({ prompt: "Fix the invite email." }),
          startedWith({ task: "Fix the invite email." }),
          startedWith({ prompt: "Fix the invite email." }, RETIRED_TOOL.START_CODING_AGENT),
        ],
        HOSTED_TOOL_SET,
      );

      assert.ok(Result.isSuccess(read), JSON.stringify(read));
      assert.deepEqual(
        read.success.map((message) =>
          message.parts.map((part) => ("input" in part ? part.input : undefined)),
        ),
        [
          [{ prompt: "Fix the invite email." }],
          [{ task: "Fix the invite email." }],
          [{ prompt: "Fix the invite email." }],
        ],
      );
    }),
);
