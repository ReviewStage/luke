import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type DailyNoteListing, WORKSPACE_FILE_REFUSAL } from "@sidecar/runtime";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect, Result } from "effect";
import { BRAIN_TOOL, maximumListedDailyNotes } from "./names.js";
import { REFUSAL_REASON } from "./refusals.js";
import {
  type BrainWorkspaceAccess,
  WORKSPACE_TOOLS,
  type WorkspaceToolContext,
  type WorkspaceToolModule,
} from "./workspace-tools.js";

function workspaceToolNamed(name: string): WorkspaceToolModule | undefined {
  return WORKSPACE_TOOLS.find((tool) => tool.name === name);
}

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

const TODAY = "memory/2026-09-15.md";

const LISTED: readonly DailyNoteListing[] = [
  { path: "memory/2026-09-15.md", chars: 120 },
  { path: "memory/2026-09-14.md", chars: 8 },
];

function fakeWorkspace() {
  const written: [string, string][] = [];
  const appended: string[] = [];
  const listed: number[] = [];
  const workspace: BrainWorkspaceAccess = {
    read: (name) => Effect.succeed(Result.succeed({ content: `content of ${name}` })),
    write: (name, content) =>
      Effect.sync(() => {
        written.push([name, content]);
        return Result.succeed({ chars: content.length });
      }),
    append: (entry) =>
      Effect.sync(() => {
        appended.push(entry);
        return Result.succeed({ path: TODAY, chars: appended.join("\n\n").length });
      }),
    listNotes: (limit) =>
      Effect.sync(() => {
        listed.push(limit);
        return LISTED;
      }),
    loadSkill: () => Effect.succeed({ ok: true, instructions: "do it", truncated: false }),
  };
  return { workspace, written, appended, listed };
}

it("the five workspace tools are modules in catalog order, each naming the strings it takes", () => {
  assert.deepEqual(
    WORKSPACE_TOOLS.map((tool) => tool.name),
    [
      BRAIN_TOOL.READ_WORKSPACE_FILE,
      BRAIN_TOOL.WRITE_WORKSPACE_FILE,
      BRAIN_TOOL.APPEND_DAILY_NOTE,
      BRAIN_TOOL.LIST_DAILY_NOTES,
      BRAIN_TOOL.LOAD_SKILL,
    ],
  );
  const required = WORKSPACE_TOOLS.map((tool) => {
    const node = emitJsonSchema(tool.inputSchema);
    return "required" in node ? [...node.required] : [];
  });
  assert.deepEqual(required, [["name"], ["name", "content"], ["content"], [], ["location"]]);
});

it.effect(
  "a whole-file write of a dated note is refused toward append_daily_note before the journal is asked, and a bootstrap file still lands",
  () =>
    Effect.gen(function* () {
      const { workspace, written } = fakeWorkspace();
      const { ctx, journaled } = context({ workspace });
      const write = workspaceToolNamed(BRAIN_TOOL.WRITE_WORKSPACE_FILE);
      assert.ok(write);
      for (const name of ["memory/2026-09-15.md", "memory/2026-09-15-standup.md"]) {
        const refused: WireRecord = yield* write.execute({ name, content: "- a line" }, ctx);
        assert.deepEqual(refused, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: WORKSPACE_FILE_REFUSAL.DAILY_NOTE_REWRITE,
        });
      }
      assert.equal(journaled(), 0);
      assert.deepEqual(written, []);
      // A name under memory/ that is no dated note is the host's to refuse, as before.
      const landed = yield* write.execute({ name: "USER.md", content: "- x" }, ctx);
      assert.equal(landed.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.deepEqual(written, [["USER.md", "- x"]]);
      assert.equal(journaled(), 1);
      assert.match(write.description, /append_daily_note/u);
      assert.match(
        write.description,
        /AGENTS\.md, IDENTITY\.md, USER\.md, MEMORY\.md, or BOOTSTRAP\.md/u,
      );
    }),
);

it.effect(
  "an append trims its entry, refuses one left with nothing before the journal is asked, and answers the note's path and length once journaled",
  () =>
    Effect.gen(function* () {
      const { workspace, appended } = fakeWorkspace();
      const { ctx, journaled } = context({ workspace });
      const append = workspaceToolNamed(BRAIN_TOOL.APPEND_DAILY_NOTE);
      assert.ok(append);
      for (const input of [{}, { content: 7 }, { content: null }] as const) {
        const refused: WireRecord = yield* append.execute(input, ctx);
        assert.equal(refused.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
      }
      const empty = yield* append.execute({ content: "  \n " }, ctx);
      assert.deepEqual(empty, {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: REFUSAL_REASON.EMPTY_NOTE,
      });
      assert.equal(journaled(), 0);
      assert.deepEqual(appended, []);
      const first = yield* append.execute({ content: "  - decided: notch\n" }, ctx);
      assert.deepEqual(first, {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        path: TODAY,
        chars: "- decided: notch".length,
      });
      const second = yield* append.execute({ content: "- tests green" }, ctx);
      assert.deepEqual(second, {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        path: TODAY,
        chars: "- decided: notch\n\n- tests green".length,
      });
      assert.deepEqual(appended, ["- decided: notch", "- tests green"]);
      assert.equal(journaled(), 2);
      // The host's refusal is the model's answer, journaled like any other outcome.
      const full: BrainWorkspaceAccess = {
        ...workspace,
        append: () => Effect.succeed(Result.fail(WORKSPACE_FILE_REFUSAL.TOO_LARGE)),
      };
      const bounded = context({ workspace: full });
      const refused: WireRecord = yield* append.execute({ content: "- more" }, bounded.ctx);
      assert.deepEqual(refused, {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: WORKSPACE_FILE_REFUSAL.TOO_LARGE,
      });
      assert.equal(bounded.journaled(), 1);
    }),
);

it.effect(
  "listing the dated notes asks the host for the newest sixty and answers each path with its length, outside the journal",
  () =>
    Effect.gen(function* () {
      const { workspace, listed } = fakeWorkspace();
      const { ctx, journaled } = context({ workspace });
      const list = workspaceToolNamed(BRAIN_TOOL.LIST_DAILY_NOTES);
      assert.ok(list);
      assert.deepEqual(yield* list.execute({}, ctx), {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        notes: [
          { path: "memory/2026-09-15.md", chars: 120 },
          { path: "memory/2026-09-14.md", chars: 8 },
        ],
      });
      assert.deepEqual(listed, [maximumListedDailyNotes]);
      assert.equal(maximumListedDailyNotes, 60);
      assert.equal(journaled(), 0);
      assert.match(list.description, /60/u);
    }),
);

it.effect(
  "a write whose arguments are not the strings the tool takes is refused before the journal is asked, and the file is untouched",
  () =>
    Effect.gen(function* () {
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
        const refused: WireRecord = yield* write.execute(input, ctx);
        assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(refused.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
      }
      assert.equal(journaled(), 0);
      assert.deepEqual(written, []);
      const landed = yield* write.execute({ name: "MEMORY.md", content: "# MEMORY.md\n" }, ctx);
      assert.deepEqual(landed, {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        chars: "# MEMORY.md\n".length,
      });
      assert.equal(journaled(), 1);
      assert.deepEqual(written, [["MEMORY.md", "# MEMORY.md\n"]]);
    }),
);

it.effect(
  "the reads answer the host's access directly and never through the journal, and every tool refuses with no workspace",
  () =>
    Effect.gen(function* () {
      const { ctx, journaled } = context(fakeWorkspace());
      const read = workspaceToolNamed(BRAIN_TOOL.READ_WORKSPACE_FILE);
      const skill = workspaceToolNamed(BRAIN_TOOL.LOAD_SKILL);
      assert.ok(read && skill);
      assert.deepEqual(yield* read.execute({ name: "USER.md" }, ctx), {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        content: "content of USER.md",
      });
      assert.deepEqual(yield* skill.execute({ location: "skills/x/SKILL.md" }, ctx), {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        instructions: "do it",
        truncated: false,
      });
      assert.equal((yield* read.execute({}, ctx)).reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
      assert.equal(
        (yield* skill.execute({ location: 3 }, ctx)).reason,
        REFUSAL_REASON.MALFORMED_ARGUMENTS,
      );
      assert.equal(journaled(), 0);
      const without = context({ workspace: undefined });
      for (const tool of WORKSPACE_TOOLS) {
        const refused = yield* tool.execute(
          { name: "USER.md", content: "", location: "l" },
          without.ctx,
        );
        assert.equal(refused.reason, REFUSAL_REASON.NO_WORKSPACE);
      }
      assert.equal(without.journaled(), 0);
    }),
);
