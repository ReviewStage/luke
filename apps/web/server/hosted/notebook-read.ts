import { Effect, type Schema as EffectSchema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  NOTEBOOK_READ_BOUNDS,
  type NotebookAnswer,
  type NotebookFile,
  WORKSPACE_FILE,
} from "../core.js";
import { notebookPath } from "./brain-host/notebook.js";
import { HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { UserIdResolver } from "./http-effect.js";
import { readGate } from "./resource-reads.js";
import type { HostedStore } from "./store/index.js";

/**
 * The notebook read: Luke's notebook as the workspace rows hold it, answered
 * whole and bounded to its owner, so a developer can see what he has saved.
 * It is a read and nothing more — no model runs in it, nothing is written,
 * and the service keeps nothing for it — behind the same gate the
 * per-resource reads stand behind: GET, the account bearer, the shared brake.
 *
 * What travels is the same set his `memory_search` and `memory_get` tools
 * may name, decided by `notebookPath` and by nothing here: `MEMORY.md` and
 * `USER.md` first, then the dated notes newest first, at most
 * `NOTEBOOK_READ_BOUNDS.MAX_FILES` rows in all, each cut at the front to the
 * wire's per-file bound with its whole length beside it. The instruction
 * files the repository seeds are not the notebook and never travel.
 */

export interface NotebookReadOptions {
  request: Request;
  resolveUserId: UserIdResolver;
  store: Pick<HostedStore, "workspace">;
}

/** The two curated files, in the order the answer leads with them. */
const CURATED_ORDER: readonly string[] = [WORKSPACE_FILE.MEMORY, WORKSPACE_FILE.USER];

/** The paths one answer carries, in its order, and the count of older notes it leaves out. */
interface NotebookOrder {
  readonly kept: readonly string[];
  readonly omittedNotes: number;
}

/**
 * The notebook's paths in the order the answer carries them, from the paths
 * an account's rows spell: the curated files in their fixed order, then the
 * dated notes newest first, which is their paths in descending order since a
 * note is named by its day.
 */
export function notebookOrder(paths: readonly string[]): NotebookOrder {
  const notebook = paths.filter((path) => notebookPath(path) !== undefined);
  const curated = CURATED_ORDER.filter((path) => notebook.includes(path));
  const notes = notebook
    .filter((path) => !CURATED_ORDER.includes(path))
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
  const room = Math.max(0, NOTEBOOK_READ_BOUNDS.MAX_FILES - curated.length);
  return {
    kept: [...curated, ...notes.slice(0, room)],
    omittedNotes: Math.max(0, notes.length - room),
  };
}

/** GET: the account's notebook, curated files first and the newest notes after, bounded and cut. */
export const handleBrainNotebook = /* @__PURE__ */ Effect.fn("web/handleBrainNotebook")(function* (
  options: NotebookReadOptions,
): Effect.fn.Return<Response, SqlError | EffectSchema.SchemaError, SqlClient.SqlClient> {
  const gate = yield* readGate(options);
  if (gate instanceof Response) return gate;
  const { userId } = gate;
  const { store } = options;

  const listing = yield* store.workspace.list(userId);
  const { kept, omittedNotes } = notebookOrder(listing.map((row) => row.path));
  const files: NotebookFile[] = [];
  for (const path of kept) {
    // A row the listing named and the read no longer finds was deleted between
    // the two statements; the answer is what stands, so it is left out.
    const file = yield* store.workspace.read(userId, path);
    if (file === undefined) continue;
    files.push({
      path: file.path,
      content: file.content.slice(0, NOTEBOOK_READ_BOUNDS.MAX_FILE_CHARS),
      chars: file.content.length,
      updatedAt: file.updatedAt,
    });
  }
  const answer: NotebookAnswer = { files, omittedNotes };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});
