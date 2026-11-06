import type { LIVE_READ } from "@repo/features/live-wire";
import {
  type WorkspaceMembersLiveAnswer,
  workspaceMembersLiveRowsSchema,
  workspaceMembersOfLiveRows,
} from "@repo/features/workspace-live";
import {
  roleOf,
  type WorkspaceMembersAnswer,
  type WorkspaceRole,
} from "@repo/features/workspace-wire";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type Refused,
  type WriteDeclaration,
  type Written,
} from "@repo/sync";
import { Effect, Equal, MutableHashMap, Option, type Scope } from "effect";
import { type AppWorkspaceMembers, NO_KEYS_HELD } from "./app-state.js";
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import {
  type CarriedWaits,
  carriedWaits,
  type HeldAnswers,
  type HeldSlice,
  heldSlice,
} from "./live-collection.js";
import { followTakingRows, restarting } from "./live-follow.js";

type PeopleRows = typeof workspaceMembersLiveRowsSchema.Type;

type MemberRow = PeopleRows["members"][number];

interface PeopleRow extends PeopleRows {
  readonly workspaceId: string;
}

const WORKSPACE_PEOPLE = fieldKind((row: PeopleRow) => row.workspaceId);

type Unsealed = { readonly failure: string; readonly gone?: boolean };

export type MemberMoved =
  | { readonly userId: string; readonly role: WorkspaceRole }
  | { readonly userId: string; readonly gone: true };

export type MemberWritten<Answer> =
  | { readonly answer: Answer; readonly moved: readonly MemberMoved[] }
  | { readonly refused: Answer };

export interface MemberWrite<Input, Answer> {
  readonly workspaceId: (input: Input) => string;
  readonly moves: (input: Input) => readonly MemberMoved[];
  readonly send: (input: Input) => Effect.Effect<MemberWritten<Answer>>;
}

export interface WorkspaceMembersDependencies {
  readonly gate: () => boolean;
  readonly seal: (
    workspaceId: string,
  ) => (poll: boolean, after?: string) => Effect.Effect<WorkspaceMembersLiveAnswer | Unsealed>;
  readonly tell: (held: AppWorkspaceMembers) => void;
  readonly pool: EntityPool;
  readonly entities?: () => EntityStore | undefined;
}

export interface WorkspaceMembersReads {
  readonly held: HeldSlice<string>;
  readonly write: <Input, Answer>(
    declared: MemberWrite<Input, Answer>,
  ) => WriteDeclaration<PeopleRow, FieldChange<PeopleRow>, Input, Answer>;
  readonly moved: (workspaceId: string, moves: readonly MemberMoved[]) => Effect.Effect<void>;
}

function carries(members: readonly MemberRow[], move: MemberMoved): boolean {
  const row = members.find((each) => each.userId === move.userId);
  return "gone" in move ? row === undefined : row !== undefined && roleOf(row.role) === move.role;
}

function movedPeople(moves: readonly MemberMoved[]): FieldChange<PeopleRow> {
  return (row) => ({
    members: row.members.flatMap((member) => {
      const move = moves.find((each) => each.userId === member.userId);
      if (move === undefined || carries([member], move)) return [member];
      return "gone" in move ? [] : [{ ...member, role: move.role }];
    }),
  });
}

function followPeople(
  workspaceId: string,
  answers: HeldAnswers<WorkspaceMembersAnswer>,
  dependencies: Pick<WorkspaceMembersDependencies, "seal" | "pool" | "entities"> & {
    readonly stand: (waits: CarriedWaits<PeopleRow>) => Effect.Effect<void, never, Scope.Scope>;
  },
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      let answered = false;
      let open = true;
      let told: WorkspaceMembersAnswer | undefined;
      const drawn = Effect.sync(() => {
        if (!answered || !open) return;
        const shown = workspaceMembersOfLiveRows(
          people.row(workspaceId) ?? { members: [], former: [] },
        );
        if (told !== undefined && Equal.equals(told, shown)) return;
        told = shown;
        answers.answered(shown);
      });
      const people: HeldRows<PeopleRow> = yield* dependencies.pool.stand(WORKSPACE_PEOPLE, {
        redraw: () => drawn,
        confirmation: () => undefined,
      });
      const waits = yield* carriedWaits(() => people.synced());
      yield* dependencies.stand(waits);
      const kept = dependencies.entities?.()?.storedIn(KEPT_READ.MEMBERS, workspaceId);
      if (kept !== undefined) {
        yield* people.answer([{ workspaceId, ...kept }]);
        answered = true;
        yield* drawn;
      }
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          open = false;
        }),
      );
      const seal = dependencies.seal(workspaceId);
      const attempt = Effect.gen(function* () {
        const first = yield* seal(false);
        if ("failure" in first) {
          answers.unanswered();
          return first.gone !== true;
        }
        yield* followTakingRows(
          { poll: (after) => seal(true, after) },
          first,
          workspaceMembersLiveRowsSchema,
          (rows) =>
            Effect.gen(function* () {
              yield* people.answer([{ workspaceId, ...rows }]);
              yield* dependencies.entities?.()?.keepIn(KEPT_READ.MEMBERS, workspaceId, rows) ??
                Effect.void;
              answered = true;
              yield* waits.answered;
              yield* drawn;
            }),
        ).pipe(Effect.ignore);
        return true;
      });
      yield* restarting(attempt);
    }),
  );
}

export function workspaceMembersReads(
  dependencies: WorkspaceMembersDependencies,
): Effect.Effect<WorkspaceMembersReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    const standing = MutableHashMap.empty<string, CarriedWaits<PeopleRow>>();
    const stand = (workspaceId: string) => (waits: CarriedWaits<PeopleRow>) =>
      Effect.acquireRelease(
        Effect.sync(() => MutableHashMap.set(standing, workspaceId, waits)),
        () =>
          Effect.sync(() => {
            if (Option.getOrUndefined(MutableHashMap.get(standing, workspaceId)) === waits) {
              MutableHashMap.remove(standing, workspaceId);
            }
          }),
      );
    const held = yield* heldSlice<typeof LIVE_READ.WORKSPACE_MEMBERS, string>({
      empty: NO_KEYS_HELD,
      path: (workspaceId) => [workspaceId],
      gate: dependencies.gate,
      tell: dependencies.tell,
      follow: (workspaceId, answers) =>
        followPeople(workspaceId, answers, {
          seal: dependencies.seal,
          pool: dependencies.pool,
          ...(dependencies.entities === undefined
            ? undefined
            : { entities: dependencies.entities }),
          stand: stand(workspaceId),
        }),
    });
    const carried = (workspaceId: string, moves: readonly MemberMoved[]) =>
      Effect.suspend(() => {
        const waits = Option.getOrUndefined(MutableHashMap.get(standing, workspaceId));
        if (waits === undefined) return Effect.void;
        return waits.carried(([row]) => moves.every((move) => carries(row?.members ?? [], move)));
      });
    const write = <Input, Answer>(
      declared: MemberWrite<Input, Answer>,
    ): WriteDeclaration<PeopleRow, FieldChange<PeopleRow>, Input, Answer> => ({
      kind: WORKSPACE_PEOPLE,
      keys: (input) => [declared.workspaceId(input)],
      change: (input) => movedPeople(declared.moves(input)),
      send: (input) =>
        Effect.map(
          declared.send(input),
          (sent): Written<FieldChange<PeopleRow>, Answer> | Refused<Answer> =>
            "refused" in sent
              ? sent
              : {
                  answer: sent.answer,
                  txid: undefined,
                  taken: movedPeople(sent.moved),
                  carried: carried(declared.workspaceId(input), sent.moved),
                },
        ),
    });
    const moved = (workspaceId: string, moves: readonly MemberMoved[]) =>
      dependencies.pool.write(
        write<undefined, undefined>({
          workspaceId: () => workspaceId,
          moves: () => moves,
          send: () => Effect.succeed({ answer: undefined, moved: moves }),
        }),
        undefined,
      );
    return { held, write, moved };
  });
}
