/**
 * workspace-rows.ts -- the account's workspaces in the sync engine's pool, as the workspaces' follow answers them, drawn on the view, and a workspace's rename, its slug, and a photo the service answered drawn over them the moment each is asked or answered.
 *
 * Each workspace is one row of the pool (`@repo/sync`), by its id, for the
 * signed-in session: the follow, or the entity store before it, answers the
 * account's workspaces whole (`answer`), and the view draws them as the pool
 * shows them, every write standing drawn over them. A rename and a slug are
 * writes drawn at once (`workspaceWrite`); a photo is drawn once the service
 * answers it, since it uploads (`answered`).
 *
 * None answers a transaction, since a workspace is the service's accounts'
 * row rather than a statement of its own, and the follow may carry a newer
 * change than the write's own, a teammate's or a later edit's. So each write
 * stands until the follow next moves its workspace (`Written.carried`), and
 * the workspace the service answered is taken in the follow's place only
 * where the follow has not moved it since the write was sent, as where the
 * follow never carries the write; an answer that lands after a newer move is
 * never drawn over it.
 */

import type { Workspace } from "@repo/features/workspace-wire";
import type {
  EntityKind,
  EntityPool,
  HeldRows,
  Refused,
  WriteDeclaration,
  Written,
} from "@repo/sync";
import { Effect, Equal, type Scope } from "effect";
import { carriedWaits } from "./live-collection.js";

/** A change to a workspace: the row as it leaves it, from the row as it is drawn now. */
type WorkspaceChange = (row: Workspace) => Workspace;

/** A workspace as the pool holds it, by its id, every write to it a change of the row. */
const WORKSPACE: EntityKind<Workspace, WorkspaceChange> = {
  key: (row) => row.id,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const next = change(row);
    // Note that a change the row already carries leaves it alone, so the view holds the very row.
    return Equal.equals(next, row) ? undefined : next;
  },
};

/** What a workspace write's service answered: the caller's answer and the workspace as it then stands, or the caller's answer for a refusal. */
export type WorkspaceWritten<Answer> =
  | { readonly answer: Answer; readonly workspace: Workspace }
  | { readonly refused: Answer };

/** One kind of workspace write, as its client declares it: the workspace it writes, what it makes of it, and how it is sent. */
export interface WorkspaceWrite<Input, Answer> {
  readonly workspaceId: (input: Input) => string;
  readonly change: (input: Input) => WorkspaceChange;
  readonly send: (input: Input) => Effect.Effect<WorkspaceWritten<Answer>>;
}

export interface WorkspaceRowsDependencies {
  /** The sync engine's pool, which the account's workspaces stand in for the session. */
  readonly pool: EntityPool;
  /** Draws the workspaces as the pool shows them on the view. */
  readonly draw: (workspaces: readonly Workspace[]) => Effect.Effect<void>;
}

/** The account's workspaces in the pool, and the writes drawn over them. */
export interface WorkspaceRows {
  /** Takes the workspaces the follow, or the entity store, answered, whole, and draws them. */
  readonly answer: (workspaces: readonly Workspace[]) => Effect.Effect<void>;
  /** A write to `workspaceId` carried to the service by `send`, as the pool takes what it answered (`workspaceWrite`). */
  readonly sent: <Answer>(
    workspaceId: string,
    send: Effect.Effect<WorkspaceWritten<Answer>>,
  ) => Effect.Effect<Written<WorkspaceChange, Answer> | Refused<Answer>>;
  /** Draws a workspace a write the service answered says over its row, as a photo set does, until the follow next moves it; answers once it is drawn. */
  readonly answered: (workspace: Workspace) => Effect.Effect<void>;
}

/** `workspace` with the photo `answered` carries in place of its own, or none where it carries none. */
function withPhotoOf(workspace: Workspace, answered: Workspace): Workspace {
  const { photoVersion: _replaced, ...kept } = workspace;
  return answered.photoVersion === undefined
    ? kept
    : { ...kept, photoVersion: answered.photoVersion };
}

/**
 * The account's workspaces standing in the pool for the caller's scope, the
 * signed-in session, drawn through `draw` once first answered and as every
 * write moves them.
 */
export function workspaceRows(
  dependencies: WorkspaceRowsDependencies,
): Effect.Effect<WorkspaceRows, never, Scope.Scope> {
  return Effect.gen(function* () {
    let answered = false;
    /** How many times the follow has moved each workspace, so a write's answer that lands after a newer move is not drawn over it. */
    const moves = new Map<string, number>();
    const drawn = Effect.suspend(() => (answered ? dependencies.draw(held.rows()) : Effect.void));
    const held: HeldRows<Workspace, WorkspaceChange> = yield* dependencies.pool.stand(WORKSPACE, {
      redraw: () => drawn,
      // Note that no workspace write answers a transaction, so the read hands no wait and each write waits on the follow's next move (`carried`).
      confirmation: () => undefined,
    });
    const waits = yield* carriedWaits(() => held.synced());
    const movesOf = (workspaceId: string) => moves.get(workspaceId) ?? 0;
    /** What a write's service answered as the pool takes it: standing until the follow moves the workspace past `before`, and taken in its place only where it has not. */
    const taken = <Answer>(
      workspaceId: string,
      before: number,
      sent: WorkspaceWritten<Answer>,
      kept: (workspace: Workspace) => WorkspaceChange,
    ): Written<WorkspaceChange, Answer> | Refused<Answer> =>
      "refused" in sent
        ? sent
        : {
            answer: sent.answer,
            txid: undefined,
            taken: (row) => (movesOf(workspaceId) === before ? kept(sent.workspace)(row) : row),
            carried: waits.carried(() => movesOf(workspaceId) !== before),
          };
    return {
      answer: (workspaces) =>
        Effect.gen(function* () {
          const moved = yield* held.answer(workspaces);
          for (const workspaceId of moved) moves.set(workspaceId, movesOf(workspaceId) + 1);
          answered = true;
          yield* waits.answered;
          yield* drawn;
        }),
      sent: (workspaceId, send) =>
        Effect.suspend(() => {
          const before = movesOf(workspaceId);
          return Effect.map(send, (sent) =>
            taken(workspaceId, before, sent, (workspace) => () => workspace),
          );
        }),
      answered: (workspace) =>
        dependencies.pool.write(
          {
            kind: WORKSPACE,
            keys: () => [workspace.id],
            change: () => (row) => withPhotoOf(row, workspace),
            send: () =>
              Effect.sync(() =>
                taken(
                  workspace.id,
                  movesOf(workspace.id),
                  { answer: undefined, workspace },
                  (answer) => (row) => withPhotoOf(row, answer),
                ),
              ),
          },
          undefined,
        ),
    };
  });
}

/**
 * `declared` as a write the pool draws over its workspace at once, sent
 * through the session's workspaces as `rows` names them when it is sent, and
 * standing until the follow next moves the workspace.
 */
export function workspaceWrite<Input, Answer>(
  declared: WorkspaceWrite<Input, Answer>,
  rows: () => WorkspaceRows,
): WriteDeclaration<Workspace, WorkspaceChange, Input, Answer> {
  return {
    kind: WORKSPACE,
    keys: (input) => [declared.workspaceId(input)],
    change: declared.change,
    send: (input) => rows().sent(declared.workspaceId(input), declared.send(input)),
  };
}
