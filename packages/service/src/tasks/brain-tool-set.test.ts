import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import { readStoredUIMessagesEither } from "@luke/wire/ui-messages";
import { Effect, Result } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
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

it.effect(
  "an archive, an unarchive, and a move into a section journaled under the tools since folded into update_agent and update_task read back as stored, on the brain's set and a coding agent's alike",
  () =>
    Effect.gen(function* () {
      const journaled = [
        startedWith({ agentId: "agent-2", reason: "Merged." }, RETIRED_TOOL.ARCHIVE_AGENT),
        startedWith({ agentId: "agent-2" }, RETIRED_TOOL.UNARCHIVE_AGENT),
        startedWith({ taskId: "task-2", sectionId: "section-1" }, RETIRED_TOOL.MOVE_TASK),
      ];
      for (const tools of [HOSTED_TOOL_SET, CODER_TOOL_SET]) {
        const read = yield* readStoredUIMessagesEither(journaled, tools);
        assert.ok(Result.isSuccess(read), JSON.stringify(read));
        assert.deepEqual(
          read.success.map((message) => message.parts.map((part) => part.type)),
          [
            [`tool-${RETIRED_TOOL.ARCHIVE_AGENT}`],
            [`tool-${RETIRED_TOOL.UNARCHIVE_AGENT}`],
            [`tool-${RETIRED_TOOL.MOVE_TASK}`],
          ],
        );
      }
    }),
);
