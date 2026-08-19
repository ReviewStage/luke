/**
 * The consumer-facing interface of `@sidecar/core`. Internals stay in their
 * modules and are not a stability promise; only what apps import is named
 * here, grouped by capability.
 */

// biome-ignore-all assist/source/organizeImports: grouped by consumer-facing capability, not module path

// JSON — defensive readers for untrusted payloads.
export {
  isRecord,
  nonNegativeNumber,
  oneLine,
  positiveInteger,
  recordFromJsonLine,
  resolveOptions,
  text,
  wholeNumber,
} from "./json.js";

// App updates — naming a newer published release than the running build.
export { isNewerVersion, parseReleaseVersion } from "./app-update.js";

// Sessions — observed state, identity, and the registry that holds them.
export {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  agedStatus,
  isRosterRelevant,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  type NormalizedSession,
  normalizeSession,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  rosterRelevantSessions,
  SESSION_COMPLETION_CAUSE,
  SESSION_CONTROL_KIND,
  SESSION_ROSTER_RETENTION_MS,
  sessionRosterRetentionMs,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionControl,
  type SessionControlKind,
  type SessionCompletionCause,
  type SessionDetail,
  type SessionIdentity,
  type SessionLocation,
  type SessionProvider,
  type SessionStatus,
  type SessionWorkspace,
  sessionChangeNumber,
  sessionMessageText,
  UNKNOWN_WORKSPACE_LABEL,
  WORKSPACE_MANAGER,
  type WorkspaceManagerName,
} from "./session.js";
export { InMemorySessionRegistry } from "./session-registry.js";
export {
  SESSION_NOTICE_STATUS,
  type SessionNotice,
  type SessionNoticeStatus,
  SessionNoticeTracker,
} from "./session-notices.js";
export {
  CREATED_WORKSPACE_OPEN_WINDOW_MS,
  CreatedWorkspaceOpenTracker,
} from "./workspace-opens.js";
export { MAXIMUM_HELD_NOTICES, SessionNoticeHold } from "./session-notice-hold.js";

// Calendar — when meetings start and end, and nothing else about them.
export {
  activeMeetingEnd,
  CALENDAR_LOOKAHEAD_MS,
  MAXIMUM_CALENDAR_MEETINGS,
  MAXIMUM_MEETING_LENGTH_MS,
  type MeetingInterval,
  meetingsFromBusyIntervals,
} from "./calendar.js";

// Providers — adapters and the acts they advertise.
export {
  type ControllableSessionProviderAdapter,
  isControllableAdapter,
  isMessageCapableAdapter,
  isProviderId,
  isWorkspaceAgentCapableAdapter,
  isWorkspaceCapableAdapter,
  type MessageCapableSessionProviderAdapter,
  maximumObservedWorkspaceProjects,
  normalizeObservedWorkspaceProjects,
  type ObservedWorkspaceProject,
  PROVIDER_ACT_RESULT_STATUS,
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  type ProviderActResult,
  type ProviderControlRequest,
  type ProviderControlResult,
  type ProviderId,
  type ProviderMessageResult,
  type ProviderSessionMessage,
  type ProviderWorkspaceAgentRequest,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  type SessionProviderAdapter,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentCapableSessionProviderAdapter,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
  type WorkspaceCapableSessionProviderAdapter,
  type WorkspaceProject,
  workspaceNameText,
} from "./providers.js";
export { CompositeSessionProviderAdapter } from "./composite-provider-adapter.js";

// Issues — tracked work and the two acts a tracker takes.
export {
  ISSUE_ACTION_KIND,
  ISSUE_TRACKER_ID,
  type IssueTracker,
  type IssueTrackerAdapter,
  type IssueTransition,
  issueCommentText,
  maximumIssueTransitions,
  normalizeTrackedIssue,
  TRACKER_ACTION_RESULT_STATUS,
  type TrackedIssue,
  type TrackerActionResult,
  type TrackerIssueAction,
  type TrackerIssueObservation,
} from "./issues.js";

// Attention — whether a session change is worth voicing.
export {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  ATTENTION_EVENT_FRESH_AGE_MS,
  ATTENTION_REQUEST_RESULT_STATUS,
  ATTENTION_TRIGGER,
  type AttentionEvaluator,
  AttentionRequestRegistry,
  type AttentionRequestResult,
  attentionRequestText,
  type AttentionUpdate,
  attentionDecisionFromModel,
  maximumAttentionRequestLength,
  SessionAttentionReviewer,
  type SessionNoticeAsk,
} from "./attention.js";
export {
  ATTENTION_RESPONSES_PATH,
  attentionResponsesMissingReason,
  attentionResponsesOutputText,
  attentionResponsesRequest,
} from "./attention-openai.js";
export {
  type AttentionPromptUpdate,
  attentionInstructions,
  attentionPromptUpdateFromWire,
  attentionUpdateInput,
} from "./attention-prompt.js";

// Guide — what the app knows about itself.
export {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  APP_TOGGLE_VALUE,
  type AppGuideFact,
  type AppGuideSetting,
  type AppGuideSnapshot,
  type AppPanelTab,
  appGuideContextText,
  appToggleText,
  EMPTY_APP_GUIDE,
  FEEDBACK_COMPOSER_KIND,
  type FeedbackComposerKind,
  SESSION_LIST_SORT,
  type SessionListSort,
} from "./guide.js";

// Voice — Realtime settings, protocol, credentials, context, and tools.
export {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  REALTIME_DEFAULTS,
  REALTIME_VOICE,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED,
  REALTIME_VOICE_SPEED_LIST,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
} from "./realtime-voice-settings.js";
export {
  announcementSummaryText,
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  attentionSpeechFromReviews,
  cancelResponseEvents,
  clearInputAudioEvents,
  functionCallFollowUpEvents,
  functionCallOutputEvents,
  maximumNoticeContextLength,
  outputSpeedUpdateEvents,
  parseRealtimeServerEvent,
  proactiveSpeechEvents,
  pushToTalkCommitEvents,
  REALTIME_CLIENT_EVENT,
  REALTIME_DATA_CHANNEL,
  REALTIME_SERVER_EVENT,
  REALTIME_STATUS,
  type RealtimeFunctionCall,
  type RealtimeStatus,
  truncateResponseEvents,
  typedAskEvents,
} from "./realtime-protocol.js";
export {
  HOSTED_API_ERROR,
  HOSTED_CALLS_URL,
  HOSTED_SERVICE_PATH,
  type HostedApiError,
  type HostedMintAnswer,
  type HostedQuota,
  type HostedReviewAnswer,
  type HostedUsageAnswer,
  hostedErrorFromWire,
  hostedMintAnswerFromWire,
  hostedQuotaFromWire,
  hostedReviewAnswerFromWire,
  hostedUsageAnswerFromWire,
} from "./hosted-service.js";
export {
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  REALTIME_MINT_OUTCOME,
  REALTIME_TRUNCATION,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
  realtimeMintExplanation,
} from "./realtime-credentials.js";
export {
  appGuideContextEvents,
  CONTEXT_ITEM_KIND,
  type ContextItemKind,
  contextItemId,
  contextSupersedeEventId,
  contextSupersedeEvents,
  ISSUE_TRACKER_DISCONNECTED_TEXT,
  issueContextEvents,
  issueContextText,
  issueTrackerDisconnectedEvents,
  lastAnnouncementContextEvents,
  lastAnnouncementContextText,
  SESSION_REFERENCE_WITHDRAWN_TEXT,
  sessionContextEvents,
  sessionContextText,
  sessionReferenceContextEvents,
  sessionReferenceContextText,
  sessionReferenceWithdrawnEvents,
  workspaceProjectContextEvents,
  workspaceProjectContextText,
} from "./realtime-context.js";
export {
  type AppToolAction,
  APP_TOOL_KIND,
  appToolAction,
  type CarriedAppAction,
  type CarriedIssueAction,
  type CarriedSessionAction,
  dispatchByKind,
  type IssueToolAction,
  isAppToolCall,
  isIssueToolName,
  isSessionToolName,
  issueToolAction,
  REALTIME_TOOL_FAMILY,
  type RealtimeToolFamily,
  realtimeToolFamily,
  SESSION_TOOL_KIND,
  type SessionToolAction,
  sessionToolAction,
} from "./realtime-tools.js";

// Surface — geometry, motion, marks, and labels.
export {
  CAPSULE_SIDE_WIDTH,
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  type NativeNotchGeometry,
  PANEL_FORM_FACTOR,
  PANEL_FORM_FACTOR_LIST,
  type PanelFormFactor,
  PEEK_MIN_WIDTH,
  PEEK_SIDE_GROWTH,
  peekWidth,
  positionNotchWindow,
  type Rectangle,
  type ResolvedNotchGeometry,
  resolveNotchGeometry,
  type WindowMode,
} from "./geometry.js";
export {
  MOTION_DELAY_MS,
  MOTION_DURATION_MS,
  PANEL_WIDTH,
  SESSION_NOTICE_HEIGHT,
  VOICE_CAPTION_MAX_HEIGHT,
} from "./motion-tokens.js";
export {
  CLAUDE_CODE_PATH,
  CLOUD_BADGE_PATH,
  CODEX_PATH,
  CONDUCTOR_MARK_PATHS,
  COPILOT_PATH,
  CURSOR_PATH,
  DEVIN_PATH,
  GOOGLE_CALENDAR_MARK_LAYERS,
  JULES_PATH,
  LINEAR_PATH,
  OPENAI_PATH,
  OPENCODE_BLOCK_PATH,
  OPENCODE_FRAME_PATH,
  ORCA_PATH,
} from "./provider-mark-paths.js";
export {
  compareSessionsByUrgency,
  SESSION_URGENCY,
  type SessionUrgency,
  urgencyLabel,
} from "./session-display.js";

// Fixtures — synthetic snapshots for evidence runs.
export {
  FIXTURE_EPOCH_MS,
  type FixtureSnapshot,
  fixtureSnapshot,
} from "./fixtures.js";
