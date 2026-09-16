import type { ProductEventName, ProductEventPropertiesFor } from "@sidecar/analytics";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import type { AppleCalendarAccess } from "@sidecar/calendar/vocabulary";
import type { CredentialProviderId } from "@sidecar/credentials";
import type { AccountProvider, AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import type { GatewayCallResult, GatewayClient } from "@sidecar/gateway";
import {
  CONVERSATION_RATE_STATUS,
  type ConversationRateMessageResult,
  carried,
  conversationRateMessageResultSchema,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  gatewayEventReader,
  type LiveTransportState,
  type NotebookReadResult,
  notebookReadResultSchema,
  type VoiceCreateLiveSessionResult,
  type VoiceLiveSessionChanged,
  voiceCreateLiveSessionResultSchema,
  voiceLiveSessionChangedSchema,
  voiceStopSpeakingResultSchema,
} from "@sidecar/gateway";
import type { LiveDiagnostics } from "@sidecar/live";
import {
  type ChildTranscriptSnapshot,
  type ConversationViewSnapshot,
  isSessionWriteResult,
  type ObservedWorkspaceProject,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionWriteResult,
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
  ACTION_RESULT_STATUS,
  type ActionResult,
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  type RatingWord,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Result } from "effect";
import {
  type ChildrenSnapshot,
  childrenSnapshotSchema,
  childTranscriptSnapshotSchema,
} from "#shared/messages/children";

/**
 * The desktop's client over the host's own vocabulary: the settings, account,
 * integration, session, voice, and client-fact methods the runtime host
 * answers, and the events it pushes. Every method answers an effect: it
 * composes one request and reads its answer, and nothing here runs it — the
 * act row that asked yields it, and the router runs it once on the launch's
 * own runtime. A host that cannot be reached answers the typed disconnected
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
  conversationView: ConversationViewSnapshot;
  children: ChildrenSnapshot;
  /** The one child's transcript the host holds open, absent while none is. */
  childTranscript?: ChildTranscriptSnapshot;
  workspaceProjects: readonly ObservedWorkspaceProject[];
  calendars: readonly ObservedAccountCalendars[];
  calendarOnboardingOwed: boolean;
  /** Whether the spoken introduction is owed to the signed-in developer, as the host's onboarding record has it. */
  introductionOwed: boolean;
  /** Whether the Conductor key step of onboarding stands, ahead of the calendar's and of any row. */
  conductorKeyOnboardingOwed: boolean;
  sessionReplay: { permitted: boolean; accountId?: string };
  voiceAvailable: boolean;
  agentTraceEnabled: boolean;
}

interface HostSettingsChange {
  settings: AppSettings;
  /** The opaque reporter whose write produced the change, so the relay can skip echoing it. */
  reporter?: string;
}

interface HostSessionReplay {
  permitted: boolean;
  accountId?: string;
}

/** The open child's transcript as the host last told it; no transcript says none is open any more. */
interface HostChildTranscript {
  transcript: ChildTranscriptSnapshot | undefined;
}

export interface HostOperator {
  bootstrap(): Effect.Effect<HostBootstrap | undefined>;
  settingsSnapshot(): Effect.Effect<AppSettings | undefined>;
  updateSetting<Field extends Exclude<AppSettingField, KeyedAppSettingField>>(
    field: Field,
    value: AppSettingValue<Field>,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult, Error>;
  updateSettingEntry<Field extends KeyedAppSettingField>(
    field: Field,
    key: string,
    value: SettingEntryValue<Field> | undefined,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult, Error>;
  resetSettings(
    scope: SettingsResetScope,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult, Error>;
  setProviderApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult, Error>;
  accountSnapshot(): Effect.Effect<AccountSnapshot | undefined>;
  beginSignIn(provider: AccountProvider): Effect.Effect<AccountSnapshot, Error>;
  cancelSignIn(): Effect.Effect<void>;
  signOut(): Effect.Effect<AccountSnapshot, Error>;
  deleteAccount(): Effect.Effect<AccountSnapshot, Error>;
  connectGoogleCalendar(reporter: string): Effect.Effect<SettingsUpdateResult, Error>;
  cancelGoogleCalendarSignIn(): Effect.Effect<void>;
  reopenGoogleCalendarSignIn(): Effect.Effect<void>;
  removeCalendarAccount(
    accountId: string,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult, Error>;
  connectAppleCalendar(reporter: string): Effect.Effect<SettingsUpdateResult, Error>;
  disconnectAppleCalendar(reporter: string): Effect.Effect<SettingsUpdateResult, Error>;
  appleCalendarAccessStatus(): Effect.Effect<AppleCalendarAccess | undefined>;
  cancelAppleCalendarConnect(): Effect.Effect<void>;
  refreshCalendars(): Effect.Effect<void>;
  setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult, Error>;
  sessionRoster(): Effect.Effect<{ sessions: readonly Session[]; settled: boolean }>;
  openSession(identity: SessionIdentity): Effect.Effect<ActionResult>;
  openSessionApplication(
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Effect.Effect<ActionResult>;
  openSessionChange(identity: SessionIdentity): Effect.Effect<ActionResult>;
  /** The two writes a session's row asks for; the host admits each against the roster before any provider sees it. */
  sendSessionMessage(identity: SessionIdentity, text: string): Effect.Effect<SessionWriteResult>;
  executeSessionControl(
    identity: SessionIdentity,
    controlId: string,
  ): Effect.Effect<SessionWriteResult>;
  workspaceProjects(): Effect.Effect<readonly ObservedWorkspaceProject[]>;
  /** Why voice is or is not available, carrying no credential; a host that cannot be reached answers nothing. */
  liveDiagnostics(): Effect.Effect<LiveDiagnostics | undefined>;
  /** The peer's SDP offer, answered with the session the host created; a host that creates none answers nothing. */
  createLiveSession(sdp: string): Effect.Effect<VoiceCreateLiveSessionResult | undefined>;
  endLiveSession(): Effect.Effect<void>;
  reportLiveTransport(state: LiveTransportState): Effect.Effect<void>;
  /** The peer's own idle decision, from its local signals alone; the host decides the close. */
  reportLiveActivity(idle: boolean): Effect.Effect<void>;
  /** The stop key: the standing session is told to stop speaking; answers whether one stood to tell. */
  stopSpeaking(): Effect.Effect<boolean>;
  /** One tapped wire event for the host's development trace; the host drops it where no writer stands. */
  recordAgentTrace(trace: AgentWireTrace): Effect.Effect<void>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  /** The Conversation tab's Clear: the service's soft delete of the account's main conversation, answered as whether it landed. */
  clearConversation(): Effect.Effect<boolean>;
  /** A read of the Conversation now: a spoken line settled and the record is being written, so the poll should not wait its cadence out. */
  refreshConversation(): Effect.Effect<void>;
  /** One child's transcript held open on the host, read to its end and again as the children head moves; answers whether the host took it. */
  openChildTranscript(childId: string): Effect.Effect<boolean>;
  closeChildTranscript(): Effect.Effect<void>;
  /** Luke's notebook as the service holds it, for the Settings page that shows what he has saved; nothing when the host could not read it. */
  readNotebook(): Effect.Effect<NotebookReadResult | undefined>;
  /** The developer's thumb on one of Luke's messages, written by the host as a rating event on the service; a host that cannot be reached answers unavailable. */
  rateConversationMessage(
    messageId: string,
    rating: RatingWord,
  ): Effect.Effect<ConversationRateMessageResult>;
  onboardingState(): Effect.Effect<
    | {
        calendarOnboardingOwed: boolean;
        introductionOwed: boolean;
        conductorKeyOnboardingOwed: boolean;
      }
    | undefined
  >;
  skipCalendarOnboarding(): Effect.Effect<void>;
  completeCalendarOnboarding(): Effect.Effect<void>;
  /** The developer declined the Conductor key step; the Connections row stays the way to connect later. */
  skipConductorKeyOnboarding(): Effect.Effect<void>;
  /** The introduction given to its end: the host writes the completion, drops its hold, and asks for the beats that waited. */
  completeIntroduction(): Effect.Effect<void>;
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
  onConversationViewChanged(listener: (view: ConversationViewSnapshot) => void): () => void;
  onChildrenChanged(listener: (children: ChildrenSnapshot) => void): () => void;
  onChildTranscriptChanged(listener: (change: HostChildTranscript) => void): () => void;
  onCalendarOnboardingChanged(listener: (owed: boolean) => void): () => void;
  onIntroductionChanged(listener: (owed: boolean) => void): () => void;
  onConductorKeyOnboardingChanged(listener: (owed: boolean) => void): () => void;
  onVoiceLiveSessionChanged(listener: (change: VoiceLiveSessionChanged) => void): () => void;
  onSessionReplayChanged(listener: (replay: HostSessionReplay) => void): () => void;
}

interface HostOperatorOptions {
  client: GatewayClient;
  /** The settings a refused write is answered with when the host cannot say; the last snapshot the client saw. */
  lastSettings: () => AppSettings | undefined;
  report: (message: string) => void;
}

const HOST_UNREACHABLE_REFUSAL = "Luke's runtime is not reachable right now.";

/**
 * The host's answers are the same structured-clone payloads the windows
 * already receive over the bridge, carried through the protocol as JSON. The
 * readers below check the field the client itself decides on and hand the
 * rest on to the act, whose own answer guard is checked in the router and
 * again in the window that asked.
 */
function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is Luke's own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The protocol carries JSON; the domain type is restored at this one boundary.
  return value === undefined ? undefined : (value as unknown as Value);
}

function answeredList<Value>(value: UnparsedWireValue): readonly Value[] {
  return Array.isArray(value) ? value.flatMap((entry) => answered<Value>(entry) ?? []) : [];
}

export function createHostOperator(options: HostOperatorOptions): HostOperator {
  const { client } = options;

  const settingsResult = (
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<SettingsUpdateResult, Error> =>
    Effect.flatMap(result, (answer) => {
      const parsed = answered<SettingsUpdateResult>(record(answer));
      if (parsed?.settings !== undefined) return Effect.succeed(parsed);
      const settings = options.lastSettings();
      if (!settings) return Effect.fail(new Error(HOST_UNREACHABLE_REFUSAL));
      return Effect.succeed<SettingsUpdateResult>({
        status: ACTION_RESULT_STATUS.REJECTED,
        settings,
        reason: HOST_UNREACHABLE_REFUSAL,
      });
    });

  const accountResult = (
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<AccountSnapshot, Error> =>
    Effect.flatMap(result, (answer) => {
      const account = answered<AccountSnapshot>(record(answer)?.account);
      return account ? Effect.succeed(account) : Effect.fail(new Error(HOST_UNREACHABLE_REFUSAL));
    });

  const actionResult = (result: Effect.Effect<GatewayCallResult>): Effect.Effect<ActionResult> =>
    Effect.map(
      result,
      (answer) =>
        answered<ActionResult>(record(answer)) ?? {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: HOST_UNREACHABLE_REFUSAL,
        },
    );

  // A write's answer is read against its own shape rather than restored by
  // assertion: the host may answer unknown where a write's answer was lost,
  // and a row must draw that as neither a failure nor a success.
  const writeResult = (
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<SessionWriteResult> =>
    Effect.map(result, (answer) => {
      const written = record(answer);
      return isSessionWriteResult(written)
        ? written
        : { status: ACTION_RESULT_STATUS.REJECTED, reason: HOST_UNREACHABLE_REFUSAL };
    });

  const fire = (result: Effect.Effect<GatewayCallResult>): Effect.Effect<void> =>
    Effect.asVoid(result);

  const on = gatewayEventReader(client);

  const wireReporter = (reporter: string) => ({ reporter });

  /**
   * A setting's value as the method's own field, or no field for a cleared
   * one. The envelope is JSON, and its encoder refuses a record holding
   * `undefined` rather than dropping the key, so a clear carried as a value
   * would never leave this process.
   */
  const wireValue = <Value>(value: Value | undefined) =>
    value !== undefined ? { value: carried(value) } : undefined;

  return {
    bootstrap: () =>
      Effect.map(client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP), (answer) =>
        answered<HostBootstrap>(record(answer)),
      ),
    settingsSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT), (answer) =>
        answered<AppSettings>(record(answer)?.settings),
      ),
    updateSetting: (field, value, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.SETTINGS_UPDATE, {
          field,
          ...wireValue(value),
          ...wireReporter(reporter),
        }),
      ),
    updateSettingEntry: (field, key, value, reporter) =>
      settingsResult(
        client.call(GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY, {
          field,
          key,
          ...wireValue(value),
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
    accountSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT), (answer) =>
        answered<AccountSnapshot>(record(answer)?.account),
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
    appleCalendarAccessStatus: () =>
      Effect.map(client.call(GATEWAY_METHOD.CALENDAR_APPLE_ACCESS_STATUS), (answer) =>
        answered<AppleCalendarAccess>(record(answer)?.access),
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
    sessionRoster: () =>
      Effect.map(client.call(GATEWAY_METHOD.SESSION_ROSTER), (result) => {
        const answer = record(result);
        return {
          sessions: answeredList<Session>(answer?.sessions),
          settled: answer?.settled === true,
        };
      }),
    openSession: (identity) =>
      actionResult(client.call(GATEWAY_METHOD.SESSION_OPEN, { identity: { ...identity } })),
    openSessionApplication: (identity, applicationId) =>
      actionResult(
        client.call(GATEWAY_METHOD.SESSION_OPEN_APPLICATION, {
          identity: { ...identity },
          applicationId,
        }),
      ),
    openSessionChange: (identity) =>
      actionResult(client.call(GATEWAY_METHOD.SESSION_OPEN_CHANGE, { identity: { ...identity } })),
    sendSessionMessage: (identity, text) =>
      writeResult(
        client.call(GATEWAY_METHOD.SESSION_SEND_MESSAGE, { identity: { ...identity }, text }),
      ),
    executeSessionControl: (identity, controlId) =>
      writeResult(
        client.call(GATEWAY_METHOD.SESSION_EXECUTE_CONTROL, {
          identity: { ...identity },
          controlId,
        }),
      ),
    workspaceProjects: () =>
      Effect.map(client.call(GATEWAY_METHOD.WORKSPACE_PROJECTS), (answer) =>
        answeredList<ObservedWorkspaceProject>(record(answer)?.projects),
      ),
    liveDiagnostics: () =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_DIAGNOSTICS), (answer) =>
        answered<LiveDiagnostics>(record(answer)?.diagnostics),
      ),
    createLiveSession: (sdp) =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp }), (answer) =>
        answer.ok
          ? Result.getOrUndefined(
              readEither(voiceCreateLiveSessionResultSchema, { excess: EXCESS_KEYS.DROP })(
                answer.result,
              ),
            )
          : undefined,
      ),
    endLiveSession: () => fire(client.call(GATEWAY_METHOD.VOICE_END_LIVE_SESSION)),
    reportLiveTransport: (state) =>
      fire(client.call(GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT, { state })),
    reportLiveActivity: (idle) =>
      fire(client.call(GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY, { idle })),
    stopSpeaking: () =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_STOP_SPEAKING), (answer) =>
        answer.ok
          ? (Result.getOrUndefined(
              readEither(voiceStopSpeakingResultSchema, { excess: EXCESS_KEYS.DROP })(
                answer.result,
              ),
            )?.stopped ?? false)
          : false,
      ),
    recordAgentTrace: (trace) =>
      fire(client.call(GATEWAY_METHOD.VOICE_RECORD_TRACE, { trace: carried(trace) })),
    recordEvent: (name, properties) =>
      Effect.suspend(() =>
        fire(
          client.call(GATEWAY_METHOD.ANALYTICS_RECORD, {
            // The host reads the event against the allowlist again before it is queued.
            event: { name, at: Date.now(), properties: carried(properties) },
          }),
        ),
      ),
    clearConversation: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CONVERSATION_CLEAR),
        (answer) => record(answer)?.cleared === true,
      ),
    refreshConversation: () => fire(client.call(GATEWAY_METHOD.CONVERSATION_REFRESH)),
    openChildTranscript: (childId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT, { childId }),
        (answer) => record(answer)?.opened === true,
      ),
    closeChildTranscript: () =>
      fire(client.call(GATEWAY_METHOD.CONVERSATION_CLOSE_CHILD_TRANSCRIPT)),
    readNotebook: () =>
      Effect.map(client.call(GATEWAY_METHOD.NOTEBOOK_READ), (answer) =>
        answer.ok
          ? Result.getOrUndefined(
              readEither(notebookReadResultSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
            )
          : undefined,
      ),
    rateConversationMessage: (messageId, rating) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CONVERSATION_RATE_MESSAGE, { messageId, rating }),
        (answer) =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(conversationRateMessageResultSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { status: CONVERSATION_RATE_STATUS.UNAVAILABLE },
      ),
    onboardingState: () =>
      Effect.map(client.call(GATEWAY_METHOD.ONBOARDING_STATE), (result) => {
        const answer = record(result);
        return answer
          ? {
              calendarOnboardingOwed: answer.calendarOnboardingOwed === true,
              introductionOwed: answer.introductionOwed === true,
              conductorKeyOnboardingOwed: answer.conductorKeyOnboardingOwed === true,
            }
          : undefined;
      }),
    skipCalendarOnboarding: () => fire(client.call(GATEWAY_METHOD.ONBOARDING_SKIP_CALENDAR)),
    completeCalendarOnboarding: () =>
      fire(client.call(GATEWAY_METHOD.ONBOARDING_COMPLETE_CALENDAR)),
    completeIntroduction: () => fire(client.call(GATEWAY_METHOD.ONBOARDING_COMPLETE_INTRODUCTION)),
    skipConductorKeyOnboarding: () =>
      fire(client.call(GATEWAY_METHOD.ONBOARDING_SKIP_CONDUCTOR_KEY)),
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
    onConversationViewChanged: (listener) =>
      on(
        GATEWAY_EVENT.CONVERSATION_VIEW_CHANGED,
        (payload) =>
          isRecord(payload) && Array.isArray(payload.groups) && isWireBoolean(payload.settled)
            ? answered<ConversationViewSnapshot>(payload)
            : undefined,
        listener,
      ),
    onChildrenChanged: (listener) =>
      on(
        GATEWAY_EVENT.CHILDREN_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(childrenSnapshotSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    onChildTranscriptChanged: (listener) =>
      on(
        GATEWAY_EVENT.CHILD_TRANSCRIPT_CHANGED,
        (payload): HostChildTranscript | undefined => {
          if (!isRecord(payload)) return undefined;
          // An empty record is the host saying none is open; anything else must read as a transcript.
          if (Object.keys(payload).length === 0) return { transcript: undefined };
          const read = readEither(childTranscriptSnapshotSchema, { excess: EXCESS_KEYS.DROP })(
            payload,
          );
          // The groups are the host's own composed rows, restored to the view's type as the Conversation snapshot's are.
          return Result.isSuccess(read)
            ? { transcript: answered<ChildTranscriptSnapshot>(payload) }
            : undefined;
        },
        listener,
      ),
    onCalendarOnboardingChanged: (listener) =>
      on(
        GATEWAY_EVENT.CALENDAR_ONBOARDING_CHANGED,
        (payload) => (isRecord(payload) && isWireBoolean(payload.owed) ? payload.owed : undefined),
        listener,
      ),
    onIntroductionChanged: (listener) =>
      on(
        GATEWAY_EVENT.INTRODUCTION_CHANGED,
        (payload) => (isRecord(payload) && isWireBoolean(payload.owed) ? payload.owed : undefined),
        listener,
      ),
    onConductorKeyOnboardingChanged: (listener) =>
      on(
        GATEWAY_EVENT.CONDUCTOR_KEY_ONBOARDING_CHANGED,
        (payload) => (isRecord(payload) && isWireBoolean(payload.owed) ? payload.owed : undefined),
        listener,
      ),
    onVoiceLiveSessionChanged: (listener) =>
      on(
        GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(voiceLiveSessionChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
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
