import type { LIVE_READ } from "@repo/features/live-wire";
import type { TasksWorkspaceInvitationCancelParams } from "@repo/features/tasks-view";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  nextInvitationExpiry,
  type WorkspaceInvitationsLiveAnswer,
  workspaceInvitationsLiveRowsSchema,
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

type InvitationRow = (typeof workspaceInvitationsLiveRowsSchema.Type)["invitations"][number];

interface PooledInvitation extends InvitationRow {
  readonly workspaceId: string;
}

const WORKSPACE_INVITATION = fieldKind((row: PooledInvitation) => row.id);

type Unsealed = { readonly failure: string; readonly gone?: boolean };

export type InvitationCanceled<Answer> = { readonly answer: Answer } | { readonly refused: Answer };

export interface WorkspaceInvitationsDependencies {
  readonly gate: () => boolean;
  readonly seal: (
    workspaceId: string,
  ) => (poll: boolean, after?: string) => Effect.Effect<WorkspaceInvitationsLiveAnswer | Unsealed>;
  readonly tell: (held: AppWorkspaceInvitations) => void;
  readonly pool: EntityPool;
  readonly entities?: () => EntityStore | undefined;
}

export interface WorkspaceInvitationsReads {
  readonly held: HeldSlice<string>;
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
  readonly made: (workspaceId: string, made: WorkspaceInvitation) => Effect.Effect<void>;
}

function rowOfInvitation(workspaceId: string, made: WorkspaceInvitation): PooledInvitation {
  return {
    workspaceId,
    id: made.id,
    email: made.email,
    role: made.role,
    expiresAt: Date.parse(made.expiresAt),
  };
}

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
      let open = true;
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
          confirmation: () => undefined,
          adopts: (row) => row.workspaceId === workspaceId,
        },
      );
      const waits = yield* carriedWaits(() => invitations.synced());
      yield* dependencies.stand(waits);
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
          workspaceInvitationsLiveRowsSchema,
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

export function workspaceInvitationsReads(
  dependencies: WorkspaceInvitationsDependencies,
): Effect.Effect<WorkspaceInvitationsReads, never, Scope.Scope> {
  return Effect.gen(function* () {
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
