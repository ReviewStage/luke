/**
 * installed-skills.ts -- the skills the account sees in a workspace, as a live read bound: its one statement, the tables it reads, the topics that wake it, and who it admits.
 *
 * The workspace's skills while the reader is a member of it, and the
 * reader's own personal ones, each with whether the reader may manage it,
 * by the store's own rule (`manageableBy`), and the workspace a workspace
 * skill is, null for a personal one (`INSTALLED_SKILLS_READ`). A workspace
 * the reader is no member of is answered as not found.
 *
 * It is woken on the workspace's skills topic by one of the workspace's
 * skills installed, changed, shared into it, or removed, on the account's
 * own skills topic by one of its personal skills, and on the account's
 * topic by its membership made, ended, or given another role, which decides
 * what it reads and may manage.
 */

import { queryBuilder } from "@repo/database/core/query";
import { manageableBy, offeredIn } from "@repo/database/models/installed-skill-store";
import { installedSkill } from "@repo/database/schemas/installed-skill";
import { TOPIC } from "@repo/database/sync/notification";
import { installedSkillSync, memberSync } from "@repo/database/sync/tables";
import { INSTALLED_SKILLS_READ } from "@repo/features/installed-skill-live";
import { sql } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";
import { admitWorkspaceMember } from "./workspace-member.js";

export const installedSkillsRead = bindLiveRead(INSTALLED_SKILLS_READ, {
  reads: [installedSkillSync, memberSync],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.WORKSPACE_SKILLS, workspaceId],
    [TOPIC.ACCOUNT_SKILLS, userId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId }) => ({
    skills: liveRowsStatement(
      INSTALLED_SKILLS_READ.parts.skills,
      {
        ordered: false,
        columns: {
          id: installedSkill.id,
          scope: installedSkill.scope,
          name: installedSkill.name,
          description: installedSkill.description,
          userInvocable: installedSkill.userInvocable,
          source: installedSkill.source,
          // Note that every skill is on, and a desktop released before the switch went still reads it.
          enabled: sql<true>`true`,
          workspaceId: installedSkill.organizationId,
          installedBy: installedSkill.installedByUserId,
          manageable: manageableBy(userId),
        },
        instants: { createdAt: installedSkill.createdAt, updatedAt: installedSkill.updatedAt },
      },
      (selection) =>
        queryBuilder.select(selection).from(installedSkill).where(offeredIn(userId, workspaceId)),
    ),
  }),
  admit: admitWorkspaceMember,
});
