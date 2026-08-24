import {
  ACCOUNT_PROVIDER,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/account/snapshot";
import { type ActEnvelope, isActEnvelope } from "@sidecar/acts";
import {
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@sidecar/analytics";
import type { AttentionRequestResult, SessionNoticeAsk } from "@sidecar/attention";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import { type CredentialProviderId, isCredentialProviderId } from "@sidecar/credentials/vocabulary";
import {
  type FeedbackKind,
  type FeedbackResult,
  type FeedbackSubmission,
  feedbackSubmission,
  isFeedbackKind,
} from "@sidecar/feedback";
import type { HostedUsageAnswer } from "@sidecar/hosted";
import {
  type IssueIdentity,
  isIssueTrackerId,
  type TrackedIssue,
  type TrackerActionResult,
} from "@sidecar/issues";
import type {
  AttentionSpeech,
  IssueToolAction,
  RealtimeConnection,
  RealtimeDiagnostics,
} from "@sidecar/realtime";
import {
  isProviderId,
  isSessionApplicationId,
  isWorkspaceAgentSelection,
  type ObservedWorkspaceProject,
  type ProviderActResult,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceResult,
  type SessionApplicationId,
  type SessionIdentity,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingEntryKey,
  isSettingsResetScope,
  type KeyedAppSettingField,
  type SettingEntryValue,
  type SettingsResetScope,
  settingEntryGuard,
} from "@sidecar/settings";
import type { SupersetSignInSnapshot } from "@sidecar/superset/sign-in-stage";
import type { WindowMode } from "@sidecar/surface";
import {
  type ActResult,
  isActResult,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
} from "@sidecar/wire";
import type { AppleCalendarAccess } from "./apple-calendar";
import type {
  MicrophoneRoute,
  MicrophoneStatus,
  OutputAudioState,
  VoiceHotkeyState,
} from "./wire/audio";
import type {
  AppBootstrap,
  DisplayDiagnostic,
  SessionOpenResult,
  SessionReplayBootstrap,
  SessionRosterPayload,
  SessionTranscriptResult,
} from "./wire/session";
import type { AppSettings, SettingsUpdateResult } from "./wire/settings";
import type { UpdateSnapshot } from "./wire/update";

export interface WireGuard<Value> {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A bridge guard is the parser at the IPC boundary.
  (value: unknown): boolean;
  readonly wireType?: Value;
}

type BridgeArguments = readonly unknown[];
type BridgeKind = "invoke" | "send" | "subscribe";
type BridgeEntry<
  Kind extends BridgeKind,
  Channel extends string,
  Arguments extends BridgeArguments,
  Result,
> = {
  readonly kind: Kind;
  readonly channel: Channel;
  readonly args: WireGuard<Arguments>;
  readonly result?: WireGuard<Result>;
};

function entry<
  const Kind extends BridgeKind,
  const Channel extends string,
  Arguments extends BridgeArguments,
  Result,
>(
  definition: BridgeEntry<Kind, Channel, Arguments, Result>,
): BridgeEntry<Kind, Channel, Arguments, Result> {
  return definition;
}

function args<Arguments extends BridgeArguments>(
  guard: (values: readonly UnparsedWireValue[]) => boolean,
): WireGuard<Arguments> {
  return (value) => {
    if (!Array.isArray(value)) return false;
    // SAFETY: Array.isArray established the structured-clone argument envelope; the field guards parse every member.
    return guard(value as UnparsedWireValue[]);
  };
}

function result<Result>(
  guard: (value: UnparsedWireValue) => boolean = isWireValue,
): WireGuard<Result> {
  return (value) => guard(wireValue(value));
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the single conversion into the structured-clone parser vocabulary.
function wireValue(value: unknown): UnparsedWireValue {
  // SAFETY: callers immediately parse the runtime value; the assertion grants no domain type.
  return value as UnparsedWireValue;
}

function isWireValue(value: UnparsedWireValue): boolean {
  if (value === undefined || value === null || isWireString(value) || isWireBoolean(value))
    return true;
  if (isWireNumber(value)) return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isWireValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isWireValue);
}

const noArgs = args<[]>((values) => values.length === 0);
const oneString = args<[string]>((values) => values.length === 1 && isWireString(values[0]));
const oneBoolean = args<[boolean]>((values) => values.length === 1 && isWireBoolean(values[0]));

function isAccountProvider(value: UnparsedWireValue): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function parses an IPC field into a domain identity.
function isSessionIdentity(value: unknown): value is SessionIdentity {
  const wire = wireValue(value);
  if (!isRecord(wire)) return false;
  return (
    isWireString(wire.providerId) &&
    isProviderId(wire.providerId) &&
    isWireString(wire.providerSessionId) &&
    wire.providerSessionId.length > 0
  );
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function parses an IPC field into a domain identity.
function isIssueIdentity(value: unknown): value is IssueIdentity {
  const wire = wireValue(value);
  if (!isRecord(wire)) return false;
  return (
    isWireString(wire.trackerId) &&
    isIssueTrackerId(wire.trackerId) &&
    isWireString(wire.identifier) &&
    wire.identifier.length > 0
  );
}

type IssueActionAsk = Extract<IssueToolAction, { kind: "issue-state" | "issue-comment" }>;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function parses an IPC field into a domain action.
function isIssueActionAsk(value: unknown): value is IssueActionAsk {
  const wire = wireValue(value);
  if (!isRecord(wire) || !isWireString(wire.kind) || !isIssueIdentity(wire.identity)) return false;
  if (wire.kind === "issue-state") {
    return (
      isRecord(wire.transition) &&
      isWireString(wire.transition.id) &&
      wire.transition.id.length > 0 &&
      isWireString(wire.transition.name) &&
      wire.transition.name.length > 0
    );
  }
  return wire.kind === "issue-comment" && isWireString(wire.body);
}

const optionalString = (value: UnparsedWireValue): value is string | undefined =>
  value === undefined || isWireString(value);

type PlainSettingField = Exclude<AppSettingField, KeyedAppSettingField>;
type UpdateSettingArguments = {
  [Field in PlainSettingField]: [field: Field, value: AppSettingValue<Field>];
}[PlainSettingField];
type UpdateSettingEntryArguments = {
  [Field in KeyedAppSettingField]: [
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ];
}[KeyedAppSettingField];
type SurfaceEventArguments = {
  [Name in ProductSurfaceEventName]: [name: Name, properties: ProductEventPropertiesFor<Name>];
}[ProductSurfaceEventName];

export const BRIDGE = {
  getBootstrap: entry({
    kind: "invoke",
    channel: "app:bootstrap",
    args: noArgs,
    result: result<AppBootstrap>(),
  }),
  beginSignIn: entry({
    kind: "invoke",
    channel: "app:begin-sign-in",
    args: args<[AccountProvider]>((v) => v.length === 1 && isAccountProvider(v[0])),
    result: result<AccountSnapshot>(),
  }),
  cancelSignIn: entry({
    kind: "invoke",
    channel: "app:cancel-sign-in",
    args: noArgs,
    result: result<void>(),
  }),
  signOut: entry({
    kind: "invoke",
    channel: "app:sign-out",
    args: noArgs,
    result: result<AccountSnapshot>(),
  }),
  deleteAccount: entry({
    kind: "invoke",
    channel: "app:delete-account",
    args: noArgs,
    result: result<AccountSnapshot>(),
  }),
  setExpanded: entry({
    kind: "invoke",
    channel: "app:set-expanded",
    args: args<[boolean, boolean?]>(
      (v) =>
        (v.length === 1 || v.length === 2) &&
        isWireBoolean(v[0]) &&
        (v[1] === undefined || isWireBoolean(v[1])),
    ),
    result: result<WindowMode>(),
  }),
  setPointerInterception: entry({
    kind: "send",
    channel: "app:set-pointer-interception",
    args: oneBoolean,
  }),
  requestMicrophone: entry({
    kind: "invoke",
    channel: "app:request-microphone",
    args: noArgs,
    result: result<MicrophoneStatus>(),
  }),
  getMicrophoneRoute: entry({
    kind: "invoke",
    channel: "app:microphone-route",
    args: noArgs,
    result: result<MicrophoneRoute | undefined>(),
  }),
  openMicrophoneSettings: entry({
    kind: "send",
    channel: "app:open-microphone-settings",
    args: noArgs,
  }),
  setProviderApiKey: entry({
    kind: "invoke",
    channel: "app:set-provider-api-key",
    args: args<[CredentialProviderId, string | undefined]>(
      (v) => v.length === 2 && isCredentialProviderId(v[0]) && optionalString(v[1]),
    ),
    result: result<SettingsUpdateResult>(),
  }),
  updateSetting: entry({
    kind: "invoke",
    channel: "app:update-setting",
    args: args<UpdateSettingArguments>((v) => {
      if (v.length !== 2 || !isAppSettingField(v[0]) || isKeyedAppSettingField(v[0])) return false;
      return APP_SETTING_SCHEMA[v[0]].guard(v[1]).valid;
    }),
    result: result<SettingsUpdateResult>(),
  }),
  updateSettingEntry: entry({
    kind: "invoke",
    channel: "app:update-setting-entry",
    args: args<UpdateSettingEntryArguments>((v) => {
      if (v.length !== 3 || !isKeyedAppSettingField(v[0]) || !isSettingEntryKey(v[0], v[1]))
        return false;
      return settingEntryGuard(v[0], v[1], v[2]).valid;
    }),
    result: result<SettingsUpdateResult>(),
  }),
  openProviderApiKeys: entry({
    kind: "send",
    channel: "app:open-provider-api-keys",
    args: args<[CredentialProviderId]>((v) => v.length === 1 && isCredentialProviderId(v[0])),
  }),
  resetSettings: entry({
    kind: "invoke",
    channel: "app:reset-settings",
    args: args<[SettingsResetScope]>((v) => v.length === 1 && isSettingsResetScope(v[0])),
    result: result<SettingsUpdateResult>(),
  }),
  connectGoogleCalendar: entry({
    kind: "invoke",
    channel: "app:connect-google-calendar",
    args: noArgs,
    result: result<SettingsUpdateResult>(),
  }),
  cancelGoogleCalendarSignIn: entry({
    kind: "send",
    channel: "app:cancel-google-calendar-sign-in",
    args: noArgs,
  }),
  reopenGoogleCalendarSignIn: entry({
    kind: "send",
    channel: "app:reopen-google-calendar-sign-in",
    args: noArgs,
  }),
  removeCalendarAccount: entry({
    kind: "invoke",
    channel: "app:remove-calendar-account",
    args: oneString,
    result: result<SettingsUpdateResult>(),
  }),
  connectAppleCalendar: entry({
    kind: "invoke",
    channel: "app:connect-apple-calendar",
    args: noArgs,
    result: result<SettingsUpdateResult>(),
  }),
  disconnectAppleCalendar: entry({
    kind: "invoke",
    channel: "app:disconnect-apple-calendar",
    args: noArgs,
    result: result<SettingsUpdateResult>(),
  }),
  appleCalendarAccessStatus: entry({
    kind: "invoke",
    channel: "app:apple-calendar-access-status",
    args: noArgs,
    result: result<AppleCalendarAccess>(),
  }),
  cancelAppleCalendarConnect: entry({
    kind: "send",
    channel: "app:cancel-apple-calendar-connect",
    args: noArgs,
  }),
  openCalendarSettings: entry({
    kind: "send",
    channel: "app:open-calendar-settings",
    args: noArgs,
  }),
  refreshCalendars: entry({
    kind: "invoke",
    channel: "app:refresh-calendars",
    args: noArgs,
    result: result<void>(),
  }),
  setCalendarSelected: entry({
    kind: "invoke",
    channel: "app:set-calendar-selected",
    args: args<[string, string, boolean]>(
      (v) =>
        v.length === 3 &&
        isWireString(v[0]) &&
        v[0].length > 0 &&
        isWireString(v[1]) &&
        v[1].length > 0 &&
        isWireBoolean(v[2]),
    ),
    result: result<SettingsUpdateResult>(),
  }),
  connectLinear: entry({
    kind: "invoke",
    channel: "app:connect-linear",
    args: noArgs,
    result: result<SettingsUpdateResult>(),
  }),
  cancelLinearSignIn: entry({ kind: "send", channel: "app:cancel-linear-sign-in", args: noArgs }),
  reopenLinearSignIn: entry({ kind: "send", channel: "app:reopen-linear-sign-in", args: noArgs }),
  disconnectLinear: entry({
    kind: "invoke",
    channel: "app:disconnect-linear",
    args: noArgs,
    result: result<SettingsUpdateResult>(),
  }),
  checkForUpdates: entry({
    kind: "invoke",
    channel: "app:check-for-updates",
    args: noArgs,
    result: result<UpdateSnapshot>(),
  }),
  installUpdate: entry({ kind: "send", channel: "app:install-update", args: noArgs }),
  openLatestRelease: entry({ kind: "send", channel: "app:open-latest-release", args: noArgs }),
  openChangelog: entry({ kind: "send", channel: "app:open-changelog", args: noArgs }),
  beginSupersetSignIn: entry({
    kind: "invoke",
    channel: "app:begin-superset-sign-in",
    args: noArgs,
    result: result<SupersetSignInSnapshot>(),
  }),
  submitSupersetSignInCode: entry({
    kind: "invoke",
    channel: "app:submit-superset-sign-in-code",
    args: oneString,
    result: result<SupersetSignInSnapshot>(),
  }),
  reopenSupersetSignIn: entry({
    kind: "send",
    channel: "app:reopen-superset-sign-in",
    args: noArgs,
  }),
  cancelSupersetSignIn: entry({
    kind: "send",
    channel: "app:cancel-superset-sign-in",
    args: noArgs,
  }),
  chooseSupersetOrganization: entry({
    kind: "invoke",
    channel: "app:choose-superset-organization",
    args: oneString,
    result: result<SupersetSignInSnapshot>(),
  }),
  disconnectSuperset: entry({
    kind: "invoke",
    channel: "app:disconnect-superset",
    args: noArgs,
    result: result<ActResult>(isActResult),
  }),
  setVoiceExchangeActive: entry({
    kind: "send",
    channel: "app:set-voice-exchange",
    args: oneBoolean,
  }),
  authorizeAct: entry({
    kind: "invoke",
    channel: "app:authorize-act",
    args: args<[ActEnvelope]>((v) => v.length === 1 && isActEnvelope(v[0])),
    result: result<ActResult>(isActResult),
  }),
  openSession: entry({
    kind: "invoke",
    channel: "app:open-session",
    args: args<[SessionIdentity]>((v) => v.length === 1 && isSessionIdentity(v[0])),
    result: result<SessionOpenResult>(),
  }),
  openSessionApplication: entry({
    kind: "invoke",
    channel: "app:open-session-application",
    args: args<[SessionIdentity, SessionApplicationId]>(
      (v) =>
        v.length === 2 &&
        isSessionIdentity(v[0]) &&
        isWireString(v[1]) &&
        isSessionApplicationId(v[1]),
    ),
    result: result<SessionOpenResult>(),
  }),
  openSessionChange: entry({
    kind: "invoke",
    channel: "app:open-session-change",
    args: args<[SessionIdentity]>((v) => v.length === 1 && isSessionIdentity(v[0])),
    result: result<SessionOpenResult>(),
  }),
  readSessionTranscript: entry({
    kind: "invoke",
    channel: "app:read-session-transcript",
    args: args<[SessionIdentity]>((v) => v.length === 1 && isSessionIdentity(v[0])),
    result: result<SessionTranscriptResult>(),
  }),
  sendSessionMessage: entry({
    kind: "invoke",
    channel: "app:send-session-message",
    args: args<[SessionIdentity, string]>(
      (v) => v.length === 2 && isSessionIdentity(v[0]) && isWireString(v[1]),
    ),
    result: result<ProviderMessageResult>(),
  }),
  executeSessionControl: entry({
    kind: "invoke",
    channel: "app:execute-session-control",
    args: args<[SessionIdentity, string]>(
      (v) =>
        v.length === 2 && isSessionIdentity(v[0]) && isWireString(v[1]) && v[1].trim().length > 0,
    ),
    result: result<ProviderControlResult>(),
  }),
  requestSessionNotice: entry({
    kind: "invoke",
    channel: "app:request-session-notice",
    args: args<[SessionIdentity, string]>(
      (v) => v.length === 2 && isSessionIdentity(v[0]) && isWireString(v[1]),
    ),
    result: result<AttentionRequestResult>(),
  }),
  withdrawSessionNotice: entry({
    kind: "invoke",
    channel: "app:withdraw-session-notice",
    args: args<[SessionIdentity]>((v) => v.length === 1 && isSessionIdentity(v[0])),
    result: result<AttentionRequestResult>(),
  }),
  createSessionWorkspace: entry({
    kind: "invoke",
    channel: "app:create-session-workspace",
    args: args<[string, string, string?, string?, string?, string?, WorkspaceAgentSelection?]>(
      (v) => {
        if (
          v.length < 2 ||
          v.length > 7 ||
          !isWireString(v[0]) ||
          !isProviderId(v[0]) ||
          !isWireString(v[1])
        )
          return false;
        if (
          !optionalString(v[2]) ||
          !optionalString(v[3]) ||
          !optionalString(v[4]) ||
          !optionalString(v[5])
        )
          return false;
        return v[6] === undefined || isWorkspaceAgentSelection(v[0], v[6]);
      },
    ),
    result: result<ProviderWorkspaceResult>(),
  }),
  addWorkspaceAgent: entry({
    kind: "invoke",
    channel: "app:add-workspace-agent",
    args: args<[SessionIdentity, string, string?, string?, string?, string?]>(
      (v) =>
        v.length >= 2 &&
        v.length <= 6 &&
        isSessionIdentity(v[0]) &&
        isWireString(v[1]) &&
        optionalString(v[2]) &&
        optionalString(v[3]) &&
        optionalString(v[4]) &&
        optionalString(v[5]) &&
        (v[5] === undefined || v[4] !== undefined),
    ),
    result: result<ProviderWorkspaceResult>(),
  }),
  renameSessionWorkspace: entry({
    kind: "invoke",
    channel: "app:rename-session-workspace",
    args: args<[SessionIdentity, string]>(
      (v) => v.length === 2 && isSessionIdentity(v[0]) && isWireString(v[1]),
    ),
    result: result<ProviderActResult>(isActResult),
  }),
  renameSession: entry({
    kind: "invoke",
    channel: "app:rename-session",
    args: args<[SessionIdentity, string]>(
      (v) => v.length === 2 && isSessionIdentity(v[0]) && isWireString(v[1]),
    ),
    result: result<ProviderActResult>(isActResult),
  }),
  executeIssueAction: entry({
    kind: "invoke",
    channel: "app:execute-issue-action",
    args: args<[IssueActionAsk]>((v) => v.length === 1 && isIssueActionAsk(v[0])),
    result: result<TrackerActionResult>(isActResult),
  }),
  openIssue: entry({
    kind: "invoke",
    channel: "app:open-issue",
    args: args<[IssueIdentity]>((v) => v.length === 1 && isIssueIdentity(v[0])),
    result: result<SessionOpenResult>(),
  }),
  sendFeedback: entry({
    kind: "invoke",
    channel: "app:send-feedback",
    args: args<[FeedbackSubmission]>(
      (v) => v.length === 1 && feedbackSubmission(v[0]) !== undefined,
    ),
    result: result<FeedbackResult>(),
  }),
  summonFeedback: entry({
    kind: "invoke",
    channel: "app:summon-feedback",
    args: args<[FeedbackKind]>((v) => v.length === 1 && isFeedbackKind(v[0])),
    result: result<void>(),
  }),
  focusPanel: entry({ kind: "send", channel: "app:focus-panel", args: noArgs }),
  requestRealtimeCredential: entry({
    kind: "invoke",
    channel: "app:request-realtime-credential",
    args: noArgs,
    result: result<RealtimeConnection | undefined>(),
  }),
  requestRealtimeDiagnostics: entry({
    kind: "invoke",
    channel: "app:request-realtime-diagnostics",
    args: noArgs,
    result: result<RealtimeDiagnostics>(),
  }),
  requestHostedUsage: entry({
    kind: "invoke",
    channel: "app:request-hosted-usage",
    args: noArgs,
    result: result<HostedUsageAnswer | undefined>(),
  }),
  notifyReady: entry({ kind: "send", channel: "app:renderer-ready", args: noArgs }),
  quit: entry({ kind: "send", channel: "app:quit", args: noArgs }),
  recordSurfaceEvent: entry({
    kind: "send",
    channel: "app:record-surface-event",
    args: args<SurfaceEventArguments>(
      (v) =>
        v.length === 2 &&
        isProductSurfaceEventName(v[0]) &&
        productEventFromWire({ name: v[0], at: Date.now(), properties: v[1] ?? {} }) !== undefined,
    ),
  }),
  onLifecycle: entry({
    kind: "subscribe",
    channel: "app:lifecycle",
    args: noArgs,
    result: result<string>(isWireString),
  }),
  onDisplayChanged: entry({
    kind: "subscribe",
    channel: "app:display-changed",
    args: noArgs,
    result: result<DisplayDiagnostic>(),
  }),
  onSettingsChanged: entry({
    kind: "subscribe",
    channel: "app:settings-changed",
    args: noArgs,
    result: result<AppSettings>(),
  }),
  onAccountChanged: entry({
    kind: "subscribe",
    channel: "app:account-changed",
    args: noArgs,
    result: result<AccountSnapshot | undefined>(),
  }),
  onSessionReplayChanged: entry({
    kind: "subscribe",
    channel: "app:session-replay-changed",
    args: noArgs,
    result: result<SessionReplayBootstrap>(),
  }),
  onUpdateChanged: entry({
    kind: "subscribe",
    channel: "app:update-changed",
    args: noArgs,
    result: result<UpdateSnapshot>(),
  }),
  onSessionsChanged: entry({
    kind: "subscribe",
    channel: "app:sessions-changed",
    args: noArgs,
    result: result<SessionRosterPayload>(),
  }),
  onNoticeAsksChanged: entry({
    kind: "subscribe",
    channel: "app:notice-asks-changed",
    args: noArgs,
    result: result<readonly SessionNoticeAsk[]>(),
  }),
  onWorkspaceProjectsChanged: entry({
    kind: "subscribe",
    channel: "app:workspace-projects-changed",
    args: noArgs,
    result: result<readonly ObservedWorkspaceProject[]>(),
  }),
  onIssuesChanged: entry({
    kind: "subscribe",
    channel: "app:issues-changed",
    args: noArgs,
    result: result<readonly TrackedIssue[] | undefined>(),
  }),
  onCalendarsChanged: entry({
    kind: "subscribe",
    channel: "app:calendars-changed",
    args: noArgs,
    result: result<readonly ObservedAccountCalendars[]>(),
  }),
  onMeetingQuietChanged: entry({
    kind: "subscribe",
    channel: "app:meeting-quiet-changed",
    args: noArgs,
    result: result<boolean>(isWireBoolean),
  }),
  onVoiceHotkeyPress: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-press",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  onVoiceHotkeyRelease: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-release",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  onVoiceHotkeyChanged: entry({
    kind: "subscribe",
    channel: "app:voice-hotkey-changed",
    args: noArgs,
    result: result<VoiceHotkeyState>(),
  }),
  onAskHotkeyChanged: entry({
    kind: "subscribe",
    channel: "app:ask-hotkey-changed",
    args: noArgs,
    result: result<string | undefined>(optionalString),
  }),
  onStopHotkeyPress: entry({
    kind: "subscribe",
    channel: "app:stop-hotkey-press",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  onStopHotkeyChanged: entry({
    kind: "subscribe",
    channel: "app:stop-hotkey-changed",
    args: noArgs,
    result: result<string | undefined>(optionalString),
  }),
  onOutputAudioChanged: entry({
    kind: "subscribe",
    channel: "app:output-audio-changed",
    args: noArgs,
    result: result<OutputAudioState | undefined>(),
  }),
  onSupersetSignInChanged: entry({
    kind: "subscribe",
    channel: "app:superset-sign-in-changed",
    args: noArgs,
    result: result<SupersetSignInSnapshot>(),
  }),
  onAttentionSpeech: entry({
    kind: "subscribe",
    channel: "app:attention-speech",
    args: noArgs,
    result: result<readonly AttentionSpeech[]>(),
  }),
} as const;

export type Bridge = typeof BRIDGE;
export type BridgeMethod = keyof Bridge;
type ArgumentsOf<Entry> = Entry extends { args: WireGuard<infer Arguments> } ? Arguments : never;
type ResultOf<Entry> = Entry extends { result?: WireGuard<infer Result> } ? Result : undefined;
export type BridgeArgumentsFor<Method extends BridgeMethod> = ArgumentsOf<Bridge[Method]>;
export type BridgeResultFor<Method extends BridgeMethod> = ResultOf<Bridge[Method]>;

type DerivedAppBridge = {
  [Method in BridgeMethod]: Bridge[Method]["kind"] extends "invoke"
    ? (...args: ArgumentsOf<Bridge[Method]>) => Promise<ResultOf<Bridge[Method]>>
    : Bridge[Method]["kind"] extends "send"
      ? (...args: ArgumentsOf<Bridge[Method]>) => void
      : (callback: (payload: ResultOf<Bridge[Method]>) => void) => () => void;
};

export type AppBridge = Omit<
  DerivedAppBridge,
  "recordSurfaceEvent" | "updateSetting" | "updateSettingEntry"
> & {
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
  ): Promise<SettingsUpdateResult>;
  updateSettingEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
  ): Promise<SettingsUpdateResult>;
  recordSurfaceEvent<Name extends ProductSurfaceEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
};

const channelTable = Object.fromEntries(
  Object.entries(BRIDGE).map(([method, definition]) => [method, definition.channel]),
);

function typedChannels(): { readonly [Method in BridgeMethod]: Bridge[Method]["channel"] } {
  // SAFETY: every pair is projected from BRIDGE without changing its method or channel.
  return channelTable as { readonly [Method in BridgeMethod]: Bridge[Method]["channel"] };
}

export const channels = typedChannels();

export function bridgeEntries(): ReadonlyArray<[BridgeMethod, Bridge[BridgeMethod]]> {
  // SAFETY: Object.entries only erases the literal keys already declared by BRIDGE.
  return Object.entries(BRIDGE) as Array<[BridgeMethod, Bridge[BridgeMethod]]>;
}
