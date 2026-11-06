/**
 * workspace-invitations-read.ts -- each workspace's pending invitations an owner's or an admin's windows draw, followed by the host over the service's held poll into the sync engine's pool and told on app state, built again as each expires, and a cancel drawn over them the moment it is asked.
 *
 * A window holds a workspace's invitations while it draws them
 * (`heldSlice`), and the host keeps the few let go latest followed, so a
 * surface drawn again draws them from where they stand; every held
 * workspace is told on the one slice the windows draw
 * (`LIVE_READ.WORKSPACE_INVITATIONS`). Each invitation is one row of the
 * pool (`@repo/sync`), by its id, as the service answers it, expired ones
 * among them, since the live statement cannot bound them by the clock; the
 * list is built from them as the held read built it
 * (`workspaceInvitationsOfLiveRows`), at the host's own instant, and built
 * again at the instant the soonest of them expires (`drawnAtEdges`), so one
 * leaves the list at its expiry with no row moving. It is told only where
 * it moved. The pool holds the rows from the read's start, before its first
 * answer, and through each seal again.
 *
 * A cancel is a write the pool draws gone over its invitation at once
 * (`cancel`); an invite's invitation is drawn once the service answers it,
 * since the service mints it and sends its mail (`made`). Neither answers a
 * transaction, since they go through the service's accounts rather than a
 * statement of its own, so each stands until the read's own rows carry it
 * (`Written.carried`), and a poll read before the write and answered after
 * it never puts back what the write changed. A refused cancel is taken
 * back.
 */

import type { LIVE_READ } from "@repo/features/live-wire";
import type { TasksWorkspaceInvitationCancelParams } from "@repo/features/tasks-view";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  nextInvitationExpiry,
  WORKSPACE_INVITATIONS_READ,
  type WorkspaceInvitationsLiveAnswer,
  workspaceInvitationsOfLiveRows,
} from "@repo/features/workspace-live";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type Refused,
  ROW_GONE,
  type WriteDeclaration,
  type Written,
} from "@repo/sync";
import { Effect, Equal, MutableHashMap, Option, type Scope } from "effect";
import { type AppWorkspaceInvitations, NO_KEYS_HELD } from "./app-state.js";
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import {
  type CarriedWaits,
  carriedWaits,
  drawnAtEdges,
  type HeldAnswers,
  type HeldSlice,
  heldSlice,
} from "./live-collection.js";
import { followTakingRows, restarting } from "./live-follow.js";

/** An invitation's row as the read's statement answers it: the plugin's role text, and when it expires in epoch milliseconds. */
type InvitationRow = (typeof WORKSPACE_INVITATIONS_READ.rows.Type)["invitations"][number];

/** An invitation as the pool holds it, by its id, with the workspace it invites to. */
interface PooledInvitation extends InvitationRow {
  readonly workspaceId: string;
}

/** A pending invitation as the pool holds it, by its id, a cancel its deletion and an invite its making. */
const WORKSPACE_INVITATION = fieldKind((row: PooledInvitation) => row.id);

/** A seal the service did not answer, `gone` where the read names nothing the account reaches any more. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** What a cancel's service answered: the caller's answer, or the caller's answer for a refusal. */
export type InvitationCanceled<Answer> = { readonly answer: Answer } | { readonly refused: Answer };

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
  /** The sync engine's pool, which each held workspace's invitations stand in while it is followed. */
  readonly pool: EntityPool;
  /** The signed-in account's lists kept on disk, which a workspace's invitations are drawn from before its read first answers, and each answer is kept in; none where nothing keeps them. */
  readonly entities?: () => EntityStore | undefined;
}

/** The workspaces' invitations the windows hold, and the invitation writes drawn over them. */
export interface WorkspaceInvitationsReads {
  readonly held: HeldSlice<string>;
  /** A cancel sent as `send` asks, its invitation drawn gone at once and standing until the read no longer carries it. */
  readonly cancel: <Answer>(
    send: (
      cancel: TasksWorkspaceInvitationCancelParams,
    ) => Effect.Effect<InvitationCanceled<Answer>>,
  ) => WriteDeclaration<
    PooledInvitation,
    FieldChange<PooledInvitation>,
    TasksWorkspaceInvitationCancelParams,
    Answer
  >;
  /** Draws the invitation an invite's service answered over the workspace's invitations, until the read carries it; answers once it is drawn. */
  readonly made: (workspaceId: string, made: WorkspaceInvitation) => Effect.Effect<void>;
}

/** The invitation an invite answered, as the pool holds the read's row of it. */
function rowOfInvitation(workspaceId: string, made: WorkspaceInvitation): PooledInvitation {
  return {
    workspaceId,
    id: made.id,
    email: made.email,
    role: made.role,
    expiresAt: Date.parse(made.expiresAt),
  };
}

/**
 * One workspace's invitations followed until let go, standing in the pool
 * from the start, each change told through `answers` once its first rows
 * land, and again as the soonest expires, and its waits on what the read
 * carries handed to `stand` while it stands. One the account does not reach
 * as an owner or an admin is told unanswered and followed no longer; a seal
 * the service did not answer is told unanswered, and it, or a follow that
 * stopped, is sealed again after `LIVE_RESTART`.
 */
function followInvitations(
  workspaceId: string,
  answers: HeldAnswers<readonly WorkspaceInvitation[]>,
  dependencies: Pick<WorkspaceInvitationsDependencies, "seal" | "pool" | "entities"> & {
    readonly stand: (
      waits: CarriedWaits<PooledInvitation>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  },
): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      // Note that nothing is told before the read first answers, nor once the scope closes, so a write let go with the follow puts nothing back.
      let open = true;
      /** The service's own origin the last seal answered, which each accept link is built on; none before one answered. */
      let origin: string | undefined;
      let told: readonly WorkspaceInvitation[] | undefined;
      const drawn = yield* drawnAtEdges((now) => {
        if (origin === undefined || !open) return undefined;
        const rows = { invitations: invitations.rows() };
        const pending = workspaceInvitationsOfLiveRows(rows, origin, now);
        if (told === undefined || !Equal.equals(told, pending)) {
          told = pending;
          answers.answered(pending);
        }
        return nextInvitationExpiry(rows, now);
      });
      const invitations: HeldRows<PooledInvitation> = yield* dependencies.pool.stand(
        WORKSPACE_INVITATION,
        {
          redraw: () => drawn,
          // Note that no invitation write answers a transaction, so the read hands no wait and each write waits on its rows (`carried`).
          confirmation: () => undefined,
          adopts: (row) => row.workspaceId === workspaceId,
        },
      );
      const waits = yield* carriedWaits(() => invitations.synced());
      yield* dependencies.stand(waits);
      // Note that the invitations kept on disk are drawn as the service last answered them, on the origin it answered, until the read answers anew.
      const kept = dependencies.entities?.()?.storedIn(KEPT_READ.INVITATIONS, workspaceId);
      if (kept !== undefined) {
        yield* invitations.answer(kept.invitations.map((row) => ({ workspaceId, ...row })));
        origin = kept.origin;
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
          WORKSPACE_INVITATIONS_READ.rows,
          (rows) =>
            Effect.gen(function* () {
              yield* invitations.answer(rows.invitations.map((row) => ({ workspaceId, ...row })));
              origin = first.origin;
              yield* dependencies.entities?.()?.keepIn(KEPT_READ.INVITATIONS, workspaceId, {
                origin: first.origin,
                invitations: rows.invitations,
              }) ?? Effect.void;
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
 * The held lifetime over every workspace's invitations (`heldSlice`), told
 * on the invitations' slice as each read moves or one expires, and the
 * writes drawn over them.
 */
export function workspaceInvitationsReads(
  dependencies: WorkspaceInvitationsDependencies,
): Effect.Effect<WorkspaceInvitationsReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    /** Each held workspace's waits on what its read carries, while its follow stands. */
    const standing = MutableHashMap.empty<string, CarriedWaits<PooledInvitation>>();
    const stand = (workspaceId: string) => (waits: CarriedWaits<PooledInvitation>) =>
      Effect.acquireRelease(
        Effect.sync(() => MutableHashMap.set(standing, workspaceId, waits)),
        () =>
          Effect.sync(() => {
            if (Option.getOrUndefined(MutableHashMap.get(standing, workspaceId)) === waits) {
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
          pool: dependencies.pool,
          ...(dependencies.entities === undefined
            ? undefined
            : { entities: dependencies.entities }),
          stand: stand(workspaceId),
        }),
    });
    /** Waits until the workspace's read carries what `until` asks of its rows, at once where no read stands for it. */
    const carried = (workspaceId: string, until: (rows: readonly PooledInvitation[]) => boolean) =>
      Effect.suspend(() => {
        const waits = Option.getOrUndefined(MutableHashMap.get(standing, workspaceId));
        return waits === undefined ? Effect.void : waits.carried(until);
      });
    const cancel = <Answer>(
      send: (
        cancel: TasksWorkspaceInvitationCancelParams,
      ) => Effect.Effect<InvitationCanceled<Answer>>,
    ): WriteDeclaration<
      PooledInvitation,
      FieldChange<PooledInvitation>,
      TasksWorkspaceInvitationCancelParams,
      Answer
    > => ({
      kind: WORKSPACE_INVITATION,
      keys: ({ invitationId }) => [invitationId],
      change: () => () => ROW_GONE,
      send: (input) =>
        Effect.map(
          send(input),
          (sent): Written<FieldChange<PooledInvitation>, Answer> | Refused<Answer> =>
            "refused" in sent
              ? sent
              : {
                  answer: sent.answer,
                  txid: undefined,
                  carried: carried(input.workspaceId, (rows) =>
                    rows.every((row) => row.id !== input.invitationId),
                  ),
                },
        ),
    });
    const made = (workspaceId: string, invitation: WorkspaceInvitation) =>
      dependencies.pool.write(
        {
          kind: WORKSPACE_INVITATION,
          keys: () => [invitation.id],
          change: () => ({ made: rowOfInvitation(workspaceId, invitation) }),
          send: () =>
            Effect.succeed({
              answer: undefined,
              txid: undefined,
              carried: carried(workspaceId, (rows) => rows.some((row) => row.id === invitation.id)),
            }),
        },
        undefined,
      );
    return { held, cancel, made };
  });
}
