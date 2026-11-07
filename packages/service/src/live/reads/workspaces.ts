/**
 * workspaces.ts -- the account's workspaces' live read bound: its three statements, the tables they read, and the topics that wake it.
 *
 * The same rows, joins, and rule of who may read them as `listWorkspaces`
 * (`WORKSPACES_READ`). What the held read works out from a row is worked
 * out in the statement, so a row carries no photo's bytes: its digest
 * (`LIVE_PHOTO_VERSION`), and an installation's standing. Note that
 * `linearActive` is still answered, as null, because a desktop from v0.22.0
 * fails its follow on a row without it: no workspace connects Linear any
 * more. The key goes with the minimum supported desktop version, not with a
 * service deploy.
 *
 * It is woken on the account's topic and on each of its workspaces'. A
 * workspace's name and photo, the slugs it stood under before, its members,
 * its installations, the experiments chosen for it and who chose each, and
 * the name of the account it was made for name the workspace; the account's memberships, its first workspace, and its own
 * picture name the account.
 */

import { queryBuilder } from "@repo/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@repo/database/github-installation-vocabulary";
import {
  FORMER_SLUGS,
  LIVE_PHOTO_VERSION,
  WORKSPACE_NAME,
} from "@repo/database/models/workspace-store";
import { member, organization, user } from "@repo/database/schemas/auth";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { workspaceExperiment } from "@repo/database/schemas/workspace-experiment";
import {
  githubInstallationSync,
  memberSync,
  organizationSync,
  personalWorkspaceSync,
  userSync,
  workspaceExperimentSync,
  workspaceFormerSlugSync,
} from "@repo/database/sync/tables";
import { WORKSPACES_READ } from "@repo/features/workspace-live";
import { and, eq, sql } from "drizzle-orm";
import { readerAndWorkspaceTopics } from "../../sync/reader-topics.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const workspacesRead = bindLiveRead(WORKSPACES_READ, {
  reads: [
    memberSync,
    organizationSync,
    personalWorkspaceSync,
    userSync,
    githubInstallationSync,
    workspaceFormerSlugSync,
    workspaceExperimentSync,
  ],
  topics: ({ userId }) => readerAndWorkspaceTopics(userId),
  statements: ({ userId }) => ({
    workspaces: liveRowsStatement(
      WORKSPACES_READ.parts.workspaces,
      {
        ordered: false,
        columns: {
          id: organization.id,
          name: WORKSPACE_NAME,
          slug: organization.slug,
          own: sql<boolean>`${personalWorkspace.userId} is not null`,
          personal: sql<boolean>`exists(select 1 from ${personalWorkspace} as "first" where "first"."organization_id" = ${organization.id})`,
          role: member.role,
          linearActive: sql<null>`null::boolean`,
          memberCount: sql<number>`(select count(*)::int from ${member} as "members" where "members"."organization_id" = ${organization.id})`,
          photoVersion: LIVE_PHOTO_VERSION,
          // Note that the owner is left-joined on the reader's own first workspace alone, so their picture is null on every other.
          ownerImage: sql<string | null>`${user.image}`,
          formerSlugs: FORMER_SLUGS,
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(member)
          .innerJoin(organization, eq(organization.id, member.organizationId))
          .leftJoin(
            personalWorkspace,
            and(
              eq(personalWorkspace.organizationId, organization.id),
              eq(personalWorkspace.userId, userId),
            ),
          )
          .leftJoin(user, eq(user.id, personalWorkspace.userId))
          .where(eq(member.userId, userId)),
    ),
    installations: liveRowsStatement(
      WORKSPACES_READ.parts.installations,
      {
        ordered: false,
        columns: {
          workspaceId: githubInstallation.organizationId,
          installationId: sql<number>`${githubInstallation.installationId}::float8`,
          login: githubInstallation.accountLogin,
          active: sql<boolean>`${githubInstallation.status} = ${GITHUB_INSTALLATION_STATUS.ACTIVE}`,
        },
        instants: { linkedAt: githubInstallation.createdAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(githubInstallation)
          .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
          .where(eq(member.userId, userId)),
    ),
    experiments: liveRowsStatement(
      WORKSPACES_READ.parts.experiments,
      {
        ordered: false,
        columns: {
          workspaceId: workspaceExperiment.organizationId,
          experiment: workspaceExperiment.experiment,
          on: workspaceExperiment.on,
          changedById: workspaceExperiment.changedBy,
          // Note that who changed it is left-joined, so their name is null once their account is gone.
          changedByName: sql<string | null>`${user.name}`,
        },
        instants: { changedAt: workspaceExperiment.changedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(workspaceExperiment)
          .innerJoin(member, eq(member.organizationId, workspaceExperiment.organizationId))
          .leftJoin(user, eq(user.id, workspaceExperiment.changedBy))
          .where(eq(member.userId, userId)),
    ),
  }),
});
