import assert from "node:assert/strict";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
import { test } from "vitest";
import { BRAIN_TOOL } from "./names.js";
import { REFUSAL_REASON } from "./refusals.js";
import {
  type BrainWorkspaceAccess,
  WORKSPACE_TOOLS,
  type WorkspaceToolContext,
  workspaceToolNamed,
} from "./workspace-tools.js";

/** A turn's standing over the workspace given, none included, under a journal that counts what it was asked to record. */
function context(access: { workspace: BrainWorkspaceAccess | undefined }) {
  const { workspace } = access;
  let journaled = 0;
  const ctx: WorkspaceToolContext = {
    conversationId: MAIN_SESSION_KEY,
    turnId: "run-1",
    runId: "run-1",
    origin: RUN_ORIGIN.USER,
    isRevoked: () => false,
    signal: new AbortController().signal,
    workspace,
    journal: (effect) =>
      Effect.flatMap(
        Effect.sync(() => {
          journaled += 1;
        }),
        () => effect,
      ),
  };
  return { ctx, journaled: () => journaled };
}

function fakeWorkspace() {
  const written: [string, string][] = [];
  const workspace: BrainWorkspaceAccess = {
    read: async (name) => ({ ok: true, content: `content of ${name}` }),
    write: async (name, content) => {
      written.push([name, content]);
      return { ok: true, chars: content.length };
    },
    loadSkill: async () => ({ ok: true, instructions: "do it", truncated: false }),
  };
  return { workspace, written };
}

test("the three workspace tools are modules in catalog order, each naming the strings it takes", () => {
  assert.deepEqual(
    WORKSPACE_TOOLS.map((tool) => tool.name),
    [BRAIN_TOOL.READ_WORKSPACE_FILE, BRAIN_TOOL.WRITE_WORKSPACE_FILE, BRAIN_TOOL.LOAD_SKILL],
  );
  for (const tool of WORKSPACE_TOOLS) assert.equal(workspaceToolNamed(tool.name), tool);
  const required = WORKSPACE_TOOLS.map((tool) => {
    const node = emitJsonSchema(tool.inputSchema);
    return "required" in node ? [...node.required] : [];
  });
  assert.deepEqual(required, [["name"], ["name", "content"], ["location"]]);
});

test("a write whose arguments are not the strings the tool takes is refused before the journal is asked, and the file is untouched", async () => {
  const { workspace, written } = fakeWorkspace();
  const { ctx, journaled } = context({ workspace });
  const write = workspaceToolNamed(BRAIN_TOOL.WRITE_WORKSPACE_FILE);
  assert.ok(write);
  const malformed: readonly WireRecord[] = [
    { name: "MEMORY.md" },
    { content: "words" },
    { name: 7, content: "words" },
    { name: "MEMORY.md", content: null },
  ];
  for (const input of malformed) {
    const refused: WireRecord = await Effect.runPromise(write.execute(input, ctx));
    assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(refused.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
  }
  assert.equal(journaled(), 0);
  assert.deepEqual(written, []);
  const landed = await Effect.runPromise(
    write.execute({ name: "MEMORY.md", content: "# MEMORY.md\n" }, ctx),
  );
  assert.deepEqual(landed, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    chars: "# MEMORY.md\n".length,
  });
  assert.equal(journaled(), 1);
  assert.deepEqual(written, [["MEMORY.md", "# MEMORY.md\n"]]);
});

test("the reads answer the host's access directly and never through the journal, and every tool refuses with no workspace", async () => {
  const { ctx, journaled } = context(fakeWorkspace());
  const read = workspaceToolNamed(BRAIN_TOOL.READ_WORKSPACE_FILE);
  const skill = workspaceToolNamed(BRAIN_TOOL.LOAD_SKILL);
  assert.ok(read && skill);
  assert.deepEqual(await Effect.runPromise(read.execute({ name: "USER.md" }, ctx)), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    content: "content of USER.md",
  });
  assert.deepEqual(await Effect.runPromise(skill.execute({ location: "skills/x/SKILL.md" }, ctx)), {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    instructions: "do it",
    truncated: false,
  });
  assert.equal(
    (await Effect.runPromise(read.execute({}, ctx))).reason,
    REFUSAL_REASON.MALFORMED_ARGUMENTS,
  );
  assert.equal(
    (await Effect.runPromise(skill.execute({ location: 3 }, ctx))).reason,
    REFUSAL_REASON.MALFORMED_ARGUMENTS,
  );
  assert.equal(journaled(), 0);
  const without = context({ workspace: undefined });
  for (const tool of WORKSPACE_TOOLS) {
    const refused = await Effect.runPromise(
      tool.execute({ name: "USER.md", content: "", location: "l" }, without.ctx),
    );
    assert.equal(refused.reason, REFUSAL_REASON.NO_WORKSPACE);
  }
  assert.equal(without.journaled(), 0);
});
