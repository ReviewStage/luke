import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult } from "effect";
import {
  BOOTSTRAP_BOUNDS,
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
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
  type WorkspaceFile,
} from "../../core.js";
import type { FiberStoreRunner } from "../fiber-runner.js";
import type { HostedStore } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";

/**
 * The hosted brain's identity workspace: the same files the desktop keeps
 * under `agents/main/workspace`, one row per user per file, seeded once from
 * the brain's own seeds and edited only by the brain's workspace tools. The
 * prompt is composed from the rows exactly as the desktop composes it from
 * the directory — the bootstrap order, the per-file and total bounds, the
 * pure builder — and the tools can name nothing but the six bootstrap files
 * and a dated note under `memory/`.
 */

/** The slice of the store the workspace reaches. */
export type WorkspaceStore = Pick<HostedStore, "workspace">;

/** What a read or write of the rows answers: an effect over the ambient client. */
type WorkspaceEffect<A> = Effect.Effect<A, SqlError | ParseResult.ParseError, SqlClient.SqlClient>;

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
export function seedHostedWorkspace(
  store: WorkspaceStore,
  userId: string,
  now: number,
): WorkspaceEffect<readonly WorkspaceFile[]> {
  return Effect.gen(function* () {
    const seeded: WorkspaceFile[] = [];
    for (const name of Object.values(WORKSPACE_FILE)) {
      if (yield* store.workspace.seed(userId, name, BRAIN_WORKSPACE_SEEDS[name], now)) {
        seeded.push(name);
      }
    }
    return seeded;
  });
}

const NO_SKILLS = "not loaded: this agent lists no skills";

/**
 * The workspace tools' reach: the rows, bounded like the files, with no
 * skills to load. `BrainWorkspaceAccess` is the brain's own promise-shaped
 * contract, so the runner the tool call already runs on is handed in here
 * rather than composed away.
 */
export function hostedWorkspaceAccess(
  run: FiberStoreRunner,
  store: WorkspaceStore,
  userId: string,
  now: () => number,
): BrainWorkspaceAccess {
  return {
    read: async (name) => {
      const path = hostedWorkspacePath(name);
      if (!path) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE };
      const row = await run(store.workspace.read(userId, path));
      if (!row) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.NOT_FOUND };
      return { ok: true, content: row.content.slice(0, BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE) };
    },
    write: async (name, content) => {
      const path = hostedWorkspacePath(name);
      if (!path) return { ok: false, reason: WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE };
      if (content.length > BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE) {
        return { ok: false, reason: WORKSPACE_FILE_REFUSAL.TOO_LARGE };
      }
      await run(store.workspace.write(userId, path, content, now()));
      return { ok: true, chars: content.length };
    },
    loadSkill: async () => ({ ok: false, reason: NO_SKILLS }),
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
export function hostedPrompt(
  store: WorkspaceStore,
  userId: string,
  input: HostedPromptInput,
): WorkspaceEffect<BuiltPrompt> {
  return Effect.gen(function* () {
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
}
