import {
  CURATED_FILE_BUDGET,
  type DailyNoteListing,
  isDailyNotePath,
  type SkillLoad,
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
  type WorkspaceAppendResult,
  type WorkspaceReadResult,
  type WorkspaceWriteResult,
} from "@sidecar/runtime";
import type { ToolHostUnavailable } from "@sidecar/runtime/vocabulary";
import {
  ACTION_RESULT_STATUS,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Effect, Schema as EffectSchema, Result, SchemaTransformation } from "effect";
import { BRAIN_TOOL, maximumListedDailyNotes } from "./names.js";
import { rejection } from "./records.js";
import { REFUSAL_REASON } from "./refusals.js";
import type { ToolContext, ToolModule } from "./tool-module.js";

/**
 * workspace-tools.ts -- the one place the brain writes a file, bounded to its own workspace.
 *
 * Note that a call whose arguments are not the strings the tool takes is
 * refused before anything is journaled, never filled in, so a malformed write
 * can empty no file. A dated note is only ever grown, never rewritten, so an
 * entry cannot be lost to a rewrite that forgot it.
 */

/** How the workspace tools reach the agent's own files: bounded to the workspace by the host that supplies it. */
export interface BrainWorkspaceAccess {
  read(name: string): Effect.Effect<WorkspaceReadResult, ToolHostUnavailable>;
  write(name: string, content: string): Effect.Effect<WorkspaceWriteResult, ToolHostUnavailable>;
  /** Appends an entry to today's dated note, the day being the host's own clock's, creating the note where none stands. */
  append(entry: string): Effect.Effect<WorkspaceAppendResult, ToolHostUnavailable>;
  /** The dated notes newest first, at most `limit` of them, each with its character count. */
  listNotes(limit: number): Effect.Effect<readonly DailyNoteListing[], ToolHostUnavailable>;
  loadSkill(location: string): Effect.Effect<SkillLoad, ToolHostUnavailable>;
}

export interface WorkspaceToolContext extends ToolContext {
  /** The agent's own files, or nothing for an agent with no workspace, which refuses every call. */
  readonly workspace: BrainWorkspaceAccess | undefined;
  /** Records an effect before it runs and its result before the model reads it; the executor's journal. */
  journal(
    effect: Effect.Effect<WireRecord, ToolHostUnavailable>,
  ): Effect.Effect<WireRecord, ToolHostUnavailable>;
}

export type WorkspaceToolModule = ToolModule<WireRecord, WorkspaceToolContext>;

/** A text trimmed and refused when left with nothing. */
function trimmedText(description: string): EffectSchema.Codec<string, string> {
  return describeWire(
    EffectSchema.String.pipe(
      EffectSchema.decodeTo(
        EffectSchema.String.check(EffectSchema.isNonEmpty()),
        SchemaTransformation.trim(),
      ),
    ),
    description,
  );
}

/** A text trimmed and admitted even when left with nothing. */
function trimmedTextAllowingEmpty(description: string): EffectSchema.Codec<string, string> {
  return describeWire(
    EffectSchema.String.pipe(
      EffectSchema.decodeTo(EffectSchema.String, SchemaTransformation.trim()),
    ),
    description,
  );
}

/** Effect's `Codec` is invariant in its decoded type, so a concrete struct is erased to the module shape's type. */
function erase(schema: EffectSchema.Top): EffectSchema.Codec<unknown, UnparsedWireValue> {
  return EffectSchema.make(schema.ast);
}

const FILE_NAME = trimmedText("The file name, relative to your workspace.");

const READ_WORKSPACE_FILE_INPUT = erase(EffectSchema.Struct({ name: FILE_NAME }));

const WRITE_WORKSPACE_FILE_INPUT = erase(
  EffectSchema.Struct({
    name: FILE_NAME,
    content: trimmedTextAllowingEmpty("The complete new contents."),
  }),
);

const APPEND_DAILY_NOTE_INPUT = erase(
  EffectSchema.Struct({
    content: trimmedText("What to add to today's note."),
  }),
);

const LIST_DAILY_NOTES_INPUT = erase(EffectSchema.Struct({}));

const LOAD_SKILL_INPUT = erase(
  EffectSchema.Struct({
    location: trimmedText("The SKILL.md location, exactly as listed."),
  }),
);

const READ_WORKSPACE_FILE: WorkspaceToolModule = {
  name: BRAIN_TOOL.READ_WORKSPACE_FILE,
  description:
    "Read one of your workspace files: AGENTS.md, IDENTITY.md, USER.md, MEMORY.md, " +
    "BOOTSTRAP.md, or a dated note like memory/YYYY-MM-DD.md.",
  inputSchema: READ_WORKSPACE_FILE_INPUT,
  execute(
    input: WireRecord,
    context: WorkspaceToolContext,
  ): Effect.Effect<WireRecord, ToolHostUnavailable> {
    return Effect.gen(function* () {
      const workspace = context.workspace;
      if (!workspace) return rejection(REFUSAL_REASON.NO_WORKSPACE);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      if (!isWireString(input.name)) return rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS);
      const name = input.name;
      const read = yield* workspace.read(name);
      return Result.isSuccess(read)
        ? { status: ACTION_RESULT_STATUS.ACCEPTED, content: read.success.content }
        : rejection(read.failure);
    });
  },
};

const WRITE_WORKSPACE_FILE: WorkspaceToolModule = {
  name: BRAIN_TOOL.WRITE_WORKSPACE_FILE,
  description:
    "Overwrite AGENTS.md, IDENTITY.md, USER.md, MEMORY.md, or BOOTSTRAP.md with a whole new " +
    `file. USER.md holds ${CURATED_FILE_BUDGET[WORKSPACE_FILE.USER]} characters and MEMORY.md ` +
    `holds ${CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY]}. Going over is refused rather than ` +
    "cut short. For a dated note, use append_daily_note.",
  inputSchema: WRITE_WORKSPACE_FILE_INPUT,
  execute(
    input: WireRecord,
    context: WorkspaceToolContext,
  ): Effect.Effect<WireRecord, ToolHostUnavailable> {
    return Effect.suspend(() => {
      const workspace = context.workspace;
      if (!workspace) return Effect.succeed(rejection(REFUSAL_REASON.NO_WORKSPACE));
      if (context.isRevoked()) return Effect.succeed(rejection(REFUSAL_REASON.RUN_REVOKED));
      const { name, content } = input;
      if (!isWireString(name) || !isWireString(content)) {
        return Effect.succeed(rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS));
      }
      if (isDailyNotePath(name)) {
        return Effect.succeed(rejection(WORKSPACE_FILE_REFUSAL.DAILY_NOTE_REWRITE));
      }
      return context.journal(
        Effect.map(workspace.write(name, content), (written) =>
          Result.isSuccess(written)
            ? { status: ACTION_RESULT_STATUS.ACCEPTED, chars: written.success.chars }
            : rejection(written.failure),
        ),
      );
    });
  },
};

const APPEND_DAILY_NOTE: WorkspaceToolModule = {
  name: BRAIN_TOOL.APPEND_DAILY_NOTE,
  description:
    "Add an entry to the end of today's note, memory/YYYY-MM-DD.md, creating it if today " +
    "has none.",
  inputSchema: APPEND_DAILY_NOTE_INPUT,
  execute(
    input: WireRecord,
    context: WorkspaceToolContext,
  ): Effect.Effect<WireRecord, ToolHostUnavailable> {
    return Effect.suspend(() => {
      const workspace = context.workspace;
      if (!workspace) return Effect.succeed(rejection(REFUSAL_REASON.NO_WORKSPACE));
      if (context.isRevoked()) return Effect.succeed(rejection(REFUSAL_REASON.RUN_REVOKED));
      if (!isWireString(input.content)) {
        return Effect.succeed(rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS));
      }
      const entry = input.content.trim();
      if (entry.length === 0) return Effect.succeed(rejection(REFUSAL_REASON.EMPTY_NOTE));
      return context.journal(
        Effect.map(workspace.append(entry), (appended) =>
          Result.isSuccess(appended)
            ? {
                status: ACTION_RESULT_STATUS.ACCEPTED,
                path: appended.success.path,
                chars: appended.success.chars,
              }
            : rejection(appended.failure),
        ),
      );
    });
  },
};

const LIST_DAILY_NOTES: WorkspaceToolModule = {
  name: BRAIN_TOOL.LIST_DAILY_NOTES,
  description:
    `List your dated notes under memory/, newest first, up to ${maximumListedDailyNotes}. ` +
    "Read one with read_workspace_file.",
  inputSchema: LIST_DAILY_NOTES_INPUT,
  execute(
    _input: WireRecord,
    context: WorkspaceToolContext,
  ): Effect.Effect<WireRecord, ToolHostUnavailable> {
    return Effect.gen(function* () {
      const workspace = context.workspace;
      if (!workspace) return rejection(REFUSAL_REASON.NO_WORKSPACE);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      const notes = yield* workspace.listNotes(maximumListedDailyNotes);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        notes: notes.map((note) => ({ path: note.path, chars: note.chars })),
      };
    });
  },
};

const LOAD_SKILL: WorkspaceToolModule = {
  name: BRAIN_TOOL.LOAD_SKILL,
  description: "Load a skill's instructions by the location the skills list gave.",
  inputSchema: LOAD_SKILL_INPUT,
  execute(
    input: WireRecord,
    context: WorkspaceToolContext,
  ): Effect.Effect<WireRecord, ToolHostUnavailable> {
    return Effect.gen(function* () {
      const workspace = context.workspace;
      if (!workspace) return rejection(REFUSAL_REASON.NO_WORKSPACE);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      if (!isWireString(input.location)) return rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS);
      const location = input.location;
      const loaded = yield* workspace.loadSkill(location);
      return loaded.ok
        ? {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            instructions: loaded.instructions,
            truncated: loaded.truncated,
          }
        : rejection(loaded.reason);
    });
  },
};

/** The five workspace tools, in the order the catalog lists them. */
export const WORKSPACE_TOOLS: readonly WorkspaceToolModule[] = [
  READ_WORKSPACE_FILE,
  WRITE_WORKSPACE_FILE,
  APPEND_DAILY_NOTE,
  LIST_DAILY_NOTES,
  LOAD_SKILL,
];
