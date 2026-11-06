/**
 * admin-workspace.ts -- one workspace's page: the counts its row in the
 * Workspaces table carries, every member, and the GitHub accounts its
 * installations are on.
 *
 * It names what the table names and the members' accounts beside it, the
 * same faces every dashboard table draws, so a maintainer can walk from a
 * workspace to the people in it and back; never a task's title, a description's
 * text, or anything a member wrote.
 */

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

/** What the queries read for one workspace, before the builder folds its owner onto its row. */
export interface AdminWorkspaceDetailSource {
  row: Omit<AdminWorkspaceRow, "owner" | "installations">;
  /** Owners first, then the earliest to join. */
  members: readonly AdminWorkspaceMember[];
  /** The first linked first. */
  installations: readonly AdminWorkspaceInstallation[];
}

/** Shapes one queried workspace into the page's answer, its owner the earliest owner, as the table names it. */
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
  /** The named workspace's page, or nothing when no workspace carries that id. */
  readWorkspace: (id: string, now: number) => AdminSeamEffect<AdminWorkspaceDetail | undefined>;
}

/**
 * Answers one workspace's read behind the gate every admin read stands
 * behind: a request naming no workspace is a 400 before any seam is touched,
 * and an id no workspace carries a 404 the page words as the workspace being
 * gone rather than the service being down, as the account's read answers.
 */
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
