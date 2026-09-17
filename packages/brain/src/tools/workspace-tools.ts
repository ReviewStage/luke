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
 * The workspace tools: the one place the brain writes a file at all, and they
 * reach nothing outside the workspace directory, because the host's access is
 * what bounds the names, and a host with none refuses them all. A call whose
 * arguments are not the strings the tool takes is refused before anything is
 * journaled, never filled in, so a malformed write can empty no file: the
 * write module reads its arguments first and only then asks the journal in
 * its context to record and run the effect. The two writes divide by what
 * they are for: a bootstrap file is rewritten whole, deliberately, after a
 * read; a dated note under `memory/` is only ever grown, by appending an
 * entry to today's, so the reply path never rewrites a curated file and a
 * note's earlier entries are never at the mercy of a rewrite that forgot them.
 */

/** How the workspace tools reach the agent's own files: bounded to the workspace by the host that supplies it. */
export interface BrainWorkspaceAccess {
  read(name: string): Effect.Effect<WorkspaceReadResult>;
  write(name: string, content: string): Effect.Effect<WorkspaceWriteResult>;
  /** Appends an entry to today's dated note, the day being the host's own clock's, creating the note where none stands. */
  append(entry: string): Effect.Effect<WorkspaceAppendResult>;
  /** The dated notes newest first, at most `limit` of them, each with its character count. */
  listNotes(limit: number): Effect.Effect<readonly DailyNoteListing[]>;
  loadSkill(location: string): Effect.Effect<SkillLoad>;
}

export interface WorkspaceToolContext extends ToolContext {
  /** The agent's own files, or nothing for an agent with no workspace, which refuses every call. */
  readonly workspace: BrainWorkspaceAccess | undefined;
  /** Records an effect before it runs and its result before the model reads it; the executor's journal. */
  journal(effect: Effect.Effect<WireRecord>): Effect.Effect<WireRecord>;
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

const FILE_NAME = trimmedText("The file's name relative to the workspace.");

const READ_WORKSPACE_FILE_INPUT = erase(EffectSchema.Struct({ name: FILE_NAME }));

const WRITE_WORKSPACE_FILE_INPUT = erase(
  EffectSchema.Struct({
    name: FILE_NAME,
    content: trimmedTextAllowingEmpty("The file's whole new content."),
  }),
);

const APPEND_DAILY_NOTE_INPUT = erase(
  EffectSchema.Struct({
    content: trimmedText("The entry to add to today's note: a few lines of Markdown."),
  }),
);

const LIST_DAILY_NOTES_INPUT = erase(EffectSchema.Struct({}));

const LOAD_SKILL_INPUT = erase(
  EffectSchema.Struct({
    location: trimmedText("The SKILL.md location exactly as listed."),
  }),
);

const READ_WORKSPACE_FILE: WorkspaceToolModule = {
  name: BRAIN_TOOL.READ_WORKSPACE_FILE,
  description:
    "Read one of your own workspace files whole: AGENTS.md, IDENTITY.md, USER.md, " +
    "MEMORY.md, BOOTSTRAP.md, or a dated note as memory/YYYY-MM-DD.md. Nothing " +
    "outside the workspace can be named.",
  inputSchema: READ_WORKSPACE_FILE_INPUT,
  execute(input: WireRecord, context: WorkspaceToolContext): Effect.Effect<WireRecord> {
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
    "Replace one of your five bootstrap files with new content, whole: AGENTS.md, IDENTITY.md, " +
    "USER.md, MEMORY.md, or BOOTSTRAP.md. A whole-file rewrite is deliberate: read the file " +
    "first so nothing is lost. A dated note under memory/ is not rewritten here; add to today's " +
    `with append_daily_note. USER.md and MEMORY.md are budgeted small, ${CURATED_FILE_BUDGET[WORKSPACE_FILE.USER]} ` +
    `and ${CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY]} characters: keep durable decisions ` +
    "and short summaries there and put detail in a dated note. A write past a file's bound " +
    "is refused rather than cut, and the refusal names the bound, so read the file, " +
    "condense it, and rewrite it to fit.",
  inputSchema: WRITE_WORKSPACE_FILE_INPUT,
  execute(input: WireRecord, context: WorkspaceToolContext): Effect.Effect<WireRecord> {
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
    "Add an entry to today's dated note, memory/YYYY-MM-DD.md, creating it if the day has " +
    "none. Use it during work for an observation worth keeping: a decision, a result, " +
    "something learned. The entry lands after what the note already holds, separated by a " +
    "blank line; nothing is rewritten. A note grown past the per-file bound is refused " +
    "rather than cut.",
  inputSchema: APPEND_DAILY_NOTE_INPUT,
  execute(input: WireRecord, context: WorkspaceToolContext): Effect.Effect<WireRecord> {
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
    "List your dated notes under memory/, newest first, at most the newest " +
    `${maximumListedDailyNotes}, each with its path and how many characters it holds. Read ` +
    "one with read_workspace_file.",
  inputSchema: LIST_DAILY_NOTES_INPUT,
  execute(_input: WireRecord, context: WorkspaceToolContext): Effect.Effect<WireRecord> {
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
  description:
    "Load one skill's full instructions by the location the available skills list gave. Only " +
    "a listed location answers.",
  inputSchema: LOAD_SKILL_INPUT,
  execute(input: WireRecord, context: WorkspaceToolContext): Effect.Effect<WireRecord> {
    return Effect.gen(function* () {
      const workspace = context.workspace;
      if (!workspace) return rejection(REFUSAL_REASON.NO_WORKSPACE);
      if (context.isRevoked()) return rejection(REFUSAL_REASON.RUN_REVOKED);
      if (!isWireString(input.location)) return rejection(REFUSAL_REASON.MALFORMED_ARGUMENTS);
      const location = input.location;
      const loaded = yield* workspace.loadSkill(location);
      return Result.isSuccess(loaded)
        ? {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            instructions: loaded.success.instructions,
            truncated: loaded.success.truncated,
          }
        : rejection(loaded.failure);
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
