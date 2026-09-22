import { Effect, Result, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  appendedDailyNote,
  BOOTSTRAP_FILE_ORDER,
  BRAIN_INSTRUCTIONS,
  BRAIN_WORKSPACE_SEEDS,
  type BrainWorkspaceAccess,
  type BuiltPrompt,
  boundBootstrapFiles,
  buildSystemPrompt,
  DAILY_NOTES_DIRECTORY,
  DAY_MS,
  type DailyNote,
  DEFAULT_AGENT_ID,
  dailyNoteDay,
  dailyNotePath,
  isWorkspaceFile,
  PROMPT_PROFILE,
  parseDailyNoteName,
  tooLargeRefusal,
  WORKSPACE_FILE_REFUSAL,
  type WorkspaceFile,
  workspaceFileBound,
} from "../../core.js";
import type { HostedStore } from "../store/index.js";
import { type StoreFailure, toolHostSeam } from "../store-failure.js";
import { BRAIN_HOST } from "./bounds.js";

/**
 * The hosted brain's identity workspace: the same files the desktop keeps
 * under `agents/main/workspace`, one row per user per file, seeded once from
 * the brain's own seeds and edited only by the brain's workspace tools. The
 * prompt is composed from the rows exactly as the desktop composes it from
 * the directory — the bootstrap order, each file's own bound and the total
 * bound, the pure builder — and the tools can name nothing but the bootstrap
 * files and a dated note under `memory/`. A dated note is grown by appending
 * to today's, under the account's row lock so two turns in flight cannot lose
 * one another's entry, and listed by path and length without a word of it.
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

/** Writes every seeded file the user is missing; an existing row, edited or not, is left as it is. */
export const seedHostedWorkspace = /* @__PURE__ */ Effect.fn("web/seedHostedWorkspace")(function* (
  store: WorkspaceStore,
  userId: string,
  now: number,
): Effect.fn.Return<readonly WorkspaceFile[], SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const seeded: WorkspaceFile[] = [];
  for (const name of BOOTSTRAP_FILE_ORDER) {
    const seed = BRAIN_WORKSPACE_SEEDS[name];
    if (seed === undefined) continue;
    if (yield* store.workspace.seed(userId, name, seed, now)) seeded.push(name);
  }
  return seeded;
});

const NO_SKILLS = "not loaded: this agent lists no skills";

/**
 * The workspace tools' reach: the rows, each cut or refused at its file's
 * own bound exactly as the files are, with no skills to load.
 * A row is read over `SqlClient`, so the request's own client is provided
 * into each read here, and a row this service cannot read fails the access as
 * the tool contract's own unavailability, logged where its cause is known;
 * the tool run answers the call as rejected, never with the failure's words.
 * An append names today's note by the host's clock and revises
 * it in the store's one transaction: the revision declines, leaving the note
 * as it was, where the entry would grow it past the note's own bound, and the
 * refusal names that bound.
 */
export function hostedWorkspaceAccess(
  client: SqlClient.SqlClient,
  store: WorkspaceStore,
  userId: string,
  now: () => number,
): BrainWorkspaceAccess {
  const run = <A>(effect: Effect.Effect<A, StoreFailure, SqlClient.SqlClient>) =>
    toolHostSeam(client, effect);
  return {
    read: (name) =>
      Effect.gen(function* () {
        const path = hostedWorkspacePath(name);
        if (!path) return Result.fail(WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE);
        const row = yield* run(store.workspace.read(userId, path));
        if (!row) return Result.fail(WORKSPACE_FILE_REFUSAL.NOT_FOUND);
        return Result.succeed({ content: row.content.slice(0, workspaceFileBound(path)) });
      }),
    write: (name, content) =>
      Effect.gen(function* () {
        const path = hostedWorkspacePath(name);
        if (!path) return Result.fail(WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE);
        const bound = workspaceFileBound(path);
        if (content.length > bound) return Result.fail(tooLargeRefusal(bound));
        yield* run(store.workspace.write(userId, path, content, now()));
        return Result.succeed({ chars: content.length });
      }),
    append: (entry) =>
      Effect.gen(function* () {
        const at = now();
        const path = dailyNotePath(at);
        const bound = workspaceFileBound(path);
        const landed = yield* run(
          store.workspace.revise(
            userId,
            path,
            (existing) => {
              const grown = appendedDailyNote(existing, entry);
              return grown.length > bound ? undefined : grown;
            },
            at,
          ),
        );
        return landed === undefined
          ? Result.fail(tooLargeRefusal(bound))
          : Result.succeed({ path, chars: landed.length });
      }),
    listNotes: (limit) => run(store.workspace.listNotes(userId, limit)),
    loadSkill: () => Effect.succeed({ ok: false, reason: NO_SKILLS }),
  };
}

/** How far back a fresh session's priming reaches: today's and yesterday's notes, as OpenClaw primes. */
const RECENT_NOTE_DAYS = 2;

/**
 * Today's and yesterday's notes over the account's rows, slugged variants
 * included and in path order, for priming a session that opens fresh: one
 * read for both days, bounded as the bootstrap files are, each at its own
 * bound and the whole at the total. An ordinary turn never reads these; the
 * memory slot's recall does, once, into an empty history.
 */
export const recentHostedDailyNotes = /* @__PURE__ */ Effect.fn("recentHostedDailyNotes")(
  function* (
    store: WorkspaceStore,
    userId: string,
    now: number,
  ): Effect.fn.Return<readonly DailyNote[], SqlError | Schema.SchemaError, SqlClient.SqlClient> {
    const days = Array.from({ length: RECENT_NOTE_DAYS }, (_, back) =>
      dailyNoteDay(now - back * DAY_MS),
    );
    const rows = yield* store.workspace.readNotes(userId, days);
    return boundBootstrapFiles(
      rows.map((row) => ({ name: row.path.slice(DAILY_NOTES_PREFIX.length), ...row })),
    ).map(({ name, path, content }) => ({ name, path, content }));
  },
);

export interface HostedPromptInput {
  readonly model?: string;
}

/**
 * The prompt one session runs under, built by the pure builder over the
 * bootstrap files read from the rows: the build's own instructions, then the
 * workspace files in order and within their bounds. Note that the tools are
 * named nowhere in it, because the request carries each one's schema and the
 * policy is read again as every turn starts, so a list composed once for the
 * session could only go stale.
 */
export const hostedPrompt = /* @__PURE__ */ Effect.fn("web/hostedPrompt")(function* (
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
    instructions: BRAIN_INSTRUCTIONS,
    workspaceDirectory: BRAIN_HOST.WORKSPACE_NAME,
    bootstrapFiles: boundBootstrapFiles(files),
    runtime: {
      agentId: DEFAULT_AGENT_ID,
      runtimeId: BRAIN_HOST_RUNTIME_ID,
      ...(input.model ? { model: input.model } : undefined),
    },
  });
});
