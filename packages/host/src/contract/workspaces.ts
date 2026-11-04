import { eventIterator, type } from "@orpc/contract";
import { workspaceTokenRepositorySchema } from "@repo/features/github-repositories-wire";
import { workspaceSentryAnswerSchema } from "@repo/features/sentry-install-wire";
import { workspaceSlackBotAnswerSchema } from "@repo/features/slack-bot-wire";
import {
  tasksWorkspaceCreateParamsSchema,
  tasksWorkspaceInvitationCancelParamsSchema,
  tasksWorkspaceInviteParamsSchema,
  tasksWorkspaceLeaveParamsSchema,
  tasksWorkspaceMemberRemoveParamsSchema,
  tasksWorkspaceMemberRoleParamsSchema,
  tasksWorkspaceParamsSchema,
  tasksWorkspacePhotoAnswerSchema,
  tasksWorkspacePhotoParamsSchema,
  tasksWorkspacePhotoSetParamsSchema,
  tasksWorkspaceRenameParamsSchema,
  tasksWorkspaceSentryDisconnectParamsSchema,
  tasksWorkspaceSlackBotChannelParamsSchema,
  tasksWorkspaceSlackBotNotificationsParamsSchema,
  tasksWorkspaceSlackBotRepositoryParamsSchema,
  tasksWorkspaceSlugSetParamsSchema,
  tasksWorkspaceTokenRepositoriesParamsSchema,
  tasksWorkspaceTokenRepositorySetParamsSchema,
  tasksWorkspaceTransferParamsSchema,
  workspacePeopleFollowSchema,
} from "@repo/features/tasks-view";
import { workspaceInvitationSchema } from "@repo/features/workspace-invitation-wire";
import { workspaceMemberSchema, workspaceSchema } from "@repo/features/workspace-wire";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { WORKSPACE_ACT_KIND } from "./kinds.js";

/**
 * workspaces.ts -- the panel's asks of the host about the account's workspaces, as procedures.
 *
 * Each output is its value's schema flipped, so oRPC's output check encodes
 * the row's value into what crosses the port; a write that answers nothing
 * the panel reads answers `void`.
 */

const answersWorkspace = EffectSchema.flip(workspaceSchema);
const answersInvitations = EffectSchema.flip(EffectSchema.Array(workspaceInvitationSchema));
const answersMembers = EffectSchema.flip(EffectSchema.Array(workspaceMemberSchema));
const answersTokenRepositories = EffectSchema.flip(
  EffectSchema.Array(workspaceTokenRepositorySchema),
);

export const workspaceActsContract = {
  [WORKSPACE_ACT_KIND.WORKSPACE_CREATE]: actProcedure(
    "Could not make that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceCreateParamsSchema))
    .output(answersWorkspace),
  [WORKSPACE_ACT_KIND.WORKSPACE_RENAME]: actProcedure(
    "Could not rename that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceRenameParamsSchema))
    .output(answersWorkspace),
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITE]: actProcedure(
    "Could not invite that address on this system.",
  )
    .input(exactInput(tasksWorkspaceInviteParamsSchema))
    .output(EffectSchema.flip(workspaceInvitationSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITATION_CANCEL]: actProcedure(
    "Could not cancel that invitation on this system.",
  )
    .input(exactInput(tasksWorkspaceInvitationCancelParamsSchema))
    .output(answersInvitations),
  [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: actProcedure(
    "Could not connect GitHub to that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_DISCONNECT]: actProcedure(
    "Could not disconnect GitHub from that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_READ]: actProcedure(
    "Could not read that workspace's Sentry on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.flip(workspaceSentryAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_INSTALL]: actProcedure(
    "Could not install Sentry for that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_SENTRY_DISCONNECT]: actProcedure(
    "Could not disconnect Sentry from that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceSentryDisconnectParamsSchema))
    .output(EffectSchema.flip(workspaceSentryAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_READ]: actProcedure(
    "Could not read that workspace's Slack bot on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CONNECT]: actProcedure(
    "Could not connect the Slack bot to that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_DISCONNECT]: actProcedure(
    "Could not disconnect the Slack bot from that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_NOTIFICATIONS]: actProcedure(
    "Could not change your Slack notifications on this system.",
  )
    .input(exactInput(tasksWorkspaceSlackBotNotificationsParamsSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_REPOSITORY]: actProcedure(
    "Could not change the Slack bot's default repository on this system.",
  )
    .input(exactInput(tasksWorkspaceSlackBotRepositoryParamsSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLACK_BOT_CHANNEL]: actProcedure(
    "Could not change that Slack channel on this system.",
  )
    .input(exactInput(tasksWorkspaceSlackBotChannelParamsSchema))
    .output(EffectSchema.flip(workspaceSlackBotAnswerSchema)),
  // Note that the hold's stream carries nothing: the held people reach the panel on app state, and the stream is the window's hold on them.
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_FOLLOW]: actProcedure(
    "Could not follow that workspace's members on this system.",
  )
    .input(exactInput(workspacePeopleFollowSchema))
    .output(eventIterator(type<never>())),
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_RETRY]: actProcedure(
    "Could not read that workspace's members again on this system.",
  )
    .input(exactInput(workspacePeopleFollowSchema))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing, as the people's does.
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_FOLLOW]: actProcedure(
    "Could not follow that workspace's invitations on this system.",
  )
    .input(exactInput(workspacePeopleFollowSchema))
    .output(eventIterator(type<never>())),
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_RETRY]: actProcedure(
    "Could not read that workspace's invitations again on this system.",
  )
    .input(exactInput(workspacePeopleFollowSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_REMOVE]: actProcedure(
    "Could not remove that member on this system.",
  )
    .input(exactInput(tasksWorkspaceMemberRemoveParamsSchema))
    .output(answersMembers),
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBER_ROLE]: actProcedure(
    "Could not change that member's role on this system.",
  )
    .input(exactInput(tasksWorkspaceMemberRoleParamsSchema))
    .output(answersMembers),
  [WORKSPACE_ACT_KIND.WORKSPACE_TRANSFER]: actProcedure(
    "Could not transfer that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceTransferParamsSchema))
    .output(answersMembers),
  [WORKSPACE_ACT_KIND.WORKSPACE_LEAVE]: actProcedure(
    "Could not leave that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceLeaveParamsSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_READ]: actProcedure(
    "Could not read that workspace's photo on this system.",
  )
    .input(exactInput(tasksWorkspacePhotoParamsSchema))
    .output(EffectSchema.flip(tasksWorkspacePhotoAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_PHOTO_SET]: actProcedure(
    "Could not change that workspace's photo on this system.",
  )
    .input(exactInput(tasksWorkspacePhotoSetParamsSchema))
    .output(answersWorkspace),
  [WORKSPACE_ACT_KIND.WORKSPACE_SLUG_SET]: actProcedure(
    "Could not change that workspace's link on this system.",
  )
    .input(exactInput(tasksWorkspaceSlugSetParamsSchema))
    .output(answersWorkspace),
  [WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_READ]: actProcedure(
    "Could not read that workspace's repositories on this system.",
  )
    .input(exactInput(tasksWorkspaceTokenRepositoriesParamsSchema))
    .output(answersTokenRepositories),
  [WORKSPACE_ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET]: actProcedure(
    "Could not change that workspace's repositories on this system.",
  )
    .input(exactInput(tasksWorkspaceTokenRepositorySetParamsSchema))
    .output(answersTokenRepositories),
};
