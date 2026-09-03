import {
  ACCOUNT_PROVIDER,
  type AccountProvider,
  type AccountSnapshot,
} from "@sidecar/account/snapshot";
import { APP_TOOL_KIND, isRememberedFacts, type RememberedFact } from "@sidecar/acts";
import {
  isProductExchangeKind,
  isProductSurfaceEventName,
  type ProductEventPropertiesFor,
  type ProductExchangeKind,
  type ProductSurfaceEventName,
  productEventFromWire,
} from "@sidecar/analytics";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import { type CredentialProviderId, isCredentialProviderId } from "@sidecar/credentials/vocabulary";
import { type AgentWireTrace, isAgentWireTrace } from "@sidecar/devtrace/vocabulary";
import {
  type FeedbackKind,
  type FeedbackResult,
  type FeedbackSubmission,
  feedbackSubmission,
  isFeedbackKind,
} from "@sidecar/feedback";
import { type AppGuideSnapshot, isAppGuideSnapshot } from "@sidecar/guide";
import { type IssueIdentity, isIssueTrackerId, type TrackedIssue } from "@sidecar/issues";
import {
  type ConversationEntry,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  storedConversationEntry,
} from "@sidecar/realtime";
import {
  isProviderId,
  isSessionApplicationId,
  type ObservedWorkspaceProject,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
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
  BrainAppActAnswer,
  BrainAppActRequest,
  BrainAskResult,
  BriefingPayload,
} from "./wire/brain";
import {
  type AppBootstrap,
  type ConversationHistoryPayload,
  type DisplayDiagnostic,
  type SessionOpenResult,
  type SessionReplayBootstrap,
  type SessionRosterPayload,
  WINDOW_ROLE,
  type WindowRole,
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

function isWindowRole(value: UnparsedWireValue): value is WindowRole {
  return value === WINDOW_ROLE.PANEL || value === WINDOW_ROLE.INTRODUCTION;
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
    // The level and the count are two different things on one channel: the
    // boolean is the panel's, sent on every change because the duck and the
    // face follow it, and the kind is the count's, sent only on the edge that
    // opened the exchange — so a turn walking from connecting to responding
    // is counted once, and named by who opened it.
    args: args<[boolean, ProductExchangeKind | undefined]>(
      (v) =>
        v.length === 2 &&
        isWireBoolean(v[0]) &&
        (v[1] === undefined || (v[0] === true && isProductExchangeKind(v[1]))),
    ),
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
  /**
   * A typed ask to Luke's brain, in the developer's own words. The reply comes
   * back as the words the voice speaks, with the observed sessions it named;
   * a run with no brain answers a bounded refusal the voice says instead.
   */
  askBrain: entry({
    kind: "invoke",
    channel: "app:ask-brain",
    args: oneString,
    result: result<BrainAskResult>(),
  }),
  /**
   * The renderer's guide snapshot, pushed whenever it changes, so the main
   * process can validate an app act against the settings the panel actually
   * describes and hand the brain the same text.
   */
  reportAppGuide: entry({
    kind: "send",
    channel: "app:report-app-guide",
    args: args<[AppGuideSnapshot]>((v) => v.length === 1 && isAppGuideSnapshot(v[0])),
  }),
  /**
   * The renderer's answer to one app act the brain asked it to perform,
   * matched to the request by id. The answer is the outcome record the brain
   * reads, as the renderer's own carrier produced it.
   */
  answerBrainAppAct: entry({
    kind: "send",
    channel: "app:answer-brain-app-act",
    args: args<[string, BrainAppActAnswer]>(
      (v) => v.length === 2 && isWireString(v[0]) && isRecord(v[1]) && isWireValue(v[1]),
    ),
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
  /**
   * The voice window reporting that the arrival beat's reply actually began,
   * which is the one thing that settles the owed record. A trigger the
   * renderer never heard, or a beat the announcer dropped unspoken — a
   * meeting's quiet, a call that would not open, news gone stale — settles
   * nothing, so the next signed-in launch speaks it instead.
   */
  completeArrivalBeat: entry({
    kind: "invoke",
    channel: "app:complete-arrival-beat",
    args: noArgs,
    result: result<void>(),
  }),
  /**
   * One window's copy of the conversation history, reported whole after each
   * line it appends. The main process holds the launch's thread and mirrors
   * the report to every other panel window, so the History tab reads the same
   * on every display; a window's own report is not echoed back to it. The
   * relay never leaves the machine, and every line in it is one the reporting
   * window already held on the terms the history's own module states.
   */
  reportConversationHistory: entry({
    kind: "send",
    channel: "app:report-conversation-history",
    args: args<[readonly ConversationEntry[]]>(
      (v) =>
        v.length === 1 &&
        Array.isArray(v[0]) &&
        v[0].every((entry) => {
          const stored = storedConversationEntry(entry);
          return (
            stored !== undefined &&
            (stored.identity === undefined || isSessionIdentity(stored.identity)) &&
            (stored.identities === undefined || stored.identities.every(isSessionIdentity))
          );
        }),
    ),
  }),
  /** The History Clear press, persisted and relayed to every other display. */
  clearConversationHistory: entry({
    kind: "invoke",
    channel: "app:clear-conversation-history",
    args: noArgs,
    result: result<boolean>(isWireBoolean),
  }),
  /**
   * Words the renderer already draws, placed on this machine's clipboard and
   * nowhere else. Routed through the main process because the panel's
   * permission handlers deny the sandboxed renderer every Chromium
   * permission but audio capture, the async clipboard included.
   */
  copyText: entry({ kind: "send", channel: "app:copy-text", args: oneString }),
  /**
   * The calendar gate's own skip: declines the onboarding step for good and
   * is remembered like a settle. It carries nothing and answers nothing —
   * the standing-down travels back on the onboarding broadcast.
   */
  skipCalendarOnboarding: entry({
    kind: "invoke",
    channel: "app:skip-calendar-onboarding",
    args: noArgs,
    result: result<void>(),
  }),
  /**
   * The gate's Done: the developer confirming the connected calendars are
   * the ones that should count, which is what settles the onboarding step —
   * a connect alone leaves the gate standing so the choice can still be
   * edited and another connection added.
   */
  completeCalendarOnboarding: entry({
    kind: "invoke",
    channel: "app:complete-calendar-onboarding",
    args: noArgs,
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
  /**
   * One tapped realtime event for the development trace. Fire-and-forget on
   * purpose: the tap must cost the conversation nothing, and the main process
   * simply drops it when no traced run is on — which is every packaged run,
   * because the writer only exists behind the unpackaged `LUKE_TRACE_DIR`
   * gate.
   */
  recordAgentTrace: entry({
    kind: "send",
    channel: "app:record-agent-trace",
    args: args<[AgentWireTrace]>((v) => v.length === 1 && isAgentWireTrace(v[0])),
  }),
  notifyReady: entry({ kind: "send", channel: "app:renderer-ready", args: noArgs }),
  /**
   * The introduction's one-shot keyless read of this machine's local sessions.
   * Answered only for the takeover window while the introduction is running;
   * every other caller gets an empty roster.
   */
  peekIntroductionSessions: entry({
    kind: "invoke",
    channel: "app:introduction-peek",
    args: noArgs,
    result: result<readonly Session[]>(),
  }),
  /**
   * The takeover reporting its ending: `given` says the sign-off was spoken
   * to its end, so completion is recorded; a quiet glide past a voice that
   * never stood up hands off the same way and records nothing, so the
   * introduction plays for real on a later launch.
   */
  completeIntroduction: entry({
    kind: "invoke",
    channel: "app:introduction-complete",
    args: oneBoolean,
    result: result<void>(),
  }),
  /**
   * The takeover reporting the introduction cannot be given — the voice never
   * connected — so the ordinary signed-out launch should stand in its place.
   * Nothing is marked completed: an introduction never given replays.
   */
  abandonIntroduction: entry({
    kind: "send",
    channel: "app:introduction-abandon",
    args: oneString,
  }),
  /** The takeover surface reporting it mounted, which its abandon deadline measures. */
  introductionMounted: entry({
    kind: "send",
    channel: "app:introduction-mounted",
    args: noArgs,
  }),
  /**
   * Which surface this window draws, asked before anything mounts. Its own
   * tiny invoke rather than a bootstrap field, so the ordinary panel renders
   * without waiting on the full bootstrap twice.
   */
  getWindowRole: entry({
    kind: "invoke",
    channel: "app:window-role",
    args: noArgs,
    result: result<WindowRole>(isWindowRole),
  }),
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
  onRememberedFactsChanged: entry({
    kind: "subscribe",
    channel: "app:remembered-facts-changed",
    args: noArgs,
    result: result<readonly RememberedFact[]>(isRememberedFacts),
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
  /**
   * The one-time arrival beat, decided in the main process at the sign-in
   * edge. It carries nothing: the trigger is the whole message, and the
   * beat's observed values are the renderer's own to read from the roster it
   * already draws.
   */
  onArrivalSpeech: entry({
    kind: "subscribe",
    channel: "app:arrival-speech",
    args: noArgs,
    result: result<void>((v) => v === undefined),
  }),
  /**
   * The calendar onboarding beat, decided in the main process while the
   * gate stands after the first sign-in. It carries nothing: the words are a
   * script fixed by the build, about the gate alone.
   */
  onCalendarOnboardingSpeech: entry({
    kind: "subscribe",
    channel: "app:calendar-onboarding-speech",
    args: noArgs,
    result: result<void>((v) => v === undefined),
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
  onAnnouncementsHeldChanged: entry({
    kind: "subscribe",
    channel: "app:announcements-held-changed",
    args: noArgs,
    result: result<boolean>(isWireBoolean),
  }),
  onCalendarOnboardingChanged: entry({
    kind: "subscribe",
    channel: "app:calendar-onboarding-changed",
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
  /** One briefing the brain decided to give, for the voice to speak as written. */
  onBriefing: entry({
    kind: "subscribe",
    channel: "app:briefing",
    args: noArgs,
    result: result<BriefingPayload>(),
  }),
  /**
   * An app act the brain decided that only the renderer can perform, already
   * validated in the main process against the guide the renderer reported.
   */
  onBrainAppAct: entry({
    kind: "subscribe",
    channel: "app:brain-app-act",
    args: noArgs,
    result: result<BrainAppActRequest>(
      (v) =>
        isRecord(v) &&
        isWireString(v.requestId) &&
        isRecord(v.action) &&
        isWireString(v.action.kind) &&
        v.action.kind !== APP_TOOL_KIND.REMEMBER &&
        v.action.kind !== APP_TOOL_KIND.FORGET,
    ),
  }),
  onConversationHistoryChanged: entry({
    kind: "subscribe",
    channel: "app:conversation-history-changed",
    args: noArgs,
    result: result<ConversationHistoryPayload>(),
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
