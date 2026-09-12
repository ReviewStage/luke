import type { SkillLoad, WorkspaceReadResult, WorkspaceWriteResult } from "@sidecar/runtime";
import {
  ACTION_RESULT_STATUS,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { describeWire } from "@sidecar/wire/effect";
import { Effect, Schema as EffectSchema } from "effect";
import { BRAIN_TOOL } from "./names.js";
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
 * its context to record and run the effect.
 */

/** How the workspace tools reach the agent's own files: bounded to the workspace by the host that supplies it. */
export interface BrainWorkspaceAccess {
  read(name: string): Promise<WorkspaceReadResult>;
  write(name: string, content: string): Promise<WorkspaceWriteResult>;
  loadSkill(location: string): Promise<SkillLoad>;
}

export interface WorkspaceToolContext extends ToolContext {
  /** The agent's own files, or nothing for an agent with no workspace, which refuses every call. */
  readonly workspace: BrainWorkspaceAccess | undefined;
  /** Records an effect before it runs and its result before the model reads it; the executor's journal. */
  journal(effect: Effect.Effect<WireRecord>): Effect.Effect<WireRecord>;
}

export type WorkspaceToolModule = ToolModule<WireRecord, WorkspaceToolContext>;

/** A text trimmed and refused when left with nothing. */
function trimmedText(description: string): EffectSchema.Schema<string, string> {
  return describeWire(
    EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
      strict: true,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }).pipe(
      EffectSchema.filter((value) => value.trim().length > 0, {
        schemaId: EffectSchema.MinLengthSchemaId,
        jsonSchema: { minLength: 1 },
      }),
    ),
    description,
  );
}

/** A text trimmed and admitted even when left with nothing. */
function trimmedTextAllowingEmpty(description: string): EffectSchema.Schema<string, string> {
  return describeWire(
    EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
      strict: true,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }),
    description,
  );
}

const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** Effect's `Schema` is invariant in its decoded type, so a concrete struct is erased to the module shape's type. */
function erase<A, I>(
  schema: EffectSchema.Schema<A, I>,
): EffectSchema.Schema<unknown, UnparsedWireValue> {
  return EffectSchema.make(schema.ast);
}

const FILE_NAME = trimmedText("The file's name relative to the workspace.");

const READ_WORKSPACE_FILE_INPUT = erase(tolerantRecord({ name: FILE_NAME }));

const WRITE_WORKSPACE_FILE_INPUT = erase(
  tolerantRecord({
    name: FILE_NAME,
    content: trimmedTextAllowingEmpty("The file's whole new content."),
  }),
);

const LOAD_SKILL_INPUT = erase(
  tolerantRecord({
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
      const read = yield* Effect.promise(() => workspace.read(name));
      return read.ok
        ? { status: ACTION_RESULT_STATUS.ACCEPTED, content: read.content }
        : rejection(read.reason);
    });
  },
};

const WRITE_WORKSPACE_FILE: WorkspaceToolModule = {
  name: BRAIN_TOOL.WRITE_WORKSPACE_FILE,
  description:
    "Replace one of your own workspace files with new content, whole. Use it to keep " +
    "MEMORY.md, USER.md, and dated notes current; read the file first so nothing is lost. " +
    "Content past the per-file bound is refused rather than cut.",
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
      return context.journal(
        Effect.map(
          Effect.promise(() => workspace.write(name, content)),
          (written) =>
            written.ok
              ? { status: ACTION_RESULT_STATUS.ACCEPTED, chars: written.chars }
              : rejection(written.reason),
        ),
      );
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
      const loaded = yield* Effect.promise(() => workspace.loadSkill(location));
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

/** The three workspace tools, in the order the catalog lists them. */
export const WORKSPACE_TOOLS: readonly WorkspaceToolModule[] = [
  READ_WORKSPACE_FILE,
  WRITE_WORKSPACE_FILE,
  LOAD_SKILL,
];

const WORKSPACE_TOOLS_BY_NAME = new Map(WORKSPACE_TOOLS.map((tool) => [tool.name, tool]));

export function workspaceToolNamed(name: string): WorkspaceToolModule | undefined {
  return WORKSPACE_TOOLS_BY_NAME.get(name);
}
