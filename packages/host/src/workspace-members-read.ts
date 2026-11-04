/**
 * workspace-members-read.ts -- each workspace's people the windows draw, followed by the host over the service's held poll and told on app state, and what a member write's answer says of them drawn over them until the read carries it.
 *
 * A window holds a workspace's people while it draws them (`heldSlice`),
 * and the host keeps the few let go latest followed, so a surface drawn
 * again draws them from where they stand; every held workspace is told on
 * the one slice the windows draw (`LIVE_READ.WORKSPACE_MEMBERS`). Its
 * members and who its work names but left are each a collection of their
 * own (`live-collection.ts`), as the service answers their rows, and the
 * workspace's people are built from both as the held read built them
 * (`workspaceMembersOfLiveRows`), told only where they moved.
 *
 * A member removed, a role changed, a handover, and a leave answer with no
 * transaction, since they go through the service's accounts rather than a
 * statement of its own, so the read cannot confirm one by its txid. Each is
 * drawn over the members it names once the service answers it, as its
 * answer has them, and kept until the read's own rows carry it (`carried`),
 * so a poll read before the write and answered after it never puts back
 * what the write changed. A refused write draws nothing.
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
import { Effect, Equal, FiberSet, MutableHashMap, Option, type Scope } from "effect";
import { type AppWorkspaceMembers, NO_KEYS_HELD } from "./app-state.js";
import {
  type AnsweredCollection,
  answeredCollection,
  type HeldAnswers,
  type HeldSlice,
  heldSlice,
  optimistically,
  rowsOf,
} from "./live-collection.js";
import { followTakingRows, restarting } from "./live-follow.js";

/** A member's row as the read's statement answers it, the plugin's role text among it. */
type MemberRow = (typeof workspaceMembersLiveRowsSchema.Type)["members"][number];

/** Someone who left, as the read's statement answers them. */
type FormerRow = (typeof workspaceMembersLiveRowsSchema.Type)["former"][number];

/** A seal the service did not answer, `gone` where the read names nothing the account reaches any more. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** What one member write's answer says of one member: the role they now hold, or that they are gone from the workspace. */
export type MemberMoved =
  | { readonly userId: string; readonly role: WorkspaceRole }
  | { readonly userId: string; readonly gone: true };

/** One workspace's people as its standing follow holds them, for a write to draw over. */
interface StandingPeople {
  readonly members: AnsweredCollection<MemberRow, string>;
  /** The writes standing over the members, let go before the follow's collections are. */
  readonly writes: FiberSet.FiberSet<void>;
  /** Tells the people as they now stand, what every standing write drew among them. */
  readonly drawn: () => void;
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
}

/** The workspaces' people the windows hold, and what a member write draws over them. */
export interface WorkspaceMembersReads {
  readonly held: HeldSlice<string>;
  /**
   * Draws what a write's answer says of each member over the workspace's
   * people, where a window holds them, and keeps it until the read carries
   * every one; answers once it is drawn.
   */
  readonly moved: (workspaceId: string, moves: readonly MemberMoved[]) => Effect.Effect<void>;
}

/** Whether `rows` carry what `move` says of its member. */
function carries(rows: readonly MemberRow[], move: MemberMoved): boolean {
  const row = rows.find((each) => each.userId === move.userId);
  return "gone" in move ? row === undefined : row !== undefined && roleOf(row.role) === move.role;
}

/**
 * One workspace's people followed until let go, each change told through
 * `answers` once its first rows land, and its members handed to `stand`
 * while the follow holds them. One the account does not reach is told
 * unanswered and followed no longer; a seal the service did not answer is
 * told unanswered, and it, or a follow that stopped, is sealed again after
 * `LIVE_RESTART`.
 */
function followPeople(
  workspaceId: string,
  answers: HeldAnswers<WorkspaceMembersAnswer>,
  dependencies: Pick<WorkspaceMembersDependencies, "seal"> & {
    readonly stand: (people: StandingPeople) => Effect.Effect<void, never, Scope.Scope>;
  },
): Effect.Effect<void> {
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const seal = dependencies.seal(workspaceId);
      const first = yield* seal(false);
      if ("failure" in first) {
        answers.unanswered();
        return first.gone !== true;
      }
      const members = yield* answeredCollection({ getKey: (row: MemberRow) => row.userId });
      const former = yield* answeredCollection({ getKey: (row: FormerRow) => row.userId });
      const writes = yield* FiberSet.make<void>();
      // Note that nothing is told before the read first answers, nor once the scope closes, so a write let go with the follow puts nothing back.
      let answered = false;
      let open = true;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          open = false;
        }),
      );
      let told: WorkspaceMembersAnswer | undefined;
      const drawn = () => {
        if (!answered || !open) return;
        const people = workspaceMembersOfLiveRows({
          members: rowsOf(members.collection),
          former: rowsOf(former.collection),
        });
        if (told !== undefined && Equal.equals(told, people)) return;
        told = people;
        answers.answered(people);
      };
      yield* dependencies.stand({ members, writes, drawn });
      yield* followTakingRows(
        { poll: (after) => seal(true, after) },
        first,
        workspaceMembersLiveRowsSchema,
        (rows) =>
          Effect.sync(() => {
            members.answer(rows.members);
            former.answer(rows.former);
            answered = true;
            drawn();
          }),
      ).pipe(Effect.ignore);
      return true;
    }),
  );
  return restarting(attempt);
}

/**
 * The held lifetime over every workspace's people (`heldSlice`), told on
 * the members' slice as each read moves, and the writes drawn over them.
 */
export function workspaceMembersReads(
  dependencies: WorkspaceMembersDependencies,
): Effect.Effect<WorkspaceMembersReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each held workspace's people while its follow stands, which a write draws over. */
    const standing = MutableHashMap.empty<string, StandingPeople>();
    const stand = (workspaceId: string) => (people: StandingPeople) =>
      Effect.acquireRelease(
        Effect.sync(() => MutableHashMap.set(standing, workspaceId, people)),
        () =>
          Effect.sync(() => {
            if (Option.getOrUndefined(MutableHashMap.get(standing, workspaceId)) === people) {
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
          stand: stand(workspaceId),
        }),
    });
    const moved = (workspaceId: string, moves: readonly MemberMoved[]) =>
      Effect.suspend(() => {
        const people = Option.getOrUndefined(MutableHashMap.get(standing, workspaceId));
        if (people === undefined) return Effect.void;
        const { members, writes, drawn } = people;
        // Note that a role is drawn as its own name, which `roleOf` reads back as that role, as it reads the plugin's list of roles.
        const draw = () => {
          const shown = rowsOf(members.collection);
          for (const move of moves) {
            if (!members.collection.has(move.userId) || carries(shown, move)) continue;
            if ("gone" in move) members.collection.delete(move.userId);
            else
              members.collection.update(move.userId, (draft) => {
                draft.role = move.role;
              });
          }
        };
        const kept = members.carried((rows) => moves.every((move) => carries(rows, move)));
        // Note that the write stands on a fiber of the follow's, so its answer is drawn before this answers and let go with the follow.
        return Effect.asVoid(
          FiberSet.run(
            writes,
            optimistically(draw, Effect.andThen(Effect.sync(drawn), kept)).pipe(
              Effect.ensuring(Effect.sync(drawn)),
            ),
          ),
        );
      });
    return { held, moved };
  });
}
