import type { AccountProvider, AccountSnapshot } from "@sidecar/account/snapshot";
import type { ProductEventName, ProductEventPropertiesFor } from "@sidecar/analytics";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import type { AppleCalendarAccess } from "@sidecar/calendar/vocabulary";
import type { CredentialProviderId } from "@sidecar/credentials";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import type { GatewayCallResult, GatewayClient } from "@sidecar/gateway";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, gatewayEventReader } from "@sidecar/gateway";
import type { AppGuideSnapshot } from "@sidecar/guide";
import { RECEIVER_REPORT_KIND } from "@sidecar/host";
import type { RealtimeConnection } from "@sidecar/hosted";
import type { SupersetSignInSnapshot } from "@sidecar/providers/superset/sign-in-stage";
import type { ConversationEntry, RealtimeDiagnostics } from "@sidecar/realtime";
import type { SpeechOffer, SpeechOutcome } from "@sidecar/realtime/speech";
import { isSpeechOffer } from "@sidecar/realtime/speech";
import type {
  ObservedWorkspaceProject,
  Session,
  SessionApplicationId,
  SessionIdentity,
} from "@sidecar/session";
import type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
  SettingsResetScope,
} from "@sidecar/settings";
import type { AppSettings, SettingsUpdateResult } from "@sidecar/settings/wire";
import {
  ACT_RESULT_STATUS,
  type ActResult,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

/**
 * The desktop's client over the host's own vocabulary: the settings, account,
 * integration, session, voice, and client-fact methods the runtime host
 * answers, and the events it pushes. Each call composes one request and reads
 * its answer; a host that cannot be reached answers the typed disconnected
 * error, which reads here as an absent value or, for a settings write, as a
 * refusal worded for the row, never as a throw into the renderer. Nothing
 * here holds host state beyond the last settings snapshot a refusal is
 * answered with.
 */
export interface HostBootstrap {
  settings: AppSettings;
  account: AccountSnapshot;
  sessions: readonly Session[];
  sessionsSettled: boolean;
  announcementsHeld: boolean;
  conversationHistory: readonly ConversationEntry[];
  workspaceProjects: readonly ObservedWorkspaceProject[];
  calendars: readonly ObservedAccountCalendars[];
  calendarOnboardingOwed: boolean;
  supersetInstalled: boolean;
  supersetConnected: boolean;
  sessionReplay: { permitted: boolean; accountId?: string };
  receiverEpoch: number;
  voiceAvailable: boolean;
  agentTraceEnabled: boolean;
}

export interface HostSettingsChange {
  settings: AppSettings;
  /** The opaque reporter whose write produced the change, so the relay can skip echoing it. */
  reporter?: string;
}

export interface HostSessionReplay {
  permitted: boolean;
  accountId?: string;
}

export interface HostOperator {
  bootstrap(): Promise<HostBootstrap | undefined>;
  settingsSnapshot(): Promise<AppSettings | undefined>;
  updateSetting<Field extends Exclude<AppSettingField, KeyedAppSettingField>>(
    field: Field,
    value: AppSettingValue<Field>,
    reporter: string,
  ): Promise<SettingsUpdateResult>;
  updateSettingEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
    reporter: string,
  ): Promise<SettingsUpdateResult>;
  resetSettings(scope: SettingsResetScope, reporter: string): Promise<SettingsUpdateResult>;
  setProviderApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
    reporter: string,
  ): Promise<SettingsUpdateResult>;
  accountSnapshot(): Promise<AccountSnapshot | undefined>;
  beginSignIn(provider: AccountProvider): Promise<AccountSnapshot>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<AccountSnapshot>;
  deleteAccount(): Promise<AccountSnapshot>;
  connectGoogleCalendar(reporter: string): Promise<SettingsUpdateResult>;
  cancelGoogleCalendarSignIn(): Promise<void>;
  reopenGoogleCalendarSignIn(): Promise<void>;
  removeCalendarAccount(accountId: string, reporter: string): Promise<SettingsUpdateResult>;
  connectAppleCalendar(reporter: string): Promise<SettingsUpdateResult>;
  disconnectAppleCalendar(reporter: string): Promise<SettingsUpdateResult>;
  appleCalendarAccessStatus(): Promise<AppleCalendarAccess | undefined>;
  cancelAppleCalendarConnect(): Promise<void>;
  refreshCalendars(): Promise<void>;
  setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
    reporter: string,
  ): Promise<SettingsUpdateResult>;
  connectLinear(reporter: string): Promise<SettingsUpdateResult>;
  cancelLinearSignIn(): Promise<void>;
  reopenLinearSignIn(): Promise<void>;
  disconnectLinear(reporter: string): Promise<SettingsUpdateResult>;
  supersetStatus(): Promise<{ installed: boolean; connected: boolean }>;
  beginSupersetSignIn(): Promise<SupersetSignInSnapshot | undefined>;
  submitSupersetSignInCode(code: string): Promise<SupersetSignInSnapshot | undefined>;
  chooseSupersetOrganization(slug: string): Promise<SupersetSignInSnapshot | undefined>;
  reopenSupersetSignIn(): Promise<void>;
  cancelSupersetSignIn(): Promise<void>;
  disconnectSuperset(): Promise<ActResult>;
  sessionRoster(): Promise<{ sessions: readonly Session[]; settled: boolean }>;
  openSession(identity: SessionIdentity): Promise<ActResult>;
  openSessionApplication(
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Promise<ActResult>;
  openSessionChange(identity: SessionIdentity): Promise<ActResult>;
  workspaceProjects(): Promise<readonly ObservedWorkspaceProject[]>;
  settleSpeech(id: string, outcome: SpeechOutcome): Promise<void>;
  /** The host mints the receiver epoch a voice renderer will name; a client that cannot reach it gets none. */
  beginReceiver(): Promise<number | undefined>;
  readyReceiver(epoch: number): Promise<boolean>;
  resetReceiver(): Promise<void>;
  mintRealtimeCredential(): Promise<RealtimeConnection | undefined>;
  realtimeDiagnostics(): Promise<RealtimeDiagnostics | undefined>;
  /** One tapped wire event for the host's development trace; the host drops it where no writer stands. */
  recordAgentTrace(trace: AgentWireTrace): void;
  reportGuide(guide: AppGuideSnapshot): Promise<void>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
  appendHistory(entries: readonly ConversationEntry[], reporter: string): Promise<boolean>;
  onboardingState(): Promise<{ calendarOnboardingOwed: boolean } | undefined>;
  skipCalendarOnboarding(): Promise<void>;
  completeCalendarOnboarding(): Promise<void>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onSessionsChanged(
    listener: (roster: { sessions: readonly Session[]; settled: boolean }) => void,
  ): () => void;
  onWorkspaceProjectsChanged(
    listener: (projects: readonly ObservedWorkspaceProject[]) => void,
  ): () => void;
  onCalendarsChanged(
    listener: (calendars: readonly ObservedAccountCalendars[]) => void,
  ): () => void;
  onAnnouncementsHeldChanged(listener: (held: boolean) => void): () => void;
  onSupersetSignInChanged(listener: (state: SupersetSignInSnapshot) => void): () => void;
  onCalendarOnboardingChanged(listener: (owed: boolean) => void): () => void;
  onSpeechOffered(listener: (offer: SpeechOffer) => void): () => void;
  onSpeechWithdrawn(listener: (id: string) => void): () => void;
  onSessionReplayChanged(listener: (replay: HostSessionReplay) => void): () => void;
}

export interface HostOperatorOptions {
  client: GatewayClient;
  /** The settings a refused write is answered with when the host cannot say; the last snapshot the client saw. */
  lastSettings: () => AppSettings | undefined;
  report: (message: string) => void;
}

export const HOST_UNREACHABLE_REFUSAL = "Luke's runtime is not reachable right now.";

/**
 * The host's answers are the same structured-clone payloads the windows
 * already receive over the bridge, carried through the protocol as JSON. The
 * readers below check the field the client itself decides on and hand the
 * rest on to the bridge, whose result guards are the renderer's own check.
 */
function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is Luke's own authenticated process answering the shape the method documents; the bridge's result guard re-checks it before a renderer sees it.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The protocol carries JSON; the domain type is restored at this one boundary.
  return value === undefined ? undefined : (value as unknown as Value);
}

function answeredList<Value>(value: UnparsedWireValue): readonly Value[] {
  return Array.isArray(value) ? value.flatMap((entry) => answered<Value>(entry) ?? []) : [];
}

export function createHostOperator(options: HostOperatorOptions): HostOperator {
  const { client } = options;

  const settingsResult = async (
    result: Promise<GatewayCallResult>,
  ): Promise<SettingsUpdateResult> => {
    const answer = record(await result);
    const parsed = answered<SettingsUpdateResult>(answer);
    if (parsed?.settings !== undefined) return parsed;
    const settings = options.lastSettings();
    if (!settings) throw new Error(HOST_UNREACHABLE_REFUSAL);
    return { status: ACT_RESULT_STATUS.REJECTED, settings, reason: HOST_UNREACHABLE_REFUSAL };
  };

  const accountResult = async (result: Promise<GatewayCallResult>): Promise<AccountSnapshot> => {
    const answer = record(await result);
    const account = answered<AccountSnapshot>(answer?.account);
    if (account) return account;
    throw new Error(HOST_UNREACHABLE_REFUSAL);
  };

  const actResult = async (result: Promise<GatewayCallResult>): Promise<ActResult> => {
    const answer = answered<ActResult>(record(await result));
    return answer ?? { status: ACT_RESULT_STATUS.REJECTED, reason: HOST_UNREACHABLE_REFUSAL };
  };

  const supersetResult = async (
    result: Promise<GatewayCallResult>,
  ): Promise<SupersetSignInSnapshot | undefined> =>
    answered<SupersetSignInSnapshot>(record(await result)?.state);

  const fire = async (result: Promise<GatewayCallResult>): Promise<void> => {
    await result;
  };

  const on = gatewayEventReader(client);

  const wireReporter = (reporter: string) => ({ reporter });

  return {
    bootstrap: async () =>
      answered<HostBootstrap>(record(await client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP))),
    settingsSnapshot: async () =>
      answered<AppSettings>(record(await client.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT))?.settings),
    updateSetting: (field, value, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.SETTINGS_UPDATE, {
          field,
          value: carried(value),
          ...wireReporter(reporter),
        }),
      ),
    updateSettingEntry: (field, key, value, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY, {
          field,
          key,
          ...(value !== undefined ? { value: carried(value) } : undefined),
          ...wireReporter(reporter),
        }),
      ),
    resetSettings: (scope, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.SETTINGS_RESET, { scope, ...wireReporter(reporter) }),
      ),
    setProviderApiKey: (providerId, apiKey, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.CREDENTIAL_SET_API_KEY, {
          providerId,
          ...(apiKey !== undefined ? { apiKey } : undefined),
          ...wireReporter(reporter),
        }),
      ),
    accountSnapshot: async () =>
      answered<AccountSnapshot>(
        record(await client.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT))?.account,
      ),
    beginSignIn: (provider) =>
      accountResult(client.call(GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN, { provider })),
    cancelSignIn: () => fire(client.call(GATEWAY_METHOD.ACCOUNT_CANCEL_SIGN_IN)),
    signOut: () => accountResult(client.call(GATEWAY_METHOD.ACCOUNT_SIGN_OUT)),
    deleteAccount: () => accountResult(client.call(GATEWAY_METHOD.ACCOUNT_DELETE)),
    connectGoogleCalendar: (reporter) =>
      settingsResult(client.call(GATEWAY_METHOD.CALENDAR_CONNECT_GOOGLE, wireReporter(reporter))),
    cancelGoogleCalendarSignIn: () =>
      fire(client.call(GATEWAY_METHOD.CALENDAR_CANCEL_GOOGLE_SIGN_IN)),
    reopenGoogleCalendarSignIn: () =>
      fire(client.call(GATEWAY_METHOD.CALENDAR_REOPEN_GOOGLE_SIGN_IN)),
    removeCalendarAccount: (accountId, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.CALENDAR_REMOVE_ACCOUNT, {
          accountId,
          ...wireReporter(reporter),
        }),
      ),
    connectAppleCalendar: (reporter) =>
      settingsResult(client.call(GATEWAY_METHOD.CALENDAR_CONNECT_APPLE, wireReporter(reporter))),
    disconnectAppleCalendar: (reporter) =>
      settingsResult(client.call(GATEWAY_METHOD.CALENDAR_DISCONNECT_APPLE, wireReporter(reporter))),
    appleCalendarAccessStatus: async () =>
      answered<AppleCalendarAccess>(
        record(await client.call(GATEWAY_METHOD.CALENDAR_APPLE_ACCESS_STATUS))?.access,
      ),
    cancelAppleCalendarConnect: () =>
      fire(client.call(GATEWAY_METHOD.CALENDAR_CANCEL_APPLE_CONNECT)),
    refreshCalendars: () => fire(client.call(GATEWAY_METHOD.CALENDAR_REFRESH)),
    setCalendarSelected: (accountId, calendarId, selected, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.CALENDAR_SET_SELECTED, {
          accountId,
          calendarId,
          selected,
          ...wireReporter(reporter),
        }),
      ),
    connectLinear: (reporter) =>
      settingsResult(client.call(GATEWAY_METHOD.TRACKER_CONNECT, wireReporter(reporter))),
    cancelLinearSignIn: () => fire(client.call(GATEWAY_METHOD.TRACKER_CANCEL_SIGN_IN)),
    reopenLinearSignIn: () => fire(client.call(GATEWAY_METHOD.TRACKER_REOPEN_SIGN_IN)),
    disconnectLinear: (reporter) =>
      settingsResult(client.call(GATEWAY_METHOD.TRACKER_DISCONNECT, wireReporter(reporter))),
    supersetStatus: async () => {
      const answer = record(await client.call(GATEWAY_METHOD.SUPERSET_STATUS));
      return {
        installed: answer?.installed === true,
        connected: answer?.connected === true,
      };
    },
    beginSupersetSignIn: () => supersetResult(client.call(GATEWAY_METHOD.SUPERSET_BEGIN_SIGN_IN)),
    submitSupersetSignInCode: (code) =>
      supersetResult(client.call(GATEWAY_METHOD.SUPERSET_SUBMIT_CODE, { code })),
    chooseSupersetOrganization: (slug) =>
      supersetResult(client.call(GATEWAY_METHOD.SUPERSET_CHOOSE_ORGANIZATION, { slug })),
    reopenSupersetSignIn: () => fire(client.call(GATEWAY_METHOD.SUPERSET_REOPEN_SIGN_IN)),
    cancelSupersetSignIn: () => fire(client.call(GATEWAY_METHOD.SUPERSET_CANCEL_SIGN_IN)),
    disconnectSuperset: () => actResult(client.call(GATEWAY_METHOD.SUPERSET_DISCONNECT)),
    sessionRoster: async () => {
      const answer = record(await client.call(GATEWAY_METHOD.SESSION_ROSTER));
      return {
        sessions: answeredList<Session>(answer?.sessions),
        settled: answer?.settled === true,
      };
    },
    openSession: (identity) =>
      actResult(client.call(GATEWAY_METHOD.SESSION_OPEN, { identity: { ...identity } })),
    openSessionApplication: (identity, applicationId) =>
      actResult(
        client.call(GATEWAY_METHOD.SESSION_OPEN_APPLICATION, {
          identity: { ...identity },
          applicationId,
        }),
      ),
    openSessionChange: (identity) =>
      actResult(client.call(GATEWAY_METHOD.SESSION_OPEN_CHANGE, { identity: { ...identity } })),
    workspaceProjects: async () =>
      answeredList<ObservedWorkspaceProject>(
        record(await client.call(GATEWAY_METHOD.WORKSPACE_PROJECTS))?.projects,
      ),
    settleSpeech: (id, outcome) => fire(client.call(GATEWAY_METHOD.SPEECH_SETTLE, { id, outcome })),
    beginReceiver: async () => {
      const answer = record(
        await client.call(GATEWAY_METHOD.RECEIVER_REPORT, { kind: RECEIVER_REPORT_KIND.BEGIN }),
      );
      return isWireNumber(answer?.epoch) ? answer.epoch : undefined;
    },
    readyReceiver: async (epoch) => {
      const answer = record(
        await client.call(GATEWAY_METHOD.RECEIVER_REPORT, {
          kind: RECEIVER_REPORT_KIND.READY,
          epoch,
        }),
      );
      return answer?.ready === true;
    },
    resetReceiver: () =>
      fire(client.call(GATEWAY_METHOD.RECEIVER_REPORT, { kind: RECEIVER_REPORT_KIND.RESET })),
    mintRealtimeCredential: async () =>
      answered<RealtimeConnection>(
        record(await client.call(GATEWAY_METHOD.VOICE_MINT_REALTIME_CREDENTIAL))?.credential,
      ),
    realtimeDiagnostics: async () =>
      answered<RealtimeDiagnostics>(
        record(await client.call(GATEWAY_METHOD.VOICE_DIAGNOSTICS))?.diagnostics,
      ),
    recordAgentTrace: (trace) => {
      void client.call(GATEWAY_METHOD.VOICE_RECORD_TRACE, { trace: carried(trace) });
    },
    reportGuide: (guide) =>
      fire(client.call(GATEWAY_METHOD.GUIDE_REPORT, { guide: carried(guide) })),
    recordEvent: (name, properties) => {
      void client.call(GATEWAY_METHOD.ANALYTICS_RECORD, {
        // The host reads the event against the allowlist again before it is queued.
        event: { name, at: Date.now(), properties: carried(properties) },
      });
    },
    appendHistory: async (entries, reporter) => {
      const answer = record(
        await client.call(GATEWAY_METHOD.CONVERSATION_APPEND, {
          entries: carried(entries),
          ...wireReporter(reporter),
        }),
      );
      return answer?.accepted === true;
    },
    onboardingState: async () => {
      const answer = record(await client.call(GATEWAY_METHOD.ONBOARDING_STATE));
      return answer
        ? { calendarOnboardingOwed: answer.calendarOnboardingOwed === true }
        : undefined;
    },
    skipCalendarOnboarding: () => fire(client.call(GATEWAY_METHOD.ONBOARDING_SKIP_CALENDAR)),
    completeCalendarOnboarding: () =>
      fire(client.call(GATEWAY_METHOD.ONBOARDING_COMPLETE_CALENDAR)),
    onSettingsChanged: (listener) =>
      on(
        GATEWAY_EVENT.SETTINGS_CHANGED,
        (payload): HostSettingsChange | undefined => {
          if (!isRecord(payload) || !isRecord(payload.settings)) return undefined;
          const settings = answered<AppSettings>(payload.settings);
          if (!settings) return undefined;
          return {
            settings,
            ...(isWireString(payload.reporter) ? { reporter: payload.reporter } : undefined),
          };
        },
        listener,
      ),
    onAccountChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_CHANGED,
        (payload) => (isRecord(payload) ? answered<AccountSnapshot>(payload) : undefined),
        listener,
      ),
    onSessionsChanged: (listener) =>
      on(
        GATEWAY_EVENT.SESSIONS_CHANGED,
        (payload) =>
          isRecord(payload)
            ? {
                sessions: answeredList<Session>(payload.sessions),
                settled: payload.settled === true,
              }
            : undefined,
        listener,
      ),
    onWorkspaceProjectsChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_PROJECTS_CHANGED,
        (payload) =>
          isRecord(payload) ? answeredList<ObservedWorkspaceProject>(payload.projects) : undefined,
        listener,
      ),
    onCalendarsChanged: (listener) =>
      on(
        GATEWAY_EVENT.CALENDARS_CHANGED,
        (payload) =>
          isRecord(payload) ? answeredList<ObservedAccountCalendars>(payload.calendars) : undefined,
        listener,
      ),
    onAnnouncementsHeldChanged: (listener) =>
      on(
        GATEWAY_EVENT.ANNOUNCEMENTS_HELD_CHANGED,
        (payload) => (isRecord(payload) && isWireBoolean(payload.held) ? payload.held : undefined),
        listener,
      ),
    onSupersetSignInChanged: (listener) =>
      on(
        GATEWAY_EVENT.SUPERSET_SIGN_IN_CHANGED,
        (payload) => (isRecord(payload) ? answered<SupersetSignInSnapshot>(payload) : undefined),
        listener,
      ),
    onCalendarOnboardingChanged: (listener) =>
      on(
        GATEWAY_EVENT.CALENDAR_ONBOARDING_CHANGED,
        (payload) => (isRecord(payload) && isWireBoolean(payload.owed) ? payload.owed : undefined),
        listener,
      ),
    onSpeechOffered: (listener) =>
      on(
        GATEWAY_EVENT.SPEECH_OFFERED,
        (payload) => (isSpeechOffer(payload) ? payload : undefined),
        listener,
      ),
    onSpeechWithdrawn: (listener) =>
      on(
        GATEWAY_EVENT.SPEECH_WITHDRAWN,
        (payload) => (isRecord(payload) && isWireString(payload.id) ? payload.id : undefined),
        listener,
      ),
    onSessionReplayChanged: (listener) =>
      on(
        GATEWAY_EVENT.SESSION_REPLAY_CHANGED,
        (payload): HostSessionReplay | undefined =>
          isRecord(payload) && isWireBoolean(payload.permitted)
            ? {
                permitted: payload.permitted,
                ...(isWireString(payload.accountId) ? { accountId: payload.accountId } : undefined),
              }
            : undefined,
        listener,
      ),
  };
}
