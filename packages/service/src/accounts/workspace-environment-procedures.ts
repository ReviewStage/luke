/**
 * workspace-environment-procedures.ts -- a workspace's environment variables and secrets: read them, save one, remove one.
 *
 * Three procedures the signed-in desktop calls with its bearer, each naming
 * the workspace in its body (`workspace-environment-wire.ts`):
 *
 * - `POST /api/workspaces/environment` takes any member, and answers the
 *   list: a variable with its value, a secret by its hint alone.
 * - `POST /api/workspaces/environment/save` takes an owner or admin, seals
 *   the value under the deployment's ring whatever its kind, and keeps it
 *   under the name, replacing what the name held.
 * - `POST /api/workspaces/environment/remove` takes an owner or admin.
 *
 * Every answer is the list as it then stands. The one body that holds a
 * secret's value is the save's own; it is sealed the moment it is read and
 * never logged. A value the ring can no longer open answers unreadable, and
 * reaches no sandbox (`agents/coder-host/workspace-environment.ts`) until it
 * is saved again. A workspace the account is not in is not found, whatever
 * it asked; a deployment holding no ring answers unavailable. The bearer is
 * resolved before the body is read, by the middleware on the resource.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type KeyRing,
  openEnvironmentValue,
  sealEnvironmentValue,
} from "@luke/database/models/provider-key-seal";
import {
  listWorkspaceEnvironmentRows,
  removeWorkspaceEnvironmentValue,
  saveWorkspaceEnvironmentValue,
  sealedOf,
  type WorkspaceEnvironmentRow,
} from "@luke/database/models/workspace-environment-store";
import { type Workspace, workspaceOf } from "@luke/database/models/workspace-store";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentAnswer,
  type WorkspaceEnvironmentEntry,
} from "@luke/features/workspace-environment-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import { DateTime, Effect, Option, Redacted, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { keyRingMiddleware } from "./provider-keys-procedures.js";

/** How many of a secret's last characters its hint shows, and the shortest secret that shows any. */
const SECRET_HINT = { SHOWN_CHARS: 4, MIN_CHARS: 12 } as const;

export interface WorkspaceEnvironmentProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace named, as the account sees it; one it is not in is not found, and one it does not manage is refused where it must. */
const workspaceFor = Effect.fn("web/workspaceEnvironmentWorkspace")(function* (
  userId: string,
  workspaceId: string,
  managing: boolean,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (managing && !managesWorkspace(workspace.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return workspace.value;
});

/** A secret's hint: its last characters, where it is long enough that they give nothing away. */
function secretHint(value: string): string {
  if (value.length < SECRET_HINT.MIN_CHARS) return "";
  return `…${value.slice(-SECRET_HINT.SHOWN_CHARS)}`;
}

/** One row as a member is shown it: a variable's value opened, a secret's hint alone. */
function entryOf(
  ring: KeyRing,
  organizationId: string,
  row: WorkspaceEnvironmentRow,
): WorkspaceEnvironmentEntry {
  const opened = openEnvironmentValue(ring, { organizationId, name: row.name }, sealedOf(row));
  const entry: WorkspaceEnvironmentEntry = {
    name: row.name,
    kind: row.kind,
    readable: Result.isSuccess(opened),
    updatedAt: row.updatedAt.getTime(),
  };
  if (row.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET) return { ...entry, hint: row.hint };
  return Result.isSuccess(opened) ? { ...entry, value: Redacted.value(opened.success) } : entry;
}

/** The workspace's list as it stands, with why a save kept nothing where it did. */
const listOf = Effect.fn("web/workspaceEnvironmentList")(function* (
  ring: KeyRing,
  organizationId: string,
  rejected?: WorkspaceEnvironmentAnswer["rejected"],
) {
  const rows = yield* hostedStoreOrUnavailable(listWorkspaceEnvironmentRows(organizationId));
  const answer: WorkspaceEnvironmentAnswer = {
    entries: rows.map((row) => entryOf(ring, organizationId, row)),
    ...(rejected === undefined ? undefined : { rejected }),
  };
  return answer;
});

/** The workspace environment resource: the list to any member, a save or a removal to an owner or admin. */
export function workspaceEnvironmentProcedures(seams: WorkspaceEnvironmentProcedureSeams) {
  const resource = hosted.workspaceEnvironment
    .use(accountMiddleware(seams.resolveUserId))
    .use(keyRingMiddleware);
  return {
    list: resource.list.effect(function* ({ input, context }) {
      const workspace = yield* workspaceFor(context.userId, input.workspaceId, false);
      return yield* listOf(context.ring, workspace.id);
    }),
    /** Keeps the value sealed under the name, unless it names a new one past the workspace's bound. */
    save: resource.save.effect(function* ({ input, context }) {
      const { userId, ring } = context;
      const workspace = yield* workspaceFor(userId, input.workspaceId, true);
      const standing = yield* hostedStoreOrUnavailable(listWorkspaceEnvironmentRows(workspace.id));
      const isNew = !standing.some((row) => row.name === input.name);
      if (isNew && standing.length >= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_ENTRIES) {
        return yield* listOf(ring, workspace.id, WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY);
      }
      const value = Redacted.make(input.secretValue);
      const sealed = sealEnvironmentValue(
        ring,
        { organizationId: workspace.id, name: input.name },
        value,
      );
      const hint =
        input.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET ? secretHint(input.secretValue) : "";
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(
        saveWorkspaceEnvironmentValue(
          workspace.id,
          input.name,
          input.kind,
          sealed,
          hint,
          userId,
          now,
        ),
      );
      return yield* listOf(ring, workspace.id);
    }),
    remove: resource.remove.effect(function* ({ input, context }) {
      const workspace = yield* workspaceFor(context.userId, input.workspaceId, true);
      yield* hostedStoreOrUnavailable(removeWorkspaceEnvironmentValue(workspace.id, input.name));
      return yield* listOf(context.ring, workspace.id);
    }),
  };
}
