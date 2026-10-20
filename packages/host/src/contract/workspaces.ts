import { githubRepositoryIssuesAnswerSchema } from "@luke/features/github-repositories-wire";
import { linearIssueSummarySchema } from "@luke/features/linear-wire";
import {
  tasksGitHubIssuesParamsSchema,
  tasksLinearIssuesParamsSchema,
  tasksWorkspaceCreateParamsSchema,
  tasksWorkspaceInvitationCancelParamsSchema,
  tasksWorkspaceInviteParamsSchema,
  tasksWorkspaceLeaveParamsSchema,
  tasksWorkspaceMemberRemoveParamsSchema,
  tasksWorkspaceMemberRoleParamsSchema,
  tasksWorkspaceMembersParamsSchema,
  tasksWorkspaceParamsSchema,
  tasksWorkspacePhotoAnswerSchema,
  tasksWorkspacePhotoParamsSchema,
  tasksWorkspacePhotoSetParamsSchema,
  tasksWorkspaceRenameParamsSchema,
  tasksWorkspaceTransferParamsSchema,
} from "@luke/features/tasks-view";
import { workspaceInvitationSchema } from "@luke/features/workspace-invitation-wire";
import {
  formerMemberSchema,
  workspaceMemberSchema,
  workspaceSchema,
} from "@luke/features/workspace-wire";
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
  [WORKSPACE_ACT_KIND.WORKSPACE_INVITATIONS_READ]: actProcedure(
    "Could not read invitations on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(answersInvitations),
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
  [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT]: actProcedure(
    "Could not connect Linear to that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_DISCONNECT]: actProcedure(
    "Could not disconnect Linear from that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceParamsSchema))
    .output(EffectSchema.Void),
  [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_ISSUES]: actProcedure(
    "Could not read that workspace's Linear issues on this system.",
  )
    .input(exactInput(tasksLinearIssuesParamsSchema))
    .output(EffectSchema.flip(EffectSchema.Array(linearIssueSummarySchema))),
  [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_ISSUES]: actProcedure(
    "Could not read that repository's issues on this system.",
  )
    .input(exactInput(tasksGitHubIssuesParamsSchema))
    .output(EffectSchema.flip(githubRepositoryIssuesAnswerSchema)),
  [WORKSPACE_ACT_KIND.WORKSPACE_MEMBERS_READ]: actProcedure(
    "Could not read that workspace's members on this system.",
  )
    .input(exactInput(tasksWorkspaceMembersParamsSchema))
    .output(answersMembers),
  [WORKSPACE_ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: actProcedure(
    "Could not read who left that workspace on this system.",
  )
    .input(exactInput(tasksWorkspaceMembersParamsSchema))
    .output(EffectSchema.flip(EffectSchema.Array(formerMemberSchema))),
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
};
