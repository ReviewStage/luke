import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AdminWorkspaceDetail,
  AdminWorkspaceInstallation,
  AdminWorkspaceMember,
  AdminWorkspaceRow,
} from "@repo/features/admin-answer-wire";
import { type AdminWorkspaceQuery, adminWorkspaceId } from "@repo/features/admin-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { Clock, Effect } from "effect";
import { ADMIN_WORKSPACES_ACTIVITY_DAYS } from "./admin-workspaces.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export interface AdminWorkspaceDetailSource {
  row: Omit<AdminWorkspaceRow, "owner" | "installations">;
  members: readonly AdminWorkspaceMember[];
  installations: readonly AdminWorkspaceInstallation[];
}

export function buildAdminWorkspaceDetail(
  source: AdminWorkspaceDetailSource,
  now: number,
): AdminWorkspaceDetail {
  const owner = source.members.find((each) => each.role === WORKSPACE_ROLE.OWNER);
  return {
    generatedAt: now,
    activityDays: ADMIN_WORKSPACES_ACTIVITY_DAYS,
    workspace: {
      ...source.row,
      owner: owner?.account ?? null,
      installations: [...source.installations],
    },
    members: [...source.members],
  };
}

export interface AdminWorkspaceOptions {
  query: AdminWorkspaceQuery;
  readWorkspace: (id: string, now: number) => AdminSeamEffect<AdminWorkspaceDetail | undefined>;
}

export function handleAdminWorkspace(
  options: AdminWorkspaceOptions,
): Effect.Effect<AdminWorkspaceDetail, AdminRefusal, DatabaseServices> {
  const id = adminWorkspaceId(options.query.id);
  if (id === undefined) return Effect.fail(ADMIN_REFUSAL.MISSING_WORKSPACE_ID);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options.readWorkspace(id, now).pipe(
      Effect.catchCause((cause) => unavailableSeam("admin workspace read failed", cause)),
      Effect.flatMap((detail) =>
        detail === undefined
          ? Effect.fail(ADMIN_REFUSAL.WORKSPACE_NOT_FOUND)
          : Effect.succeed(detail),
      ),
    ),
  );
}
