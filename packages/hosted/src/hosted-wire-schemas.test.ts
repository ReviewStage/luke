import {
  jsonSchemaGoldenRoot,
  jsonSchemaOf,
  type RecordedEffectJsonSchemas,
  type RecordedJsonSchemaSource,
  settleJsonSchemaGolden,
  settleJsonSchemaGoldenSet,
} from "@sidecar/wire/testing";
import { test } from "vitest";
import * as boardWire from "./board-wire.js";
import * as codingAgentView from "./coding-agent-view.js";
import * as codingAgentWire from "./coding-agent-wire.js";
import * as dictationWire from "./dictation-wire.js";
import * as githubRepositoriesWire from "./github-repositories-wire.js";
import * as inboxWire from "./inbox-wire.js";
import * as liveContract from "./live-contract.js";
import * as modelsWire from "./models-wire.js";
import * as planDocumentTemplate from "./plan-document-template.js";
import * as planEdit from "./plan-edit.js";
import * as planWire from "./plan-wire.js";
import * as providerKeyWire from "./provider-key-wire.js";
import * as serviceWire from "./service-wire.js";
import * as transcriptWire from "./transcript-wire.js";

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
  "board-wire": {
    boardElementSchema: boardWire.boardElementSchema,
    boardElementsSchema: boardWire.boardElementsSchema,
    boardSchema: boardWire.boardSchema,
    boardAnswerSchema: boardWire.boardAnswerSchema,
    boardSaveRequestSchema: boardWire.boardSaveRequestSchema,
    drawingElementsSchema: boardWire.drawingElementsSchema,
  } satisfies RecordedEffectJsonSchemas<typeof boardWire>,
  "coding-agent-wire": {
    contextWindowSchema: codingAgentWire.contextWindowSchema,
    codingAgentStartRequestSchema: codingAgentWire.codingAgentStartRequestSchema,
    codingAgentMessageRequestSchema: codingAgentWire.codingAgentMessageRequestSchema,
    codingAgentRenameRequestSchema: codingAgentWire.codingAgentRenameRequestSchema,
    codingAgentSummarySchema: codingAgentWire.codingAgentSummarySchema,
    codingAgentAnswerSchema: codingAgentWire.codingAgentAnswerSchema,
    codingAgentListAnswerSchema: codingAgentWire.codingAgentListAnswerSchema,
    codingAgentMessageSchema: codingAgentWire.codingAgentMessageSchema,
    codingAgentCursorSchema: codingAgentWire.codingAgentCursorSchema,
    codingAgentUsageSchema: codingAgentWire.codingAgentUsageSchema,
    codingAgentContextSchema: codingAgentWire.codingAgentContextSchema,
    codingAgentMessagesAnswerSchema: codingAgentWire.codingAgentMessagesAnswerSchema,
    codingAgentPullRequestSchema: codingAgentWire.codingAgentPullRequestSchema,
    codingAgentPullRequestAnswerSchema: codingAgentWire.codingAgentPullRequestAnswerSchema,
    codingAgentCallIdSchema: codingAgentWire.codingAgentCallIdSchema,
    codingAgentDelegationInputSchema: codingAgentWire.codingAgentDelegationInputSchema,
    codingAgentDelegationOutputSchema: codingAgentWire.codingAgentDelegationOutputSchema,
    codingAgentTodosInputSchema: codingAgentWire.codingAgentTodosInputSchema,
  } satisfies RecordedEffectJsonSchemas<typeof codingAgentWire>,
  "inbox-wire": {
    inboxKeySchema: inboxWire.inboxKeySchema,
    inboxBlockSchema: inboxWire.inboxBlockSchema,
    inboxBlocksSchema: inboxWire.inboxBlocksSchema,
    inboxOptionSchema: inboxWire.inboxOptionSchema,
    inboxFieldSchema: inboxWire.inboxFieldSchema,
    inboxResponseSchema: inboxWire.inboxResponseSchema,
    inboxPostInputSchema: inboxWire.inboxPostInputSchema,
    inboxCloseInputSchema: inboxWire.inboxCloseInputSchema,
    inboxReadInputSchema: inboxWire.inboxReadInputSchema,
    inboxFieldValueSchema: inboxWire.inboxFieldValueSchema,
    inboxFormValueSchema: inboxWire.inboxFormValueSchema,
    inboxFormValuesSchema: inboxWire.inboxFormValuesSchema,
    inboxReplySchema: inboxWire.inboxReplySchema,
    inboxReadBlockSchema: inboxWire.inboxReadBlockSchema,
    inboxReadResponseSchema: inboxWire.inboxReadResponseSchema,
    inboxItemSchema: inboxWire.inboxItemSchema,
    inboxCursorSchema: inboxWire.inboxCursorSchema,
    inboxAnswerSchema: inboxWire.inboxAnswerSchema,
    inboxAnswerRequestSchema: inboxWire.inboxAnswerRequestSchema,
    inboxAnsweredSchema: inboxWire.inboxAnsweredSchema,
  } satisfies RecordedEffectJsonSchemas<typeof inboxWire>,
  "coding-agent-view": {
    codingAgentModelsAnswerSchema: codingAgentView.codingAgentModelsAnswerSchema,
    codingAgentDefaultAnswerViewSchema: codingAgentView.codingAgentDefaultAnswerViewSchema,
    codingAgentDefaultWriteParamsSchema: codingAgentView.codingAgentDefaultWriteParamsSchema,
    planTemplateAnswerViewSchema: codingAgentView.planTemplateAnswerViewSchema,
    planTemplateWriteParamsSchema: codingAgentView.planTemplateWriteParamsSchema,
    providerKeysAnswerViewSchema: codingAgentView.providerKeysAnswerViewSchema,
    providerKeySaveParamsSchema: codingAgentView.providerKeySaveParamsSchema,
    providerKeyRemoveParamsSchema: codingAgentView.providerKeyRemoveParamsSchema,
    dictationTranscribeParamsSchema: codingAgentView.dictationTranscribeParamsSchema,
    dictationTranscribeAnswerViewSchema: codingAgentView.dictationTranscribeAnswerViewSchema,
    codingAgentListParamsSchema: codingAgentView.codingAgentListParamsSchema,
    codingAgentListAnswerViewSchema: codingAgentView.codingAgentListAnswerViewSchema,
    codingAgentStartParamsSchema: codingAgentView.codingAgentStartParamsSchema,
    codingAgentAgentAnswerSchema: codingAgentView.codingAgentAgentAnswerSchema,
    codingAgentMessagesParamsSchema: codingAgentView.codingAgentMessagesParamsSchema,
    codingAgentMessageParamsSchema: codingAgentView.codingAgentMessageParamsSchema,
    codingAgentMessagesAnswerViewSchema: codingAgentView.codingAgentMessagesAnswerViewSchema,
    codingAgentChooseParamsSchema: codingAgentView.codingAgentChooseParamsSchema,
    codingAgentRenameParamsSchema: codingAgentView.codingAgentRenameParamsSchema,
    codingAgentStopParamsSchema: codingAgentView.codingAgentStopParamsSchema,
    codingAgentPullRequestParamsSchema: codingAgentView.codingAgentPullRequestParamsSchema,
    codingAgentPullRequestAnswerViewSchema: codingAgentView.codingAgentPullRequestAnswerViewSchema,
    codingAgentInboxParamsSchema: codingAgentView.codingAgentInboxParamsSchema,
    codingAgentInboxAnswerViewSchema: codingAgentView.codingAgentInboxAnswerViewSchema,
    codingAgentInboxAnswerParamsSchema: codingAgentView.codingAgentInboxAnswerParamsSchema,
    codingAgentInboxAnsweredViewSchema: codingAgentView.codingAgentInboxAnsweredViewSchema,
  } satisfies RecordedEffectJsonSchemas<typeof codingAgentView>,
  "dictation-wire": {
    dictationRequestSchema: dictationWire.dictationRequestSchema,
    dictationAnswerSchema: dictationWire.dictationAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof dictationWire>,
  "github-repositories-wire": {
    githubRepositoryFullNameSchema: githubRepositoriesWire.githubRepositoryFullNameSchema,
    githubRepositorySchema: githubRepositoriesWire.githubRepositorySchema,
    githubRepositoriesAnswerSchema: githubRepositoriesWire.githubRepositoriesAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof githubRepositoriesWire>,
  "live-contract": {
    sessionCreateFrameSchema: liveContract.sessionCreateFrameSchema,
    sessionAttachFrameSchema: liveContract.sessionAttachFrameSchema,
    sessionOpeningFrameSchema: liveContract.sessionOpeningFrameSchema,
    sessionActivityFrameSchema: liveContract.sessionActivityFrameSchema,
    sessionStopFrameSchema: liveContract.sessionStopFrameSchema,
    sessionHangUpFrameSchema: liveContract.sessionHangUpFrameSchema,
    sessionReportFrameSchema: liveContract.sessionReportFrameSchema,
    planDraftFrameSchema: liveContract.planDraftFrameSchema,
    planActivityFrameSchema: liveContract.planActivityFrameSchema,
    planCodeFrameSchema: liveContract.planCodeFrameSchema,
    planWorkFrameSchema: liveContract.planWorkFrameSchema,
    planCallEndingFrameSchema: liveContract.planCallEndingFrameSchema,
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
  } satisfies RecordedEffectJsonSchemas<typeof planDocumentTemplate>,
  "plan-edit": {
    planEditRequestSchema: planEdit.planEditRequestSchema,
    planEditAnswerSchema: planEdit.planEditAnswerSchema,
    planEditValueSchema: planEdit.planEditValueSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planEdit>,
  "plan-wire": {
    agentEditLineSchema: planWire.agentEditLineSchema,
    planAssumptionSchema: planWire.planAssumptionSchema,
    planFieldsSchema: planWire.planFieldsSchema,
    planDocumentSchema: planWire.planDocumentSchema,
    planCreateRequestSchema: planWire.planCreateRequestSchema,
    planRenameRequestSchema: planWire.planRenameRequestSchema,
    planUpdateRequestSchema: planWire.planUpdateRequestSchema,
    planAgentLineSchema: planWire.planAgentLineSchema,
    planPullRequestLineSchema: planWire.planPullRequestLineSchema,
    planAgentsSummarySchema: planWire.planAgentsSummarySchema,
    planSummarySchema: planWire.planSummarySchema,
    planLastEditSchema: planWire.planLastEditSchema,
    planFieldEditSchema: planWire.planFieldEditSchema,
    planSectionEditSchema: planWire.planSectionEditSchema,
    planSchema: planWire.planSchema,
    planListAnswerSchema: planWire.planListAnswerSchema,
    repositoryPinSchema: planWire.repositoryPinSchema,
    repositoryPinsAnswerSchema: planWire.repositoryPinsAnswerSchema,
    repositoryPinRequestSchema: planWire.repositoryPinRequestSchema,
    planAnswerSchema: planWire.planAnswerSchema,
    planDeleteAnswerSchema: planWire.planDeleteAnswerSchema,
    planRevisionSeqSchema: planWire.planRevisionSeqSchema,
    planRevisionLineSchema: planWire.planRevisionLineSchema,
    planRevisionsAnswerSchema: planWire.planRevisionsAnswerSchema,
    planRevisionAnswerSchema: planWire.planRevisionAnswerSchema,
    codeRefSchema: planWire.codeRefSchema,
    codeNoteSchema: planWire.codeNoteSchema,
    shownCodeSchema: planWire.shownCodeSchema,
    planFileRequestSchema: planWire.planFileRequestSchema,
    planFileWindowSchema: planWire.planFileWindowSchema,
    planFileRefusalSchema: planWire.planFileRefusalSchema,
    planFileTextSchema: planWire.planFileTextSchema,
    planFileAnswerSchema: planWire.planFileAnswerSchema,
    planTreeRequestSchema: planWire.planTreeRequestSchema,
    planTreeEntrySchema: planWire.planTreeEntrySchema,
    planTreeFolderSchema: planWire.planTreeFolderSchema,
    planTreeAnswerSchema: planWire.planTreeAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof planWire>,
  "provider-key-wire": {
    providerKeySummarySchema: providerKeyWire.providerKeySummarySchema,
    providerKeysAnswerSchema: providerKeyWire.providerKeysAnswerSchema,
    providerKeySaveRequestSchema: providerKeyWire.providerKeySaveRequestSchema,
  } satisfies RecordedEffectJsonSchemas<typeof providerKeyWire>,
  "service-wire": {
    writtenText: serviceWire.writtenText,
    countedNumber: serviceWire.countedNumber,
    hostedQuotaSchema: serviceWire.hostedQuotaSchema,
    hostedErrorSchema: serviceWire.hostedErrorSchema,
    wireUuidSchema: serviceWire.wireUuidSchema,
  } satisfies RecordedEffectJsonSchemas<typeof serviceWire>,
  "transcript-wire": {
    transcriptTextPartSchema: transcriptWire.transcriptTextPartSchema,
    transcriptMessageSchema: transcriptWire.transcriptMessageSchema,
    transcriptCallSchema: transcriptWire.transcriptCallSchema,
    planTranscriptSchema: transcriptWire.planTranscriptSchema,
    planTranscriptAnswerSchema: transcriptWire.planTranscriptAnswerSchema,
  } satisfies RecordedEffectJsonSchemas<typeof transcriptWire>,
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
