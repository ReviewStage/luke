import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@luke/wire/testing";
import { test } from "vitest";
import * as accountInboxWire from "./account-inbox-wire.js";
import * as boardWire from "./board-wire.js";
import * as chatWire from "./chat-wire.js";
import * as codingAgentView from "./coding-agent-view.js";
import * as codingAgentWire from "./coding-agent-wire.js";
import * as dictationWire from "./dictation-wire.js";
import * as factoryWorldWire from "./factory-world-wire.js";
import * as githubConnectionWire from "./github-connection-wire.js";
import * as githubRepositoriesWire from "./github-repositories-wire.js";
import * as inboxWire from "./inbox-wire.js";
import * as integrationView from "./integration-view.js";
import * as integrationWire from "./integration-wire.js";
import * as issueView from "./issue-view.js";
import * as issueWire from "./issue-wire.js";
import * as linearWire from "./linear-wire.js";
import * as liveContract from "./live-contract.js";
import * as modelsWire from "./models-wire.js";
import * as pictureWire from "./picture-wire.js";
import * as pinOrder from "./pin-order.js";
import * as planAttachmentWire from "./plan-attachment-wire.js";
import * as planCommentWire from "./plan-comment-wire.js";
import * as planDocumentTemplate from "./plan-document-template.js";
import * as planEdit from "./plan-edit.js";
import * as providerKeyWire from "./provider-key-wire.js";
import * as pullRequestArea from "./pull-request-area.js";
import * as pullRequestWriteWire from "./pull-request-write-wire.js";
import * as repositoryReachWire from "./repository-reach-wire.js";
import * as serviceWire from "./service-wire.js";
import * as taskSectionWire from "./task-section-wire.js";
import * as taskWire from "./task-wire.js";
import * as transcriptWire from "./transcript-wire.js";
import * as workspaceWire from "./workspace-wire.js";

/**
 * Every schema the hosted wire declares, as the JSON Schema it emits. A wire
 * schema's bytes are what a client and the service hold each other to, so
 * they are recorded the same way a tool definition's are, and each module's
 * set is typed against the module itself: a schema added there does not
 * compile until it is recorded here. Every module in this package declares
 * its schemas directly as Effect's own, so every set below is
 * `RecordedEffectJsonSchemas`.
 */

const ROOT = jsonSchemaGoldenRoot(import.meta.url);

const EFFECT_MODULE_SCHEMAS = {
  "account-inbox-wire": {
    accountInboxEntrySchema: accountInboxWire.accountInboxEntrySchema,
    accountInboxTaskSchema: accountInboxWire.accountInboxTaskSchema,
    accountTasklessEntrySchema: accountInboxWire.accountTasklessEntrySchema,
    accountInboxAutomationSchema: accountInboxWire.accountInboxAutomationSchema,
    accountFailedRunSchema: accountInboxWire.accountFailedRunSchema,
    accountChatEntrySchema: accountInboxWire.accountChatEntrySchema,
    accountInboxAnswerSchema: accountInboxWire.accountInboxAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof accountInboxWire>,
  "board-wire": {
    boardElementSchema: boardWire.boardElementSchema,
    boardElementsSchema: boardWire.boardElementsSchema,
    boardSchema: boardWire.boardSchema,
    boardAnswerSchema: boardWire.boardAnswerSchema,
    boardSaveRequestSchema: boardWire.boardSaveRequestSchema,
    drawingElementsSchema: boardWire.drawingElementsSchema,
  } satisfies RecordedEffectJsonSchemas<typeof boardWire>,
  "chat-wire": {
    chatImageTypeSchema: chatWire.chatImageTypeSchema,
    chatKeySchema: chatWire.chatKeySchema,
    chatChannelNameSchema: chatWire.chatChannelNameSchema,
    chatHandleSchema: chatWire.chatHandleSchema,
    chatTargetSchema: chatWire.chatTargetSchema,
    chatBlockSchema: chatWire.chatBlockSchema,
    chatBlocksSchema: chatWire.chatBlocksSchema,
    chatPostBlockSchema: chatWire.chatPostBlockSchema,
    chatPostBlocksSchema: chatWire.chatPostBlocksSchema,
    chatOptionSchema: chatWire.chatOptionSchema,
    chatFieldSchema: chatWire.chatFieldSchema,
    chatResponseSchema: chatWire.chatResponseSchema,
    chatAskSchema: chatWire.chatAskSchema,
    chatFieldValueSchema: chatWire.chatFieldValueSchema,
    chatFormValueSchema: chatWire.chatFormValueSchema,
    chatFormValuesSchema: chatWire.chatFormValuesSchema,
    chatReplySchema: chatWire.chatReplySchema,
    chatReadBlockSchema: chatWire.chatReadBlockSchema,
    chatReadResponseSchema: chatWire.chatReadResponseSchema,
    postChatInputSchema: chatWire.postChatInputSchema,
    postChatAskInputSchema: chatWire.postChatAskInputSchema,
    readChatInputSchema: chatWire.readChatInputSchema,
    resolveAskInputSchema: chatWire.resolveAskInputSchema,
    editChannelInputSchema: chatWire.editChannelInputSchema,
    chatMemberSchema: chatWire.chatMemberSchema,
    chatChannelSchema: chatWire.chatChannelSchema,
    chatMessageAskSchema: chatWire.chatMessageAskSchema,
    chatMessageSchema: chatWire.chatMessageSchema,
    chatCursorSchema: chatWire.chatCursorSchema,
    chatChannelReadSchema: chatWire.chatChannelReadSchema,
    chatAnswerSchema: chatWire.chatAnswerSchema,
    chatPostRequestSchema: chatWire.chatPostRequestSchema,
    chatAnswerRequestSchema: chatWire.chatAnswerRequestSchema,
    chatResolveRequestSchema: chatWire.chatResolveRequestSchema,
    chatReadToRequestSchema: chatWire.chatReadToRequestSchema,
    chatOpenRequestSchema: chatWire.chatOpenRequestSchema,
    chatEditRequestSchema: chatWire.chatEditRequestSchema,
    chatWriteRequestSchema: chatWire.chatWriteRequestSchema,
    chatReceiptSchema: chatWire.chatReceiptSchema,
    chatWriteAnswerSchema: chatWire.chatWriteAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof chatWire>,
  "coding-agent-wire": {
    contextWindowSchema: codingAgentWire.contextWindowSchema,
    codingAgentStartRequestSchema: codingAgentWire.codingAgentStartRequestSchema,
    codingAgentMessageRequestSchema: codingAgentWire.codingAgentMessageRequestSchema,
    codingAgentRenameRequestSchema: codingAgentWire.codingAgentRenameRequestSchema,
    codingAgentArchiveRequestSchema: codingAgentWire.codingAgentArchiveRequestSchema,
    codingAgentPinRequestSchema: codingAgentWire.codingAgentPinRequestSchema,
    codingAgentArchivedBySchema: codingAgentWire.codingAgentArchivedBySchema,
    disabledServersSchema: codingAgentWire.disabledServersSchema,
    codingAgentServersRequestSchema: codingAgentWire.codingAgentServersRequestSchema,
    codingAgentSummarySchema: codingAgentWire.codingAgentSummarySchema,
    codingAgentAnswerSchema: codingAgentWire.codingAgentAnswerSchema,
    codingAgentOriginSchema: codingAgentWire.codingAgentOriginSchema,
    codingAgentPageSchema: codingAgentWire.codingAgentPageSchema,
    codingAgentPageAnswerSchema: codingAgentWire.codingAgentPageAnswerSchema,
    tasklessAgentSchema: codingAgentWire.tasklessAgentSchema,
    codingAgentListAnswerSchema: codingAgentWire.codingAgentListAnswerSchema,
    codingAgentMessageSchema: codingAgentWire.codingAgentMessageSchema,
    codingAgentCursorSchema: codingAgentWire.codingAgentCursorSchema,
    codingAgentUsageSchema: codingAgentWire.codingAgentUsageSchema,
    codingAgentContextSchema: codingAgentWire.codingAgentContextSchema,
    codingAgentMessagesAnswerSchema: codingAgentWire.codingAgentMessagesAnswerSchema,
    codingAgentPullRequestSchema: codingAgentWire.codingAgentPullRequestSchema,
    codingAgentPullRequestAnswerSchema: codingAgentWire.codingAgentPullRequestAnswerSchema,
    codingAgentChangesAnswerSchema: codingAgentWire.codingAgentChangesAnswerSchema,
    codingAgentOverviewPullRequestAnswerSchema:
      codingAgentWire.codingAgentOverviewPullRequestAnswerSchema,
    codingAgentReviewOptionsAnswerSchema: codingAgentWire.codingAgentReviewOptionsAnswerSchema,
    codingAgentOverviewChecksAnswerSchema: codingAgentWire.codingAgentOverviewChecksAnswerSchema,
    codingAgentOverviewConversationAnswerSchema:
      codingAgentWire.codingAgentOverviewConversationAnswerSchema,
    codingAgentCallIdSchema: codingAgentWire.codingAgentCallIdSchema,
    codingAgentDelegationInputSchema: codingAgentWire.codingAgentDelegationInputSchema,
    codingAgentDelegationOutputSchema: codingAgentWire.codingAgentDelegationOutputSchema,
    codingAgentTodosInputSchema: codingAgentWire.codingAgentTodosInputSchema,
    storedObjectSchema: codingAgentWire.storedObjectSchema,
  } satisfies RecordedEffectJsonSchemas<typeof codingAgentWire>,
  "inbox-wire": {
    inboxKeySchema: inboxWire.inboxKeySchema,
    inboxImageTypeSchema: inboxWire.inboxImageTypeSchema,
    inboxBlockSchema: inboxWire.inboxBlockSchema,
    inboxWordBlockSchema: inboxWire.inboxWordBlockSchema,
    inboxBlocksSchema: inboxWire.inboxBlocksSchema,
    inboxPostBlockSchema: inboxWire.inboxPostBlockSchema,
    inboxPostBlocksSchema: inboxWire.inboxPostBlocksSchema,
    inboxOptionSchema: inboxWire.inboxOptionSchema,
    inboxFieldSchema: inboxWire.inboxFieldSchema,
    inboxResponseSchema: inboxWire.inboxResponseSchema,
    inboxPostInputSchema: inboxWire.inboxPostInputSchema,
    inboxCloseInputSchema: inboxWire.inboxCloseInputSchema,
    inboxReadInputSchema: inboxWire.inboxReadInputSchema,
    inboxReplyInputSchema: inboxWire.inboxReplyInputSchema,
    inboxFieldValueSchema: inboxWire.inboxFieldValueSchema,
    inboxFormValueSchema: inboxWire.inboxFormValueSchema,
    inboxFormValuesSchema: inboxWire.inboxFormValuesSchema,
    inboxReplySchema: inboxWire.inboxReplySchema,
    inboxReadBlockSchema: inboxWire.inboxReadBlockSchema,
    inboxReadResponseSchema: inboxWire.inboxReadResponseSchema,
    inboxAnswerFileSchema: inboxWire.inboxAnswerFileSchema,
    inboxMessageSchema: inboxWire.inboxMessageSchema,
    inboxItemSchema: inboxWire.inboxItemSchema,
    inboxCursorSchema: inboxWire.inboxCursorSchema,
    inboxAnswerSchema: inboxWire.inboxAnswerSchema,
    inboxAnswerRequestSchema: inboxWire.inboxAnswerRequestSchema,
    inboxAnsweredSchema: inboxWire.inboxAnsweredSchema,
    inboxMessageRequestSchema: inboxWire.inboxMessageRequestSchema,
    inboxMessagedSchema: inboxWire.inboxMessagedSchema,
    inboxReadStateSchema: inboxWire.inboxReadStateSchema,
    inboxReadAllRequestSchema: inboxWire.inboxReadAllRequestSchema,
    inboxReadAllSchema: inboxWire.inboxReadAllSchema,
  } satisfies RecordedEffectJsonSchemas<typeof inboxWire>,
  "coding-agent-view": {
    codingAgentModelsAnswerSchema: codingAgentView.codingAgentModelsAnswerSchema,
    codingAgentDefaultAnswerViewSchema: codingAgentView.codingAgentDefaultAnswerViewSchema,
    codingAgentDefaultWriteParamsSchema: codingAgentView.codingAgentDefaultWriteParamsSchema,
    planTemplateAnswerViewSchema: codingAgentView.planTemplateAnswerViewSchema,
    planTemplateWriteParamsSchema: codingAgentView.planTemplateWriteParamsSchema,
    planTemplateRevisionsParamsSchema: codingAgentView.planTemplateRevisionsParamsSchema,
    planTemplateRevisionsAnswerViewSchema: codingAgentView.planTemplateRevisionsAnswerViewSchema,
    planTemplateRevisionParamsSchema: codingAgentView.planTemplateRevisionParamsSchema,
    planTemplateRevisionAnswerViewSchema: codingAgentView.planTemplateRevisionAnswerViewSchema,
    providerKeysAnswerViewSchema: codingAgentView.providerKeysAnswerViewSchema,
    providerKeySaveParamsSchema: codingAgentView.providerKeySaveParamsSchema,
    providerKeyRemoveParamsSchema: codingAgentView.providerKeyRemoveParamsSchema,
    dictationTranscribeParamsSchema: codingAgentView.dictationTranscribeParamsSchema,
    dictationTranscribeAnswerViewSchema: codingAgentView.dictationTranscribeAnswerViewSchema,
    codingAgentListParamsSchema: codingAgentView.codingAgentListParamsSchema,
    codingAgentWorkspaceListParamsSchema: codingAgentView.codingAgentWorkspaceListParamsSchema,
    codingAgentServersParamsSchema: codingAgentView.codingAgentServersParamsSchema,
    codingAgentListAnswerViewSchema: codingAgentView.codingAgentListAnswerViewSchema,
    codingAgentStartParamsSchema: codingAgentView.codingAgentStartParamsSchema,
    codingAgentAgentAnswerSchema: codingAgentView.codingAgentAgentAnswerSchema,
    codingAgentMessagesParamsSchema: codingAgentView.codingAgentMessagesParamsSchema,
    codingAgentMessageParamsSchema: codingAgentView.codingAgentMessageParamsSchema,
    codingAgentMessagesAnswerViewSchema: codingAgentView.codingAgentMessagesAnswerViewSchema,
    codingAgentChooseParamsSchema: codingAgentView.codingAgentChooseParamsSchema,
    codingAgentRenameParamsSchema: codingAgentView.codingAgentRenameParamsSchema,
    codingAgentStopParamsSchema: codingAgentView.codingAgentStopParamsSchema,
    codingAgentArchiveParamsSchema: codingAgentView.codingAgentArchiveParamsSchema,
    codingAgentPinParamsSchema: codingAgentView.codingAgentPinParamsSchema,
    codingAgentPageParamsSchema: codingAgentView.codingAgentPageParamsSchema,
    codingAgentAgentInboxParamsSchema: codingAgentView.codingAgentAgentInboxParamsSchema,
    codingAgentPageAnswerViewSchema: codingAgentView.codingAgentPageAnswerViewSchema,
    codingAgentPullRequestParamsSchema: codingAgentView.codingAgentPullRequestParamsSchema,
    codingAgentPullRequestReadParamsSchema: codingAgentView.codingAgentPullRequestReadParamsSchema,
    codingAgentPullRequestAnswerViewSchema: codingAgentView.codingAgentPullRequestAnswerViewSchema,
    codingAgentChangesAnswerViewSchema: codingAgentView.codingAgentChangesAnswerViewSchema,
    codingAgentOverviewPullRequestAnswerViewSchema:
      codingAgentView.codingAgentOverviewPullRequestAnswerViewSchema,
    codingAgentReviewOptionsAnswerViewSchema:
      codingAgentView.codingAgentReviewOptionsAnswerViewSchema,
    codingAgentOverviewChecksAnswerViewSchema:
      codingAgentView.codingAgentOverviewChecksAnswerViewSchema,
    codingAgentOverviewConversationAnswerViewSchema:
      codingAgentView.codingAgentOverviewConversationAnswerViewSchema,
    codingAgentPullRequestActionParamsSchema:
      codingAgentView.codingAgentPullRequestActionParamsSchema,
    codingAgentPullRequestWriteAnswerViewSchema:
      codingAgentView.codingAgentPullRequestWriteAnswerViewSchema,
    codingAgentPullRequestViewedAnswerViewSchema:
      codingAgentView.codingAgentPullRequestViewedAnswerViewSchema,
    codingAgentGitHubImageParamsSchema: codingAgentView.codingAgentGitHubImageParamsSchema,
    githubImageTypeSchema: codingAgentView.githubImageTypeSchema,
    codingAgentGitHubImageViewSchema: codingAgentView.codingAgentGitHubImageViewSchema,
    codingAgentInboxParamsSchema: codingAgentView.codingAgentInboxParamsSchema,
    codingAgentInboxAnswerViewSchema: codingAgentView.codingAgentInboxAnswerViewSchema,
    codingAgentInboxAnswerParamsSchema: codingAgentView.codingAgentInboxAnswerParamsSchema,
    codingAgentInboxAnsweredViewSchema: codingAgentView.codingAgentInboxAnsweredViewSchema,
    codingAgentInboxMessageParamsSchema: codingAgentView.codingAgentInboxMessageParamsSchema,
    codingAgentInboxMessagedViewSchema: codingAgentView.codingAgentInboxMessagedViewSchema,
    codingAgentInboxReadStateParamsSchema: codingAgentView.codingAgentInboxReadStateParamsSchema,
    codingAgentInboxReadStateViewSchema: codingAgentView.codingAgentInboxReadStateViewSchema,
    codingAgentInboxReadAllViewSchema: codingAgentView.codingAgentInboxReadAllViewSchema,
    codingAgentAccountInboxParamsSchema: codingAgentView.codingAgentAccountInboxParamsSchema,
    codingAgentAccountInboxAnswerViewSchema:
      codingAgentView.codingAgentAccountInboxAnswerViewSchema,
    codingAgentInboxAttachmentParamsSchema: codingAgentView.codingAgentInboxAttachmentParamsSchema,
    codingAgentPictureParamsSchema: codingAgentView.codingAgentPictureParamsSchema,
    codingAgentInboxAttachmentViewSchema: codingAgentView.codingAgentInboxAttachmentViewSchema,
    codingAgentChatParamsSchema: codingAgentView.codingAgentChatParamsSchema,
    codingAgentChatAnswerViewSchema: codingAgentView.codingAgentChatAnswerViewSchema,
    codingAgentChatPostParamsSchema: codingAgentView.codingAgentChatPostParamsSchema,
    codingAgentChatWriteAnswerViewSchema: codingAgentView.codingAgentChatWriteAnswerViewSchema,
  } satisfies RecordedEffectJsonSchemas<typeof codingAgentView>,
  "dictation-wire": {
    dictationRequestSchema: dictationWire.dictationRequestSchema,
    dictationAnswerSchema: dictationWire.dictationAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof dictationWire>,
  "github-connection-wire": {
    githubConnectAnswerSchema: githubConnectionWire.githubConnectAnswerSchema,
    githubConnectionAnswerSchema: githubConnectionWire.githubConnectionAnswerSchema,
    githubConnectClaimRequestSchema: githubConnectionWire.githubConnectClaimRequestSchema,
    githubConnectClaimAnswerSchema: githubConnectionWire.githubConnectClaimAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof githubConnectionWire>,
  "github-repositories-wire": {
    githubRepositoryFullNameSchema: githubRepositoriesWire.githubRepositoryFullNameSchema,
    githubRepositorySchema: githubRepositoriesWire.githubRepositorySchema,
    githubRepositoriesAnswerSchema: githubRepositoriesWire.githubRepositoriesAnswerSchema,
    githubPullRequestNumberSchema: githubRepositoriesWire.githubPullRequestNumberSchema,
    githubPullRequestSummarySchema: githubRepositoriesWire.githubPullRequestSummarySchema,
    githubRepositoryPullRequestAnswerSchema:
      githubRepositoriesWire.githubRepositoryPullRequestAnswerSchema,
    githubIssueSummarySchema: githubRepositoriesWire.githubIssueSummarySchema,
    githubRepositoryIssueAnswerSchema: githubRepositoriesWire.githubRepositoryIssueAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof githubRepositoriesWire>,
  "integration-view": {
    integrationProviderParamsSchema: integrationView.integrationProviderParamsSchema,
    integrationRenameParamsSchema: integrationView.integrationRenameParamsSchema,
    integrationAccountViewSchema: integrationView.integrationAccountViewSchema,
    integrationStatusesViewSchema: integrationView.integrationStatusesViewSchema,
    integrationStatusViewSchema: integrationView.integrationStatusViewSchema,
    integrationConnectViewSchema: integrationView.integrationConnectViewSchema,
    integrationToolsViewSchema: integrationView.integrationToolsViewSchema,
  } satisfies RecordedEffectJsonSchemas<typeof integrationView>,
  "integration-wire": {
    integrationProviderSchema: integrationWire.integrationProviderSchema,
    integrationConnectionNameSchema: integrationWire.integrationConnectionNameSchema,
    integrationAccountSchema: integrationWire.integrationAccountSchema,
    integrationRenameRequestSchema: integrationWire.integrationRenameRequestSchema,
    integrationAccountAnswerSchema: integrationWire.integrationAccountAnswerSchema,
    integrationSignInFailureSchema: integrationWire.integrationSignInFailureSchema,
    integrationStatusesAnswerSchema: integrationWire.integrationStatusesAnswerSchema,
    integrationStatusAnswerSchema: integrationWire.integrationStatusAnswerSchema,
    integrationConnectAnswerSchema: integrationWire.integrationConnectAnswerSchema,
    integrationToolAnnotationsSchema: integrationWire.integrationToolAnnotationsSchema,
    integrationToolParameterSchema: integrationWire.integrationToolParameterSchema,
    integrationToolsAnswerSchema: integrationWire.integrationToolsAnswerSchema,
    integrationRemoteCallSchema: integrationWire.integrationRemoteCallSchema,
  } satisfies RecordedEffectJsonSchemas<typeof integrationWire>,
  "issue-view": {
    issueListParamsSchema: issueView.issueListParamsSchema,
    issueIdParamsSchema: issueView.issueIdParamsSchema,
    issueCreateParamsSchema: issueView.issueCreateParamsSchema,
    issueChangeParamsSchema: issueView.issueChangeParamsSchema,
    issueListViewSchema: issueView.issueListViewSchema,
    issueViewSchema: issueView.issueViewSchema,
  } satisfies RecordedEffectJsonSchemas<typeof issueView>,
  "issue-wire": {
    issueStatusSchema: issueWire.issueStatusSchema,
    issuePrioritySchema: issueWire.issuePrioritySchema,
    issueSchema: issueWire.issueSchema,
    issueListAnswerSchema: issueWire.issueListAnswerSchema,
    issueAnswerSchema: issueWire.issueAnswerSchema,
    issueCreateRequestSchema: issueWire.issueCreateRequestSchema,
    issueChangeRequestSchema: issueWire.issueChangeRequestSchema,
  } satisfies RecordedEffectJsonSchemas<typeof issueWire>,
  "live-contract": {
    sessionCreateFrameSchema: liveContract.sessionCreateFrameSchema,
    sessionAttachFrameSchema: liveContract.sessionAttachFrameSchema,
    sessionOpeningFrameSchema: liveContract.sessionOpeningFrameSchema,
    sessionActivityFrameSchema: liveContract.sessionActivityFrameSchema,
    sessionStopFrameSchema: liveContract.sessionStopFrameSchema,
    sessionHangUpFrameSchema: liveContract.sessionHangUpFrameSchema,
    sessionReportFrameSchema: liveContract.sessionReportFrameSchema,
    planDraftFrameSchema: liveContract.planDraftFrameSchema,
    taskActivityFrameSchema: liveContract.taskActivityFrameSchema,
    taskCodeFrameSchema: liveContract.taskCodeFrameSchema,
    taskWorkFrameSchema: liveContract.taskWorkFrameSchema,
    taskCallEndingFrameSchema: liveContract.taskCallEndingFrameSchema,
    avatarStartFrameSchema: liveContract.avatarStartFrameSchema,
    avatarStopFrameSchema: liveContract.avatarStopFrameSchema,
    avatarRequestFrameSchema: liveContract.avatarRequestFrameSchema,
    avatarStartedFrameSchema: liveContract.avatarStartedFrameSchema,
    avatarUnavailableFrameSchema: liveContract.avatarUnavailableFrameSchema,
    sessionAttachedFrameSchema: liveContract.sessionAttachedFrameSchema,
    sessionCreatedFrameSchema: liveContract.sessionCreatedFrameSchema,
  } satisfies RecordedEffectJsonSchemas<typeof liveContract>,
  "models-wire": {
    contextWindowsSchema: modelsWire.contextWindowsSchema,
    catalogModelSchema: modelsWire.catalogModelSchema,
    modelsAnswerSchema: modelsWire.modelsAnswerSchema,
    modelChoiceSchema: modelsWire.modelChoiceSchema,
    codingAgentDefaultAnswerSchema: modelsWire.codingAgentDefaultAnswerSchema,
    codingAgentDefaultWriteSchema: modelsWire.codingAgentDefaultWriteSchema,
  } satisfies RecordedEffectJsonSchemas<typeof modelsWire>,
  "plan-document-template": {
    planTemplateAnswerSchema: planDocumentTemplate.planTemplateAnswerSchema,
    planTemplateWriteRequestSchema: planDocumentTemplate.planTemplateWriteRequestSchema,
    planTemplateRevisionLineSchema: planDocumentTemplate.planTemplateRevisionLineSchema,
    planTemplateRevisionsAnswerSchema: planDocumentTemplate.planTemplateRevisionsAnswerSchema,
    planTemplateRevisionAnswerSchema: planDocumentTemplate.planTemplateRevisionAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planDocumentTemplate>,
  "plan-edit": {
    planEditRequestSchema: planEdit.planEditRequestSchema,
    planEditAnswerSchema: planEdit.planEditAnswerSchema,
    planEditValueSchema: planEdit.planEditValueSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planEdit>,
  "picture-wire": {
    pictureTypeSchema: pictureWire.pictureTypeSchema,
    pictureDataUrlSchema: pictureWire.pictureDataUrlSchema,
  } satisfies RecordedEffectJsonSchemas<typeof pictureWire>,
  "pin-order": {
    pinPositionSchema: pinOrder.pinPositionSchema,
  } satisfies RecordedEffectJsonSchemas<typeof pinOrder>,
  "plan-attachment-wire": {
    planAttachmentRequestSchema: planAttachmentWire.planAttachmentRequestSchema,
    planAttachmentAnswerSchema: planAttachmentWire.planAttachmentAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planAttachmentWire>,
  "plan-comment-wire": {
    planCommentWordsSchema: planCommentWire.planCommentWordsSchema,
    planCommentClientKeySchema: planCommentWire.planCommentClientKeySchema,
    planCommentSpanSchema: planCommentWire.planCommentSpanSchema,
    planCommentWriterSchema: planCommentWire.planCommentWriterSchema,
    planCommentAskedSchema: planCommentWire.planCommentAskedSchema,
    planCommentEntrySchema: planCommentWire.planCommentEntrySchema,
    planCommentThreadSchema: planCommentWire.planCommentThreadSchema,
    planCommentsCursorSchema: planCommentWire.planCommentsCursorSchema,
    planCommentsAnswerSchema: planCommentWire.planCommentsAnswerSchema,
    planCommentStartRequestSchema: planCommentWire.planCommentStartRequestSchema,
    planCommentActionRequestSchema: planCommentWire.planCommentActionRequestSchema,
    planCommentThreadAnswerSchema: planCommentWire.planCommentThreadAnswerSchema,
    planCommentAnchorsSchema: planCommentWire.planCommentAnchorsSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planCommentWire>,
  "task-section-wire": {
    taskSectionEmojiSchema: taskSectionWire.taskSectionEmojiSchema,
    taskSectionIconSchema: taskSectionWire.taskSectionIconSchema,
    taskSectionTitleSchema: taskSectionWire.taskSectionTitleSchema,
    taskSectionSchema: taskSectionWire.taskSectionSchema,
    taskSectionEntrySchema: taskSectionWire.taskSectionEntrySchema,
    taskSectionsAnswerSchema: taskSectionWire.taskSectionsAnswerSchema,
    taskSectionWriteSchema: taskSectionWire.taskSectionWriteSchema,
  } satisfies RecordedEffectJsonSchemas<typeof taskSectionWire>,
  "task-wire": {
    workspaceIdSchema: taskWire.workspaceIdSchema,
    agentEditLineSchema: taskWire.agentEditLineSchema,
    planAssumptionSchema: taskWire.planAssumptionSchema,
    planDocumentSchema: taskWire.planDocumentSchema,
    taskAgentStartSchema: taskWire.taskAgentStartSchema,
    taskCreateRequestSchema: taskWire.taskCreateRequestSchema,
    taskRenameRequestSchema: taskWire.taskRenameRequestSchema,
    taskUpdateRequestSchema: taskWire.taskUpdateRequestSchema,
    taskAgentLineSchema: taskWire.taskAgentLineSchema,
    taskPullRequestLineSchema: taskWire.taskPullRequestLineSchema,
    taskAgentsSummarySchema: taskWire.taskAgentsSummarySchema,
    taskSummarySchema: taskWire.taskSummarySchema,
    planEditorSchema: taskWire.planEditorSchema,
    planLastEditSchema: taskWire.planLastEditSchema,
    planSectionEditSchema: taskWire.planSectionEditSchema,
    taskSchema: taskWire.taskSchema,
    taskListAnswerSchema: taskWire.taskListAnswerSchema,
    repositoryPinSchema: taskWire.repositoryPinSchema,
    repositoryPinsAnswerSchema: taskWire.repositoryPinsAnswerSchema,
    repositoryPinRequestSchema: taskWire.repositoryPinRequestSchema,
    taskAnswerSchema: taskWire.taskAnswerSchema,
    taskAgentRefusalSchema: taskWire.taskAgentRefusalSchema,
    taskStartAnswerSchema: taskWire.taskStartAnswerSchema,
    taskDeleteAnswerSchema: taskWire.taskDeleteAnswerSchema,
    planRevisionSeqSchema: taskWire.planRevisionSeqSchema,
    planRevisionLineSchema: taskWire.planRevisionLineSchema,
    planRevisionsAnswerSchema: taskWire.planRevisionsAnswerSchema,
    planRevisionAnswerSchema: taskWire.planRevisionAnswerSchema,
    codeLineSchema: taskWire.codeLineSchema,
    commitShaSchema: taskWire.commitShaSchema,
    codeRefSchema: taskWire.codeRefSchema,
    codeNoteSchema: taskWire.codeNoteSchema,
    shownCodeSchema: taskWire.shownCodeSchema,
    taskFileRequestSchema: taskWire.taskFileRequestSchema,
    taskFileWindowSchema: taskWire.taskFileWindowSchema,
    taskFileRefusalSchema: taskWire.taskFileRefusalSchema,
    taskFileTextSchema: taskWire.taskFileTextSchema,
    taskFileAnswerSchema: taskWire.taskFileAnswerSchema,
    taskTreeRequestSchema: taskWire.taskTreeRequestSchema,
    taskTreeEntrySchema: taskWire.taskTreeEntrySchema,
    taskTreeFolderSchema: taskWire.taskTreeFolderSchema,
    taskTreeAnswerSchema: taskWire.taskTreeAnswerSchema,
    taskSkillSchema: taskWire.taskSkillSchema,
    taskSkillsSchema: taskWire.taskSkillsSchema,
    taskSkillsAnswerSchema: taskWire.taskSkillsAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof taskWire>,
  "provider-key-wire": {
    providerKeySummarySchema: providerKeyWire.providerKeySummarySchema,
    providerKeysAnswerSchema: providerKeyWire.providerKeysAnswerSchema,
    providerKeySaveRequestSchema: providerKeyWire.providerKeySaveRequestSchema,
  } satisfies RecordedEffectJsonSchemas<typeof providerKeyWire>,
  "pull-request-write-wire": {
    mergeMethodSchema: pullRequestWriteWire.mergeMethodSchema,
    pullRequestActionRequestSchema: pullRequestWriteWire.pullRequestActionRequestSchema,
    pullRequestWriteAnswerSchema: pullRequestWriteWire.pullRequestWriteAnswerSchema,
    pullRequestViewedAnswerSchema: pullRequestWriteWire.pullRequestViewedAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof pullRequestWriteWire>,
  "repository-reach-wire": {
    repositoryUnreachedSchema: repositoryReachWire.repositoryUnreachedSchema,
    repositoryNotReachableSchema: repositoryReachWire.repositoryNotReachableSchema,
  } satisfies RecordedEffectJsonSchemas<typeof repositoryReachWire>,
  "service-wire": {
    writtenText: serviceWire.writtenText,
    countedNumber: serviceWire.countedNumber,
    hostedQuotaSchema: serviceWire.hostedQuotaSchema,
    hostedErrorSchema: serviceWire.hostedErrorSchema,
    wireUuidSchema: serviceWire.wireUuidSchema,
    memberRefSchema: serviceWire.memberRefSchema,
  } satisfies RecordedEffectJsonSchemas<typeof serviceWire>,
  "linear-wire": {
    linearIssueIdSchema: linearWire.linearIssueIdSchema,
    linearIdentifierSchema: linearWire.linearIdentifierSchema,
    linearIssueSummarySchema: linearWire.linearIssueSummarySchema,
    taskLinearIssueSchema: linearWire.taskLinearIssueSchema,
    linearIssuesAnswerSchema: linearWire.linearIssuesAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof linearWire>,
  "transcript-wire": {
    transcriptTextPartSchema: transcriptWire.transcriptTextPartSchema,
    transcriptMessageSchema: transcriptWire.transcriptMessageSchema,
    transcriptCallSchema: transcriptWire.transcriptCallSchema,
    taskTranscriptSchema: transcriptWire.taskTranscriptSchema,
    taskTranscriptAnswerSchema: transcriptWire.taskTranscriptAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof transcriptWire>,
  "factory-world-wire": {
    factoryRepositorySchema: factoryWorldWire.factoryRepositorySchema,
    factoryZoneSchema: factoryWorldWire.factoryZoneSchema,
    factoryPullRequestSchema: factoryWorldWire.factoryPullRequestSchema,
    factoryAgentSchema: factoryWorldWire.factoryAgentSchema,
    factoryShippedSchema: factoryWorldWire.factoryShippedSchema,
    factoryPlannedSchema: factoryWorldWire.factoryPlannedSchema,
    factoryDefectSchema: factoryWorldWire.factoryDefectSchema,
    factoryWorldSchema: factoryWorldWire.factoryWorldSchema,
    factoryWorldRequestSchema: factoryWorldWire.factoryWorldRequestSchema,
    factoryWorldAnswerSchema: factoryWorldWire.factoryWorldAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof factoryWorldWire>,
  "pull-request-area": {
    pullRequestAreaSchema: pullRequestArea.pullRequestAreaSchema,
    pullRequestAreasSchema: pullRequestArea.pullRequestAreasSchema,
  } satisfies RecordedEffectJsonSchemas<typeof pullRequestArea>,
  "workspace-wire": {
    workspacePhotoTypeSchema: workspaceWire.workspacePhotoTypeSchema,
    workspaceGithubSchema: workspaceWire.workspaceGithubSchema,
    workspaceGithubInstallationSchema: workspaceWire.workspaceGithubInstallationSchema,
    workspaceSchema: workspaceWire.workspaceSchema,
    workspacesAnswerSchema: workspaceWire.workspacesAnswerSchema,
    workspaceAnswerSchema: workspaceWire.workspaceAnswerSchema,
    workspaceCreateRequestSchema: workspaceWire.workspaceCreateRequestSchema,
    workspaceRenameRequestSchema: workspaceWire.workspaceRenameRequestSchema,
    workspacePhotoSetRequestSchema: workspaceWire.workspacePhotoSetRequestSchema,
    workspaceGithubRequestSchema: workspaceWire.workspaceGithubRequestSchema,
    workspaceGithubConnectAnswerSchema: workspaceWire.workspaceGithubConnectAnswerSchema,
    workspaceLinearSchema: workspaceWire.workspaceLinearSchema,
    workspaceLinearRequestSchema: workspaceWire.workspaceLinearRequestSchema,
    workspaceLinearConnectAnswerSchema: workspaceWire.workspaceLinearConnectAnswerSchema,
    linearIssuesRequestSchema: workspaceWire.linearIssuesRequestSchema,
    workspaceMemberSchema: workspaceWire.workspaceMemberSchema,
    formerMemberSchema: workspaceWire.formerMemberSchema,
    workspaceMembersAnswerSchema: workspaceWire.workspaceMembersAnswerSchema,
    workspaceMemberRemovalSchema: workspaceWire.workspaceMemberRemovalSchema,
    workspaceMemberRoleSchema: workspaceWire.workspaceMemberRoleSchema,
    workspaceTransferSchema: workspaceWire.workspaceTransferSchema,
    workspaceLeaveRequestSchema: workspaceWire.workspaceLeaveRequestSchema,
    workspaceLeaveAnswerSchema: workspaceWire.workspaceLeaveAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof workspaceWire>,
} as const;

const declaredSchemas = (
  modules: Readonly<Record<string, Readonly<Record<string, RecordedJsonSchemaSource>>>>,
): readonly (readonly [string, RecordedJsonSchemaSource])[] =>
  Object.entries(modules).flatMap(([module, schemas]) =>
    Object.entries(schemas).map(([name, schema]) => [`${module}-${name}`, schema] as const),
  );

const RECORDED: readonly (readonly [string, RecordedJsonSchemaSource])[] =
  declaredSchemas(EFFECT_MODULE_SCHEMAS);

test.for(RECORDED)("%s emits the recorded JSON Schema", async ([name, schema]) => {
  await settleJsonSchemaGolden(ROOT, name, jsonSchemaOf(schema));
});

test("the recorded set is exactly the schemas the wire modules declare", async () => {
  await settleJsonSchemaGoldenSet(
    ROOT,
    RECORDED.map(([name]) => name),
  );
});
