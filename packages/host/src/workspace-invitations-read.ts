/**
 * workspace-invitations-read.ts -- each workspace's pending invitations an owner's or an admin's windows draw, followed by the host over the service's held poll and told on app state, built again as each expires, and what an invite's or a cancel's answer says of them drawn over them until the read carries it.
 *
 * A window holds a workspace's invitations while it draws them
 * (`heldSlice`), and the host keeps the few let go latest followed, so a
 * surface drawn again draws them from where they stand; every held
 * workspace is told on the one slice the windows draw
 * (`LIVE_READ.WORKSPACE_INVITATIONS`). Its invitations are a collection of
 * their own (`live-collection.ts`), as the service answers their rows,
 * expired ones among them, since the live statement cannot bound them by
 * the clock; the list is built from them as the held read built it
 * (`workspaceInvitationsOfLiveRows`), at the host's own instant, and built
 * again at the instant the soonest of them expires (`drawnAtEdges`), so one
 * leaves the list at its expiry with no row moving. It is told only where
 * it moved.
 *
 * An invite and a cancel answer with no transaction, since they go through
 * the service's accounts rather than a statement of its own, so the read
 * cannot confirm one by its txid. Each is drawn over the invitations once
 * the service answers it, the invitation made as a row of the read's own,
 * and kept until the read's own rows carry it (`carried`), so a poll read
 * before the write and answered after it never puts back what the write
 * changed. A refused write draws nothing.
 */

import type { LIVE_READ } from "@repo/features/live-wire";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  nextInvitationExpiry,
  type WorkspaceInvitationsLiveAnswer,
  workspaceInvitationsLiveRowsSchema,
  workspaceInvitationsOfLiveRows,
} from "@repo/features/workspace-live";
import { Effect, Equal, FiberSet, MutableHashMap, Option, type Scope } from "effect";
import { type AppWorkspaceInvitations, NO_KEYS_HELD } from "./app-state.js";
import {
  type AnsweredCollection,
  answeredCollection,
  drawnAtEdges,
  type HeldAnswers,
  type HeldSlice,
  heldSlice,
  optimistically,
  rowsOf,
} from "./live-collection.js";
import { followTakingRows, restarting } from "./live-follow.js";

/** An invitation's row as the read's statement answers it: the plugin's role text, and when it expires in epoch milliseconds. */
type InvitationRow = (typeof workspaceInvitationsLiveRowsSchema.Type)["invitations"][number];

/** A seal the service did not answer, `gone` where the read names nothing the account reaches any more. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** What one invitation write's answer says of a workspace's invitations: the one it made, or that one is canceled. */
type InvitationMoved = { readonly made: WorkspaceInvitation } | { readonly canceled: string };

/** One workspace's invitations as its standing follow holds them, for a write to draw over. */
interface StandingInvitations {
  readonly invitations: AnsweredCollection<InvitationRow, string>;
  /** The writes standing over the invitations, let go before the follow's collection is. */
  readonly writes: FiberSet.FiberSet<void>;
  /** Tells the invitations as they now stand at the host's instant, what every standing write drew among them. */
  readonly drawn: Effect.Effect<void>;
}

export interface WorkspaceInvitationsDependencies {
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /**
   * One workspace's invitations sealed for following, or polled past
   * `after`, for the account one follow starts for; why not, `gone` where
   * the account no longer reaches them as an owner or an admin.
   */
  readonly seal: (
    workspaceId: string,
  ) => (poll: boolean, after?: string) => Effect.Effect<WorkspaceInvitationsLiveAnswer | Unsealed>;
  readonly tell: (held: AppWorkspaceInvitations) => void;
}

/** The workspaces' invitations the windows hold, and what an invitation write draws over them. */
export interface WorkspaceInvitationsReads {
  readonly held: HeldSlice<string>;
  /**
   * Draws what a write's answer says over the workspace's invitations,
   * where a window holds them, and keeps it until the read carries it;
   * answers once it is drawn.
   */
  readonly moved: (workspaceId: string, move: InvitationMoved) => Effect.Effect<void>;
}

/** The invitation an invite answered, as the read's statement would answer its row. */
function rowOfInvitation(made: WorkspaceInvitation): InvitationRow {
  return { id: made.id, email: made.email, role: made.role, expiresAt: Date.parse(made.expiresAt) };
}

/** Whether `rows` carry what `move` says: the invitation made among them, or the one canceled gone. */
function carries(rows: readonly InvitationRow[], move: InvitationMoved): boolean {
  if ("made" in move) return rows.some((row) => row.id === move.made.id);
  return rows.every((row) => row.id !== move.canceled);
}

/**
 * One workspace's invitations followed until let go, each change told
 * through `answers` once its first rows land, and again as the soonest
 * expires, and its collection handed to `stand` while the follow holds it.
 * One the account does not reach as an owner or an admin is told
 * unanswered and followed no longer; a seal the service did not answer is
 * told unanswered, and it, or a follow that stopped, is sealed again after
 * `LIVE_RESTART`.
 */
function followInvitations(
  workspaceId: string,
  answers: HeldAnswers<readonly WorkspaceInvitation[]>,
  dependencies: Pick<WorkspaceInvitationsDependencies, "seal"> & {
    readonly stand: (pending: StandingInvitations) => Effect.Effect<void, never, Scope.Scope>;
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
      const invitations = yield* answeredCollection({ getKey: (row: InvitationRow) => row.id });
      const writes = yield* FiberSet.make<void>();
      // Note that nothing is told before the read first answers, nor once the scope closes, so a write let go with the follow puts nothing back.
      let answered = false;
      let open = true;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          open = false;
        }),
      );
      let told: readonly WorkspaceInvitation[] | undefined;
      const drawn = yield* drawnAtEdges((now) => {
        if (!answered || !open) return undefined;
        const rows = { invitations: rowsOf(invitations.collection) };
        const pending = workspaceInvitationsOfLiveRows(rows, first.origin, now);
        if (told === undefined || !Equal.equals(told, pending)) {
          told = pending;
          answers.answered(pending);
        }
        return nextInvitationExpiry(rows, now);
      });
      yield* dependencies.stand({ invitations, writes, drawn });
      yield* followTakingRows(
        { poll: (after) => seal(true, after) },
        first,
        workspaceInvitationsLiveRowsSchema,
        (rows) =>
          Effect.andThen(
            Effect.sync(() => {
              invitations.answer(rows.invitations);
              answered = true;
            }),
            drawn,
          ),
      ).pipe(Effect.ignore);
      return true;
    }),
  );
  return restarting(attempt);
}

/**
 * The held lifetime over every workspace's invitations (`heldSlice`), told
 * on the invitations' slice as each read moves or one expires, and the
 * writes drawn over them.
 */
export function workspaceInvitationsReads(
  dependencies: WorkspaceInvitationsDependencies,
): Effect.Effect<WorkspaceInvitationsReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each held workspace's invitations while its follow stands, which a write draws over. */
    const standing = MutableHashMap.empty<string, StandingInvitations>();
    const stand = (workspaceId: string) => (pending: StandingInvitations) =>
      Effect.acquireRelease(
        Effect.sync(() => MutableHashMap.set(standing, workspaceId, pending)),
        () =>
          Effect.sync(() => {
            if (Option.getOrUndefined(MutableHashMap.get(standing, workspaceId)) === pending) {
              MutableHashMap.remove(standing, workspaceId);
            }
          }),
      );
    const held = yield* heldSlice<typeof LIVE_READ.WORKSPACE_INVITATIONS, string>({
      empty: NO_KEYS_HELD,
      path: (workspaceId) => [workspaceId],
      gate: dependencies.gate,
      tell: dependencies.tell,
      follow: (workspaceId, answers) =>
        followInvitations(workspaceId, answers, {
          seal: dependencies.seal,
          stand: stand(workspaceId),
        }),
    });
    const moved = (workspaceId: string, move: InvitationMoved) =>
      Effect.suspend(() => {
        const pending = Option.getOrUndefined(MutableHashMap.get(standing, workspaceId));
        if (pending === undefined) return Effect.void;
        const { invitations, writes, drawn } = pending;
        const draw = () => {
          if ("made" in move) {
            if (!invitations.collection.has(move.made.id)) {
              invitations.collection.insert(rowOfInvitation(move.made));
            }
          } else if (invitations.collection.has(move.canceled)) {
            invitations.collection.delete(move.canceled);
          }
        };
        const kept = invitations.carried((rows) => carries(rows, move));
        // Note that the write stands on a fiber of the follow's, so its answer is drawn before this answers and let go with the follow.
        return Effect.asVoid(
          FiberSet.run(
            writes,
            optimistically(draw, Effect.andThen(drawn, kept)).pipe(Effect.ensuring(drawn)),
          ),
        );
      });
    return { held, moved };
  });
}
