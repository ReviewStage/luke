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

type WorkspaceChange = (row: Workspace) => Workspace;

const WORKSPACE: EntityKind<Workspace, WorkspaceChange> = {
  key: (row) => row.id,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const next = change(row);
    return Equal.equals(next, row) ? undefined : next;
  },
};

export type WorkspaceWritten<Answer> =
  | { readonly answer: Answer; readonly workspace: Workspace }
  | { readonly refused: Answer };

export interface WorkspaceWrite<Input, Answer> {
  readonly workspaceId: (input: Input) => string;
  readonly change: (input: Input) => WorkspaceChange;
  readonly send: (input: Input) => Effect.Effect<WorkspaceWritten<Answer>>;
  readonly unsent: Answer;
}

export interface AskedOver {
  readonly rows: WorkspaceRows;
}

export interface WorkspaceRowsDependencies {
  readonly pool: EntityPool;
  readonly draw: (workspaces: readonly Workspace[]) => Effect.Effect<void>;
}

export interface WorkspaceRows {
  readonly answer: (workspaces: readonly Workspace[]) => Effect.Effect<void>;
  readonly sent: <Answer>(
    workspaceId: string,
    send: Effect.Effect<WorkspaceWritten<Answer>>,
    unsent: Answer,
  ) => Effect.Effect<Written<WorkspaceChange, Answer> | Refused<Answer>>;
  readonly answered: (workspace: Workspace) => Effect.Effect<void>;
  readonly owned: (change: WorkspaceChange) => WorkspaceChange;
}

function withPhotoOf(workspace: Workspace, answered: Workspace): Workspace {
  const { photoVersion: _replaced, ...kept } = workspace;
  return answered.photoVersion === undefined
    ? kept
    : { ...kept, photoVersion: answered.photoVersion };
}

export function workspaceRows(
  dependencies: WorkspaceRowsDependencies,
): Effect.Effect<WorkspaceRows, never, Scope.Scope> {
  return Effect.gen(function* () {
    let answered = false;
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );
    const moves = new Map<string, number>();
    const drawn = Effect.suspend(() => (answered ? dependencies.draw(held.rows()) : Effect.void));
    const held: HeldRows<Workspace, WorkspaceChange> = yield* dependencies.pool.stand(WORKSPACE, {
      redraw: () => drawn,
      confirmation: () => undefined,
    });
    const waits = yield* carriedWaits(() => held.synced());
    const movesOf = (workspaceId: string) => moves.get(workspaceId) ?? 0;
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
            taken: (row) =>
              open && movesOf(workspaceId) === before ? kept(sent.workspace)(row) : row,
            carried: waits.carried(() => movesOf(workspaceId) !== before),
          };
    const owned =
      (change: WorkspaceChange): WorkspaceChange =>
      (row) =>
        open ? change(row) : row;
    return {
      answer: (workspaces) =>
        Effect.gen(function* () {
          const moved = yield* held.answer(workspaces);
          for (const workspaceId of moved) moves.set(workspaceId, movesOf(workspaceId) + 1);
          answered = true;
          yield* waits.answered;
          yield* drawn;
        }),
      sent: <Answer>(
        workspaceId: string,
        send: Effect.Effect<WorkspaceWritten<Answer>>,
        unsent: Answer,
      ) =>
        Effect.suspend((): Effect.Effect<Written<WorkspaceChange, Answer> | Refused<Answer>> => {
          if (!open) return Effect.succeed({ refused: unsent });
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
            change: () => owned((row) => withPhotoOf(row, workspace)),
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
      owned,
    };
  });
}

export function workspaceWrite<Input extends AskedOver, Answer>(
  declared: WorkspaceWrite<Input, Answer>,
): WriteDeclaration<Workspace, WorkspaceChange, Input, Answer> {
  return {
    kind: WORKSPACE,
    keys: (input) => [declared.workspaceId(input)],
    change: (input) => input.rows.owned(declared.change(input)),
    send: (input) =>
      input.rows.sent(declared.workspaceId(input), declared.send(input), declared.unsent),
  };
}
