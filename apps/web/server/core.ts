/**
 * The one re-export surface server code reaches the workspace packages through.
 *
 * The action table and the session package both name the action vocabulary: the
 * table's is the whole of it and the session package's is the advertised
 * subset of the same strings, proven identical where the table declares it. A
 * star export from two doors carries neither, so the whole one is named here.
 */
export * from "@sidecar/actions";
/** @public No file imports the type by name, but without this door the two star exports collide on it. */
export { ACTION_KIND, type ActionKind } from "@sidecar/actions";
export * from "@sidecar/analytics";
// The brain is named rather than starred: the package still carries the Mac
// brain's agent loop beside the vocabulary the hosted brain host reads, and a
// star would hide which of the two the server reaches. What is listed is what
// the server and its tests import through this door and nothing more.
export {
  type ActionAdmissionReads,
  type ActionToolModule,
  ANNOUNCE_TOOL,
  type AnnounceToolModule,
  AssistantMessageBuilder,
  actionToolNamed,
  addModelUsage,
  BRAIN_IDENTITY_LINE,
  BRAIN_INPUT_MARKER,
  BRAIN_PERSONA,
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  BRAIN_WAKE_KIND,
  BRAIN_WORKSPACE_SEEDS,
  type BrainRequestFailure,
  type BrainRequestRecord,
  type BrainRequestStatus,
  type BrainRoster,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainRunUsage,
  type BrainTranscriptDelta,
  type BrainTurnOrigin,
  type BrainTurnTrigger,
  type BrainWakeEvent,
  type BrainWorkspaceAccess,
  brainToolCatalog,
  brainToolNotes,
  holdReleasedInputText,
  maximumBriefingLength,
  READ_TOOLS,
  type ReadToolModule,
  replySentences,
  resolveTurnToolPolicy,
  runOriginOf,
  SLOW_STEP_KIND,
  type SlowStepKind,
  STEP_START_PART,
  sessionContextText,
  settledToolPart,
  slowStepOf,
  standingContextText,
  TOOL_CALL_SETTLEMENT,
  TOOL_GROUP,
  type ToolCallSettlement,
  type ToolContext,
  type ToolRefusalStatus,
  toolCallSettlementOf,
  toolPartType,
  UI_PART_STATE,
  UI_PART_TYPE,
  userMessage,
  userMetadataOf,
  WORKSPACE_TOOLS,
  type WorkspaceToolContext,
  type WorkspaceToolModule,
  wakeInputText,
  workspaceProjectContextText,
} from "@sidecar/brain";
export {
  catalogToolSet,
  catalogViewToolKinds,
} from "@sidecar/brain/tool-set";
export * from "@sidecar/hosted";
// The runtime's barrel and its vocabulary door carry no name in common, so
// both stand open: server code names the prompt builder and the workspace
// bounds from the one and the identifiers from the other.
export * from "@sidecar/runtime";
export * from "@sidecar/runtime/vocabulary";
export * from "@sidecar/session";
export * from "@sidecar/session/ui-messages";
export * from "@sidecar/wire";
