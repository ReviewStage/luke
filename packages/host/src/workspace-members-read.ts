/**
 * workspace-members-read.ts -- each workspace's people the windows draw, followed by the host over the service's held poll into the sync engine's pool and told on app state, and a member write drawn over them the moment it is asked.
 *
 * A window holds a workspace's people while it draws them (`heldSlice`),
 * and the host keeps the few let go latest followed, so a surface drawn
 * again draws them from where they stand; every held workspace is told on
 * the one slice the windows draw (`LIVE_READ.WORKSPACE_MEMBERS`). Its
 * members and who its work names but left are one row of the pool
 * (`@repo/sync`), by the workspace, since a member's row names them by
 * their account alone, and the workspace's people are built from it as the
 * held read built them (`workspaceMembersOfLiveRows`), told only where they
 * moved. The pool holds the row from the read's start, before its first
 * answer, and through each seal again.
 *
 * A role change and a removal are writes the pool draws over the people at
 * once (`write`); a handover's and a leave's are drawn once the service
 * answers them (`moved`), since each changes what the account reaches.
 * None answers a transaction, since they go through the service's accounts
 * rather than a statement of its own, so each stands until the read's own
 * rows carry what the service answered (`Written.carried`), and a poll read
 * before the write and answered after it never puts back what the write
 * changed. A refused write is taken back.
 */

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
import {
  type CarriedWaits,
  carriedWaits,
  type HeldAnswers,
  type HeldSlice,
  heldSlice,
} from "./live-collection.js";
import { followTakingRows, restarting } from "./live-follow.js";

/** The people's rows as the read's statement answers them: each member's, the plugin's role text among it, and who left. */
type PeopleRows = typeof workspaceMembersLiveRowsSchema.Type;

/** A member's row as the read's statement answers it. */
type MemberRow = PeopleRows["members"][number];

/** One workspace's people as the pool holds them, by the workspace. */
interface PeopleRow extends PeopleRows {
  readonly workspaceId: string;
}

/** A workspace's people as the pool holds them, by the workspace, every member write a change of them. */
const WORKSPACE_PEOPLE = fieldKind((row: PeopleRow) => row.workspaceId);

/** A seal the service did not answer, `gone` where the read names nothing the account reaches any more. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** What one member write makes of one member: the role they now hold, or that they are gone from the workspace. */
export type MemberMoved =
  | { readonly userId: string; readonly role: WorkspaceRole }
  | { readonly userId: string; readonly gone: true };

/** What a member write's service answered: the caller's answer and what it says of the members the write names, or the caller's answer for a refusal. */
export type MemberWritten<Answer> =
  | { readonly answer: Answer; readonly moved: readonly MemberMoved[] }
  | { readonly refused: Answer };

/** One kind of member write, as its client declares it: the workspace it writes, what it makes of the members, and how it is sent. */
export interface MemberWrite<Input, Answer> {
  readonly workspaceId: (input: Input) => string;
  readonly moves: (input: Input) => readonly MemberMoved[];
  readonly send: (input: Input) => Effect.Effect<MemberWritten<Answer>>;
}

export interface WorkspaceMembersDependencies {
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /**
   * One workspace's people sealed for following, or polled past `after`, for
   * the account one follow starts for; why not, `gone` where the account no
   * longer reaches them.
   */
  readonly seal: (
    workspaceId: string,
  ) => (poll: boolean, after?: string) => Effect.Effect<WorkspaceMembersLiveAnswer | Unsealed>;
  readonly tell: (held: AppWorkspaceMembers) => void;
  /** The sync engine's pool, which each held workspace's people stand in while it is followed. */
  readonly pool: EntityPool;
}

/** The workspaces' people the windows hold, and the member writes drawn over them. */
export interface WorkspaceMembersReads {
  readonly held: HeldSlice<string>;
  /** `declared` as a write the pool draws over the workspace's people at once, standing until the read carries what the service answered. */
  readonly write: <Input, Answer>(
    declared: MemberWrite<Input, Answer>,
  ) => WriteDeclaration<PeopleRow, FieldChange<PeopleRow>, Input, Answer>;
  /** Draws what a write the service answered says of each member over the workspace's people, until the read carries every one; answers once it is drawn. */
  readonly moved: (workspaceId: string, moves: readonly MemberMoved[]) => Effect.Effect<void>;
}

/** Whether `members` carry what `move` says of its member. */
function carries(members: readonly MemberRow[], move: MemberMoved): boolean {
  const row = members.find((each) => each.userId === move.userId);
  return "gone" in move ? row === undefined : row !== undefined && roleOf(row.role) === move.role;
}

/**
 * The people as `moves` leave them: a member gone left out, and a role
 * drawn as its own name, which `roleOf` reads back as that role, as it reads
 * the plugin's list of roles. Note that a member already carrying a move is
 * kept as the read answered them, so a change the read carries moves nothing.
 */
function movedPeople(moves: readonly MemberMoved[]): FieldChange<PeopleRow> {
  return (row) => ({
    members: row.members.flatMap((member) => {
      const move = moves.find((each) => each.userId === member.userId);
      if (move === undefined || carries([member], move)) return [member];
      return "gone" in move ? [] : [{ ...member, role: move.role }];
    }),
  });
}

/**
 * One workspace's people followed until let go, standing in the pool from
 * the start, each change told through `answers` once its first rows land,
 * and its waits on what the read carries handed to `stand` while it stands.
 * One the account does not reach is told unanswered and followed no longer;
 * a seal the service did not answer is told unanswered, and it, or a follow
 * that stopped, is sealed again after `LIVE_RESTART`.
 */
function followPeople(
  workspaceId: string,
  answers: HeldAnswers<WorkspaceMembersAnswer>,
  dependencies: Pick<WorkspaceMembersDependencies, "seal" | "pool"> & {
    readonly stand: (waits: CarriedWaits<PeopleRow>) => Effect.Effect<void, never, Scope.Scope>;
  },
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      // Note that nothing is told before the read first answers, nor once the scope closes, so a write let go with the follow puts nothing back.
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
        // Note that no member write answers a transaction, so the read hands no wait and each write waits on its rows (`carried`).
        confirmation: () => undefined,
      });
      const waits = yield* carriedWaits(() => people.synced());
      yield* dependencies.stand(waits);
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

/**
 * The held lifetime over every workspace's people (`heldSlice`), told on
 * the members' slice as each read moves, and the writes drawn over them.
 */
export function workspaceMembersReads(
  dependencies: WorkspaceMembersDependencies,
): Effect.Effect<WorkspaceMembersReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each held workspace's waits on what its read carries, while its follow stands. */
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
          stand: stand(workspaceId),
        }),
    });
    /** Waits until the workspace's read carries every one of `moves`, at once where no read stands for it. */
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
