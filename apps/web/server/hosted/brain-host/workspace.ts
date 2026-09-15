import { Effect, type Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  BOOTSTRAP_FILE_ORDER,
  BRAIN_IDENTITY_LINE,
  BRAIN_INPUT_MARKER,
  BRAIN_PERSONA,
  BRAIN_WORKSPACE_SEEDS,
  type BrainWorkspaceAccess,
  type BuiltPrompt,
  boundBootstrapFiles,
  brainToolNotes,
  buildSystemPrompt,
  DAILY_NOTES_DIRECTORY,
  DEFAULT_AGENT_ID,
  type EffectiveToolPolicy,
  isWorkspaceFile,
  PROMPT_PROFILE,
  parseDailyNoteName,
  tooLargeRefusal,
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
  type WorkspaceFile,
  workspaceFileBound,
} from "../../core.js";
import type { HostedStore } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";

/**
 * The hosted brain's identity workspace: the same files the desktop keeps
 * under `agents/main/workspace`, one row per user per file, seeded once from
 * the brain's own seeds and edited only by the brain's workspace tools. The
 * prompt is composed from the rows exactly as the desktop composes it from
 * the directory — the bootstrap order, each file's own bound and the total
 * bound, the pure builder — and the tools can name nothing but the bootstrap
 * files and a dated note under `memory/`.
 */

/** The slice of the store the workspace reaches. */
export type WorkspaceStore = Pick<HostedStore, "workspace">;

const DAILY_NOTES_PREFIX = `${DAILY_NOTES_DIRECTORY}/`;

/** The runtime the prompt's runtime line names: eve is the loop here, not the desktop's tool loop. */
const BRAIN_HOST_RUNTIME_ID = "eve";

/** A name the agent gave as a workspace row's path, or nothing for one outside the workspace. */
function hostedWorkspacePath(name: string): string | undefined {
  if (isWorkspaceFile(name)) return name;
  if (!name.startsWith(DAILY_NOTES_PREFIX)) return undefined;
  return parseDailyNoteName(name.slice(DAILY_NOTES_PREFIX.length)) ? name : undefined;
}

/** Writes every missing bootstrap file for the user; an existing row, edited or not, is left as it is. */
export const seedHostedWorkspace = /* @__PURE__ */ Effect.fn("seedHostedWorkspace")(function* (
  store: WorkspaceStore,
  userId: string,
  now: number,
): Effect.fn.Return<readonly WorkspaceFile[], SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const seeded: WorkspaceFile[] = [];
  for (const name of Object.values(WORKSPACE_FILE)) {
    if (yield* store.workspace.seed(userId, name, BRAIN_WORKSPACE_SEEDS[name], now)) {
      seeded.push(name);
    }
  }
  return seeded;
});

const NO_SKILLS = "not loaded: this agent lists no skills";

/**
 * The workspace tools' reach: the rows, each cut or refused at its file's
 * own bound exactly as the files are, with no skills to load.
 * `BrainWorkspaceAccess` answers `Effect<A, never, never>`, but a row is read
 * over `SqlClient`, so the request's own client is provided into each read
 * here and `Effect.orDie` stands for the error the contract has nowhere to
 * say — a row this service cannot read is not a refusal the model is offered
 * a reason for.
 */
export function hostedWorkspaceAccess(
  client: SqlClient.SqlClient,
  store: WorkspaceStore,
  userId: string,
  now: () => number,
): BrainWorkspaceAccess {
  const run = <A>(
    effect: Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>,
  ): Effect.Effect<A> => Effect.orDie(Effect.provideService(effect, SqlClient.SqlClient, client));
  return {
    read: (name) =>
      Effect.gen(function* () {
        const path = hostedWorkspacePath(name);
        if (!path) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE };
        const row = yield* run(store.workspace.read(userId, path));
        if (!row) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.NOT_FOUND };
        return { ok: true, content: row.content.slice(0, workspaceFileBound(path)) };
      }),
    write: (name, content) =>
      Effect.gen(function* () {
        const path = hostedWorkspacePath(name);
        if (!path) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE };
        const bound = workspaceFileBound(path);
        if (content.length > bound) return { ok: false, reason: tooLargeRefusal(bound) };
        yield* run(store.workspace.write(userId, path, content, now()));
        return { ok: true, chars: content.length };
      }),
    loadSkill: () => Effect.succeed({ ok: false, reason: NO_SKILLS }),
  };
}

export interface HostedPromptInput {
  readonly policy: EffectiveToolPolicy;
  readonly model?: string;
}

/**
 * The prompt one session runs under, built by the same pure builder the
 * desktop uses over the bootstrap files read from the rows: the identity
 * line, the persona, the tools the effective policy offers, the brain's own
 * tool notes, the marker the standing context arrives behind, and the
 * workspace files in order and within their bounds. The service lists no
 * skills and runs in no directory, so those sections are absent rather than
 * invented.
 */
export const hostedPrompt = /* @__PURE__ */ Effect.fn("hostedPrompt")(function* (
  store: WorkspaceStore,
  userId: string,
  input: HostedPromptInput,
): Effect.fn.Return<BuiltPrompt, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const files = yield* Effect.forEach(BOOTSTRAP_FILE_ORDER, (name) =>
    Effect.map(store.workspace.read(userId, name), (row) => ({
      name,
      path: `${BRAIN_HOST.WORKSPACE_NAME}/${name}`,
      content: row?.content,
    })),
  );
  return buildSystemPrompt({
    profile: PROMPT_PROFILE.FULL,
    identity: BRAIN_IDENTITY_LINE,
    persona: BRAIN_PERSONA,
    tools: input.policy.allowed.map((tool) => ({ name: tool.schema.name, groups: tool.groups })),
    toolNotes: brainToolNotes(),
    runtimeContextMarker: BRAIN_INPUT_MARKER.STANDING_CONTEXT,
    skills: [],
    workspaceDirectory: BRAIN_HOST.WORKSPACE_NAME,
    bootstrapFiles: boundBootstrapFiles(files),
    runtime: {
      agentId: DEFAULT_AGENT_ID,
      runtimeId: BRAIN_HOST_RUNTIME_ID,
      ...(input.model ? { model: input.model } : undefined),
    },
  });
});
