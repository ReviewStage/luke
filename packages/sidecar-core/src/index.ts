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
} from "./json";

// Sessions — observed state, identity, and the registry that holds them.
export {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  agedStatus,
  maximumSessionRecapLength,
  maximumSessionTitleLength,
  type NormalizedSession,
  normalizeSession,
  OBSERVATION_WINDOW,
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionControl,
  type SessionControlKind,
  type SessionDetail,
  type SessionIdentity,
  type SessionLocation,
  type SessionProvider,
  type SessionStatus,
  sessionMessageText,
  UNKNOWN_WORKSPACE_LABEL,
} from "./session";
export { InMemorySessionRegistry } from "./session-registry";
export {
  SESSION_NOTICE_STATUS,
  type SessionNotice,
  type SessionNoticeStatus,
  SessionNoticeTracker,
} from "./session-notices";

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
} from "./providers";
export { CompositeSessionProviderAdapter } from "./composite-provider-adapter";

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
} from "./issues";

// Attention — whether a session change is worth voicing.
export {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  ATTENTION_TRIGGER,
  type AttentionEvaluator,
  type AttentionUpdate,
  attentionDecisionFromModel,
  SessionAttentionReviewer,
} from "./attention";
export {
  attentionInstructions,
  attentionUpdateInput,
} from "./attention-prompt";

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
} from "./guide";

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
} from "./realtime-voice-settings";
export {
  ATTENTION_SPEECH_SOURCE,
  type AttentionSpeech,
  attentionSpeechFromReviews,
  cancelResponseEvents,
  clearInputAudioEvents,
  functionCallFollowUpEvents,
  functionCallOutputEvents,
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
} from "./realtime-protocol";
export {
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  REALTIME_MINT_OUTCOME,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
  realtimeMintExplanation,
} from "./realtime-credentials";
export {
  appGuideContextEvents,
  issueContextEvents,
  issueContextText,
  issueTrackerDisconnectedEvents,
  sessionContextEvents,
  sessionContextText,
  workspaceProjectContextEvents,
  workspaceProjectContextText,
} from "./realtime-context";
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
} from "./realtime-tools";

// Surface — geometry, motion, marks, and labels.
export {
  CAPSULE_SIDE_WIDTH,
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  type NativeNotchGeometry,
  PANEL_FORM_FACTOR,
  PANEL_FORM_FACTOR_LIST,
  type PanelFormFactor,
  PEEK_SIDE_GROWTH,
  positionNotchWindow,
  type Rectangle,
  type ResolvedNotchGeometry,
  resolveNotchGeometry,
  type WindowMode,
} from "./geometry";
export {
  MOTION_DURATION_MS,
  PANEL_WIDTH,
  VOICE_CAPTION_MAX_HEIGHT,
} from "./motion-tokens";
export {
  CLAUDE_CODE_PATH,
  CLOUD_BADGE_PATH,
  CODEX_PATH,
  CONDUCTOR_MARK_PATHS,
  COPILOT_PATH,
  CURSOR_PATH,
  DEVIN_PATH,
  JULES_PATH,
  LINEAR_PATH,
  OPENAI_PATH,
  OPENCODE_BLOCK_PATH,
  OPENCODE_FRAME_PATH,
} from "./provider-mark-paths";
export {
  compareSessionsByUrgency,
  SESSION_URGENCY,
  type SessionUrgency,
  urgencyLabel,
} from "./session-display";

// Fixtures — synthetic snapshots for evidence runs.
export {
  FIXTURE_EPOCH_MS,
  type FixtureSnapshot,
  fixtureSnapshot,
} from "./fixtures";
