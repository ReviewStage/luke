import { workspaceTokenRepositorySchema } from "@repo/features/github-repositories-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceSentryAnswerSchema } from "@repo/features/sentry-install-wire";
import { workspaceSlackBotAnswerSchema } from "@repo/features/slack-bot-wire";
import {
  tasksWorkspaceCreateParamsSchema,
  tasksWorkspaceExperimentSetParamsSchema,
  tasksWorkspaceInvitationCancelParamsSchema,
  tasksWorkspaceInviteParamsSchema,
  tasksWorkspaceLeaveParamsSchema,
  tasksWorkspaceMemberRemoveParamsSchema,
  tasksWorkspaceMemberRoleParamsSchema,
  tasksWorkspaceParamsSchema,
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
import {
  workspaceEnvironmentAnswerSchema,
  workspaceVariableDeleteRequestSchema,
  workspaceVariablePutRequestSchema,
} from "@repo/features/workspace-environment-wire";
import { workspaceInvitationSchema } from "@repo/features/workspace-invitation-wire";
import { workspaceMemberSchema, workspaceSchema } from "@repo/features/workspace-wire";
import { WORKSPACE_EXPERIMENT_LIST } from "@repo/settings";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * workspaces.ts -- the panel's asks of the host about the account's workspaces: its plain acts and live follows declared, and the procedures of the opened addresses beside them.
 *
 * Only a panel draws a workspace, so every act is the panel's alone. Each
 * plain act answers the value the panel reads, or is refused: a write the
 * account's role does not allow, an address already invited, or a slug
 * refused, each in words that say so, and anything else, the closed gate
 * among it, in the act's own sentence (`compose-workspaces.ts`'s
 * `workspaceAnswered`). A write that answers nothing the panel reads answers
 * `void`. A connection's handler answers the install address the service
 * named, which its procedure, written by hand, opens (`act-port/workspace-procedures.ts`),
 * answering the window nothing. Each per-workspace read is a live follow,
 * declared once (`live-follow.ts`).
 */

const members = EffectSchema.Array(workspaceMemberSchema);

/** The workspaces' plain acts, each answered by the tasks' composer. */
export const WORKSPACE_ACTS = declaredActs({
  WORKSPACE_CREATE: hostAct({
    input: tasksWorkspaceCreateParamsSchema,
    output: workspaceSchema,
    refusal: "Could not make that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_RENAME: hostAct({
    input: tasksWorkspaceRenameParamsSchema,
    output: workspaceSchema,
    refusal: "Could not rename that workspace on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_EXPERIMENT_SET: hostAct({
    input: EffectSchema.Struct({
      ...tasksWorkspaceExperimentSetParamsSchema.fields,
      experiment: EffectSchema.Literals(WORKSPACE_EXPERIMENT_LIST),
    }),
    output: workspaceSchema,
    refusal: "Could not change that experiment on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_INVITE: hostAct({
    input: tasksWorkspaceInviteParamsSchema,
    output: workspaceInvitationSchema,
    refusal: "Could not invite that address on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_INVITATION_CANCEL: hostAct({
    input: tasksWorkspaceInvitationCancelParamsSchema,
    output: EffectSchema.Array(workspaceInvitationSchema),
    refusal: "Could not cancel that invitation on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_GITHUB_CONNECT: hostAct({
    input: tasksWorkspaceParamsSchema,
    output: EffectSchema.String,
    portOutput: EffectSchema.Void,
    refusal: "Could not connect GitHub to that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    byHand: true,
  }),
  WORKSPACE_SENTRY_INSTALL: hostAct({
    input: tasksWorkspaceParamsSchema,
    output: EffectSchema.String,
    portOutput: EffectSchema.Void,
    refusal: "Could not install Sentry for that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    byHand: true,
  }),
  WORKSPACE_GITHUB_DISCONNECT: hostAct({
    input: tasksWorkspaceParamsSchema,
    output: EffectSchema.Void,
    refusal: "Could not disconnect GitHub from that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_SENTRY_DISCONNECT: hostAct({
    input: tasksWorkspaceSentryDisconnectParamsSchema,
    output: workspaceSentryAnswerSchema,
    refusal: "Could not disconnect Sentry from that workspace on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_SLACK_BOT_CONNECT: hostAct({
    input: tasksWorkspaceParamsSchema,
    output: workspaceSlackBotAnswerSchema,
    refusal: "Could not connect the Slack bot to that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_SLACK_BOT_DISCONNECT: hostAct({
    input: tasksWorkspaceParamsSchema,
    output: workspaceSlackBotAnswerSchema,
    refusal: "Could not disconnect the Slack bot from that workspace on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_SLACK_BOT_NOTIFICATIONS: hostAct({
    input: tasksWorkspaceSlackBotNotificationsParamsSchema,
    output: workspaceSlackBotAnswerSchema,
    refusal: "Could not change your Slack notifications on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_SLACK_BOT_REPOSITORY: hostAct({
    input: tasksWorkspaceSlackBotRepositoryParamsSchema,
    output: workspaceSlackBotAnswerSchema,
    refusal: "Could not change the Slack bot's default repository on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_SLACK_BOT_CHANNEL: hostAct({
    input: tasksWorkspaceSlackBotChannelParamsSchema,
    output: workspaceSlackBotAnswerSchema,
    refusal: "Could not change that Slack channel on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_MEMBER_REMOVE: hostAct({
    input: tasksWorkspaceMemberRemoveParamsSchema,
    output: members,
    refusal: "Could not remove that member on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_MEMBER_ROLE: hostAct({
    input: tasksWorkspaceMemberRoleParamsSchema,
    output: members,
    refusal: "Could not change that member's role on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_TRANSFER: hostAct({
    input: tasksWorkspaceTransferParamsSchema,
    output: members,
    refusal: "Could not transfer that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_LEAVE: hostAct({
    input: tasksWorkspaceLeaveParamsSchema,
    output: EffectSchema.Void,
    refusal: "Could not leave that workspace on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_PHOTO_SET: hostAct({
    input: tasksWorkspacePhotoSetParamsSchema,
    output: workspaceSchema,
    refusal: "Could not change that workspace's photo on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_SLUG_SET: hostAct({
    input: tasksWorkspaceSlugSetParamsSchema,
    output: workspaceSchema,
    refusal: "Could not change that workspace's link on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_TOKEN_REPOSITORY_SET: hostAct({
    input: tasksWorkspaceTokenRepositorySetParamsSchema,
    output: EffectSchema.Array(workspaceTokenRepositorySchema),
    refusal: "Could not change that workspace's repositories on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
  }),
  WORKSPACE_ENVIRONMENT_LIST: hostAct({
    input: tasksWorkspaceParamsSchema,
    output: workspaceEnvironmentAnswerSchema,
    refusal: "Could not read that workspace's environment on this system.",
    panelOnly: true,
    door: ACT.READ,
  }),
  WORKSPACE_ENVIRONMENT_PUT: hostAct({
    input: workspaceVariablePutRequestSchema,
    output: workspaceEnvironmentAnswerSchema,
    refusal: "Could not save that variable on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
  WORKSPACE_ENVIRONMENT_DELETE: hostAct({
    input: workspaceVariableDeleteRequestSchema,
    output: workspaceEnvironmentAnswerSchema,
    refusal: "Could not delete that variable on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
  }),
});

/** A workspace's people, invitations, own integrations, Slack channels, and token repositories, each followed for the panel while it draws them. */
export const WORKSPACE_FOLLOWS = liveFollows({
  WORKSPACE_MEMBERS_FOLLOW: liveFollow({
    slice: LIVE_READ.WORKSPACE_MEMBERS,
    hold: HOLD.WINDOW,
    key: workspacePeopleFollowSchema,
    refusal: "Could not follow that workspace's members on this system.",
    panelOnly: true,
    retry: {
      name: "WORKSPACE_MEMBERS_RETRY",
      refusal: "Could not read that workspace's members again on this system.",
    },
  }),
  WORKSPACE_INTEGRATIONS_FOLLOW: liveFollow({
    slice: LIVE_READ.WORKSPACE_INTEGRATIONS,
    hold: HOLD.WINDOW,
    key: tasksWorkspaceParamsSchema,
    refusal: "Could not follow that workspace's integrations on this system.",
    panelOnly: true,
    retry: {
      name: "WORKSPACE_INTEGRATIONS_RETRY",
      refusal: "Could not read that workspace's integrations again on this system.",
    },
  }),
  WORKSPACE_SLACK_CHANNELS_FOLLOW: liveFollow({
    slice: LIVE_READ.SLACK_CHANNELS,
    hold: HOLD.WINDOW,
    key: tasksWorkspaceParamsSchema,
    refusal: "Could not read that workspace's Slack channels on this system.",
    panelOnly: true,
    retry: {
      name: "WORKSPACE_SLACK_CHANNELS_RETRY",
      refusal: "Could not read that workspace's Slack channels again on this system.",
    },
  }),
  WORKSPACE_INVITATIONS_FOLLOW: liveFollow({
    slice: LIVE_READ.WORKSPACE_INVITATIONS,
    hold: HOLD.WINDOW,
    key: workspacePeopleFollowSchema,
    refusal: "Could not follow that workspace's invitations on this system.",
    panelOnly: true,
    retry: {
      name: "WORKSPACE_INVITATIONS_RETRY",
      refusal: "Could not read that workspace's invitations again on this system.",
    },
  }),
  WORKSPACE_TOKEN_REPOSITORIES_FOLLOW: liveFollow({
    slice: LIVE_READ.TOKEN_REPOSITORIES,
    hold: HOLD.WINDOW,
    key: tasksWorkspaceTokenRepositoriesParamsSchema,
    refusal: "Could not follow that workspace's repositories on this system.",
    panelOnly: true,
    retry: {
      name: "WORKSPACE_TOKEN_REPOSITORIES_RETRY",
      refusal: "Could not read that workspace's repositories again on this system.",
    },
  }),
});

export const workspaceActsContract = {
  ...contractOf(WORKSPACE_ACTS),
  ...followsContractOf(WORKSPACE_FOLLOWS),
};
