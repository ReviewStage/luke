import { type BrainRequestSnapshot, isBrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import type { AppleCalendarAccess } from "@sidecar/calendar/vocabulary";
import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import { ACCOUNT_PROVIDER } from "@sidecar/credentials/snapshot";
import { CREDENTIAL_PROVIDERS, isCredentialProviderId } from "@sidecar/credentials/vocabulary";
import {
  FEEDBACK_KIND,
  type FeedbackResult,
  type FeedbackSubmission,
  feedbackSubmission,
} from "@sidecar/feedback";
import {
  type ConversationRateMessageResult,
  conversationRateMessageParamsSchema,
  conversationRateMessageResultSchema,
  LIVE_SDP_MAX_CHARACTERS,
  type VoiceCreateLiveSessionResult,
  voiceCreateLiveSessionParamsSchema,
  voiceCreateLiveSessionResultSchema,
  voiceReportLiveActivityParamsSchema,
  voiceReportLiveTransportParamsSchema,
} from "@sidecar/gateway";
import { INTRODUCTION_SEED_BOUNDS, type LiveDiagnostics } from "@sidecar/live";
import {
  isSessionApplicationId,
  isSessionWriteResult,
  maximumSessionMessageLength,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionWriteResult,
} from "@sidecar/session";
import {
  APP_SETTING_SCHEMA,
  type AppSettingField,
  type AppSettingValue,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingEntryKey,
  type KeyedAppSettingField,
  SETTINGS_RESET_SCOPE,
  type SettingEntryValue,
  settingEntryGuard,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import type { WindowMode } from "@sidecar/surface";
import {
  isRecord,
  isWireString,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  s,
  TEXT_ENDS,
  type UnparsedWireValue,
} from "@sidecar/wire";
import type { MicrophoneRoute, MicrophoneStatus } from "./audio";
import { isSessionIdentity, type SessionOpenResult } from "./session";
import type { UpdateSnapshot } from "./update";
import { isVoiceCommandOutcome, VOICE_COMMAND, type VoiceCommandOutcome } from "./voice-view";
import { isWireValue, type WireGuard, type WireGuardValue, wireResult } from "./wire-guard";

/**
 * Every effect a window may ask this build's main process for, named once.
 * There is no second way in: a press, a spoken setting change, and a row's
 * own control all mint one of these kinds and hand it to `app:act`, whose
 * router parses the kind's payload, runs that kind's trust checks, and
 * dispatches. Adding an effect is adding an entry here, its payload schema
 * below, its answer's guard beside it, and its one row in the router — a
 * command with no kind reaches nothing.
 *
 * A kind is what the window asks for, never what the main process does with
 * it: some are carried to the host over the operator client and some are the
 * desktop's own, and which is which is the router's business rather than the
 * vocabulary's.
 */
export const ACT_KIND = {
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
  SETTING_UPDATE: "setting.update",
  SETTING_UPDATE_ENTRY: "setting.updateEntry",
  SETTINGS_RESET: "settings.reset",
  CREDENTIAL_SET_API_KEY: "credential.setApiKey",
  CREDENTIAL_OPEN_API_KEYS: "credential.openApiKeys",
  CALENDAR_CONNECT_GOOGLE: "calendar.connectGoogle",
  CALENDAR_CANCEL_GOOGLE_SIGN_IN: "calendar.cancelGoogleSignIn",
  CALENDAR_REOPEN_GOOGLE_SIGN_IN: "calendar.reopenGoogleSignIn",
  CALENDAR_REMOVE_ACCOUNT: "calendar.removeAccount",
  CALENDAR_CONNECT_APPLE: "calendar.connectApple",
  CALENDAR_DISCONNECT_APPLE: "calendar.disconnectApple",
  CALENDAR_APPLE_ACCESS_STATUS: "calendar.appleAccessStatus",
  CALENDAR_CANCEL_APPLE_CONNECT: "calendar.cancelAppleConnect",
  CALENDAR_OPEN_SETTINGS: "calendar.openSettings",
  CALENDAR_REFRESH: "calendar.refresh",
  CALENDAR_SET_SELECTED: "calendar.setSelected",
  TRACKER_CONNECT: "tracker.connect",
  TRACKER_CANCEL_SIGN_IN: "tracker.cancelSignIn",
  TRACKER_REOPEN_SIGN_IN: "tracker.reopenSignIn",
  TRACKER_DISCONNECT: "tracker.disconnect",
  UPDATE_CHECK: "update.check",
  UPDATE_INSTALL: "update.install",
  UPDATE_OPEN_RELEASE: "update.openRelease",
  UPDATE_OPEN_CHANGELOG: "update.openChangelog",
  SESSION_OPEN: "session.open",
  SESSION_OPEN_APPLICATION: "session.openApplication",
  SESSION_OPEN_CHANGE: "session.openChange",
  /**
   * The two writes a session's own row mints — the follow-up typed into its
   * composer and the press of a control its provider advertised — carried to
   * the host, where `admit()` decides them against the roster it reads for
   * itself before any provider sees them.
   */
  SESSION_SEND_MESSAGE: "session.sendMessage",
  SESSION_EXECUTE_CONTROL: "session.executeControl",
  BRAIN_CANCEL_ASK: "brain.cancelAsk",
  /**
   * The developer's thumb on one of Luke's messages in the Conversation tab,
   * carried to the host, which writes it to the service as a rating event on
   * that message and shows the verdict back through the view it publishes.
   * The one write the tab makes about a message, and the panel's alone.
   */
  CONVERSATION_RATE_MESSAGE: "conversation.rateMessage",
  VOICE_COMMAND: "voice.command",
  /**
   * The voice window as a GPT Live peer: its SDP offer handed to the host,
   * which creates the one session and answers the SDP; the hang-up it asks
   * the host to decide; and the two reports the host reads its transport and
   * its idle from. No credential travels in any of them.
   */
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  MICROPHONE_REQUEST: "microphone.request",
  /**
   * Where the developer's voice would be captured from, read afresh: the act
   * probes the native watcher rather than answering the document, because the
   * route decides which device a press opens and macOS moves it between
   * presses.
   */
  MICROPHONE_ROUTE: "microphone.route",
  MICROPHONE_OPEN_SETTINGS: "microphone.openSettings",
  WINDOW_SET_EXPANDED: "window.setExpanded",
  WINDOW_FOCUS_PANEL: "window.focusPanel",
  WINDOW_COPY_TEXT: "window.copyText",
  WINDOW_QUIT: "window.quit",
  FEEDBACK_SUMMON: "feedback.summon",
  FEEDBACK_SEND: "feedback.send",
  ONBOARDING_SKIP_CALENDAR: "onboarding.skipCalendar",
  ONBOARDING_COMPLETE_CALENDAR: "onboarding.completeCalendar",
  /**
   * The introduction's own GPT Live session: the takeover's SDP offer, with
   * the titles field the service admits left empty, handed to the accountless voice service,
   * which answers the SDP and holds the session's trusted side; and the
   * hang-up, which closes the connection the service reads as the end. Both
   * are answered only while the takeover holds the panel, and no credential
   * travels in either.
   */
  INTRODUCTION_CREATE_SESSION: "introduction.createSession",
  INTRODUCTION_END_SESSION: "introduction.endSession",
  INTRODUCTION_COMPLETE: "introduction.complete",
  INTRODUCTION_ABANDON: "introduction.abandon",
} as const;

export type ActKind = (typeof ACT_KIND)[keyof typeof ACT_KIND];

/**
 * One act payload's parser. The `s` combinators from `@sidecar/wire` satisfy
 * it, and every structural payload below is declared as one. It is the
 * reading alone rather than the whole `Schema` because no model is ever
 * offered an act: a JSON Schema node written here would be a second statement
 * of a rule the parser already holds, free to drift from it.
 */
export interface ActSchema<Value> {
  read(value: UnparsedWireValue): SchemaRead<Value>;
}

/** One kind's whole declaration: what its payload takes, what its answer is, and what its refusal says. */
export interface ActDeclaration<Payload, Result> {
  readonly payload: ActSchema<Payload>;
  readonly result: WireGuard<Result>;
  readonly refusal: string;
}

function malformed(path: SchemaPath = []): SchemaRead<never> {
  return { ok: false, refusal: SCHEMA_REFUSAL.MALFORMED, path };
}

/**
 * A kind that carries nothing. The schema admits absence alone, so a payload
 * sent to a kind that takes none is refused at the boundary rather than
 * silently dropped.
 */
const noPayload: ActSchema<undefined> = {
  read: (value) => (value === undefined ? { ok: true, value: undefined } : malformed()),
};

/**
 * A whole payload whose shape its own domain already parses, where restating
 * it as a field table here would be a second statement of the same rule free
 * to drift from the parser that admits the value.
 */
function guarded<Value>(admits: (value: UnparsedWireValue) => boolean): ActSchema<Value> {
  return {
    read: (value) =>
      // SAFETY: the domain parser above is what this payload's type is defined by.
      admits(value) ? { ok: true, value: value as Value } : malformed(),
  };
}

/**
 * A payload named field by field, each field admitted by the parser its own
 * domain owns. What `s.record` is for a payload whose fields are texts and
 * counts, for the payloads whose fields are whole domain values instead.
 */
function fields<Value>(guards: {
  readonly [key: string]: (value: UnparsedWireValue) => boolean;
}): ActSchema<Value> {
  const named = Object.keys(guards);
  return guarded<Value>((value) => {
    if (!isRecord(value)) return false;
    for (const key of Object.keys(value)) if (!named.includes(key)) return false;
    return named.every((key) => guards[key]?.(value[key]) === true);
  });
}

/**
 * An identifier that has to match the one it names elsewhere — a session, a
 * run, a delivery, an account, a calendar — so its ends are admitted as
 * written rather than trimmed into a value the roster would not hold.
 */
const exactId = s.text({ max: 512, ends: TEXT_ENDS.KEEP });

/** Every credential provider this build registered, which is what its record is keyed by. */
const CREDENTIAL_PROVIDER_IDS = Object.keys(CREDENTIAL_PROVIDERS).filter(isCredentialProviderId);

/** The three opens that name one session and nothing else. */
const oneSession = fields<{ identity: SessionIdentity }>({ identity: isSessionIdentity });

/**
 * The words a row's composer sends, admitted at their ends: admission trims
 * and bounds them again in the host, so this only refuses what no bound could
 * admit — nothing at all, or more than the message bound allows.
 */
const isComposedMessage = (value: UnparsedWireValue): boolean =>
  isWireString(value) && value.trim().length > 0 && value.length <= maximumSessionMessageLength;

/** A control's id as the roster advertised it, admitted as written so it matches the advertisement. */
const isControlId = (value: UnparsedWireValue): boolean => exactId.read(value).ok;

/** A setting and a value already parsed for it, which is the pair its field types. */
export type SettingUpdatePayload = {
  [Field in Exclude<AppSettingField, KeyedAppSettingField>]: {
    field: Field;
    value: AppSettingValue<Field>;
  };
}[Exclude<AppSettingField, KeyedAppSettingField>];

/**
 * The one payload whose value is parsed by the field beside it. The parsed
 * value is what the payload carries, so the router's row receives the value
 * its field's own schema admitted rather than the one that arrived — there is
 * no second guard to disagree with this one.
 */
const settingUpdatePayload: ActSchema<SettingUpdatePayload> = {
  read: (raw) => {
    if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "field" && key !== "value")) {
      return malformed();
    }
    const value = raw;
    const field = value.field;
    if (!isWireString(field) || !isAppSettingField(field) || isKeyedAppSettingField(field)) {
      return malformed(["field"]);
    }
    const parsed = APP_SETTING_SCHEMA[field].guard(value.value);
    if (!parsed.valid) return malformed(["value"]);
    // SAFETY: the field's own schema guard admitted this value for this field.
    return { ok: true, value: { field, value: parsed.value } as SettingUpdatePayload };
  },
};

export type SettingEntryPayload = {
  [Field in KeyedAppSettingField]: {
    field: Field;
    key: string;
    value?: SettingEntryValue<Field>;
  };
}[KeyedAppSettingField];

const settingEntryPayload: ActSchema<SettingEntryPayload> = {
  read: (raw) => {
    const named = ["field", "key", "value"];
    if (!isRecord(raw) || Object.keys(raw).some((key) => !named.includes(key))) {
      return malformed();
    }
    const value = raw;
    const field = value.field;
    if (!isWireString(field) || !isKeyedAppSettingField(field)) return malformed(["field"]);
    const key = value.key;
    if (!isWireString(key) || !isSettingEntryKey(field, key)) return malformed(["key"]);
    if (!settingEntryGuard(field, key, value.value).valid) return malformed(["value"]);
    // SAFETY: the entry guard above admitted this value for this field and key.
    return { ok: true, value: { field, key, value: value.value } as SettingEntryPayload };
  },
};

const answersNothing = wireResult<void>();
const answersSettings = wireResult<SettingsUpdateResult>();
const answersAccount = wireResult<AccountSnapshot>();
const answersSessionOpen = wireResult<SessionOpenResult>();
const answersSessionWrite = wireResult<SessionWriteResult>(isSessionWriteResult);

/**
 * A press: a kind that carries nothing and answers nothing, which is what
 * most of them are. The sentence is the only thing such a row has to say.
 */
const press = (refusal: string): ActDeclaration<undefined, void> => ({
  payload: noPayload,
  result: answersNothing,
  refusal,
});

/** A press whose answer is the settings the host now holds, for the row to redraw from. */
const settingsPress = (refusal: string): ActDeclaration<undefined, SettingsUpdateResult> => ({
  payload: noPayload,
  result: answersSettings,
  refusal,
});

/**
 * Every act, one row per kind, and everything this build says about a kind in
 * that one row: the parser its payload has to pass, the guard its answer has
 * to pass, and the sentence its refusal carries. One row rather than three
 * tables, so a kind is read and added in one place and a kind missing any of
 * the three does not build.
 *
 * The payload's parser is the whole of what the boundary admits: it runs in
 * the main process before the act is dispatched and again in the router, so a
 * caller inside the main process cannot reach a row with a payload the window
 * could not have sent. The answer's guard is checked where the answer is
 * read — in the router before the outcome is minted, and in the window that
 * asked before its caller sees a value — and a kind whose answer has a domain
 * reader of its own names it, while the rest carry the structured-clone shape
 * alone, which is all a `void` or a snapshot the host composed needs. The
 * refusal is fixed by the build, so what reaches the window is something its
 * row can draw rather than whatever message an exception happened to carry.
 */
export const ACT = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: {
    payload: s.record({
      provider: s.enumOf(Object.values(ACCOUNT_PROVIDER)),
    }),
    result: answersAccount,
    refusal: "Could not start signing in on this system.",
  },
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: press("Could not cancel that sign-in on this system."),
  [ACT_KIND.ACCOUNT_SIGN_OUT]: {
    payload: noPayload,
    result: answersAccount,
    refusal: "Could not sign out on this system.",
  },
  [ACT_KIND.ACCOUNT_DELETE]: {
    payload: noPayload,
    result: answersAccount,
    refusal: "Could not delete that account on this system.",
  },
  [ACT_KIND.SETTING_UPDATE]: {
    payload: settingUpdatePayload,
    result: answersSettings,
    refusal: "Could not save that setting on this system.",
  },
  [ACT_KIND.SETTING_UPDATE_ENTRY]: {
    payload: settingEntryPayload,
    result: answersSettings,
    refusal: "Could not save that setting on this system.",
  },
  [ACT_KIND.SETTINGS_RESET]: {
    payload: s.record({
      scope: s.enumOf(Object.values(SETTINGS_RESET_SCOPE)),
    }),
    result: answersSettings,
    refusal: "Could not reset those settings on this system.",
  },
  [ACT_KIND.CREDENTIAL_SET_API_KEY]: {
    payload: s.record({
      providerId: s.enumOf(CREDENTIAL_PROVIDER_IDS),
      apiKey: s.text({ max: 4096, ends: TEXT_ENDS.KEEP, allowEmpty: true }).optional(),
    }),
    result: answersSettings,
    refusal: "Could not save that API key on this system.",
  },
  [ACT_KIND.CREDENTIAL_OPEN_API_KEYS]: {
    payload: s.record({
      providerId: s.enumOf(CREDENTIAL_PROVIDER_IDS),
    }),
    result: answersNothing,
    refusal: "Could not open that provider's keys page.",
  },
  [ACT_KIND.CALENDAR_CONNECT_GOOGLE]: settingsPress(
    "Could not connect Google Calendar on this system.",
  ),
  [ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: press("Could not cancel that sign-in on this system."),
  [ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: press("Could not reopen that sign-in on this system."),
  [ACT_KIND.CALENDAR_REMOVE_ACCOUNT]: {
    payload: s.record({ accountId: exactId }),
    result: answersSettings,
    refusal: "Could not disconnect that account on this system.",
  },
  [ACT_KIND.CALENDAR_CONNECT_APPLE]: settingsPress(
    "Could not connect Apple Calendar on this system.",
  ),
  [ACT_KIND.CALENDAR_DISCONNECT_APPLE]: settingsPress(
    "Could not disconnect Apple Calendar on this system.",
  ),
  [ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS]: {
    payload: noPayload,
    result: wireResult<AppleCalendarAccess>(),
    refusal: "Could not read Calendar access on this system.",
  },
  [ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT]: press(
    "Could not cancel that connection on this system.",
  ),
  [ACT_KIND.CALENDAR_OPEN_SETTINGS]: press("Could not open the Calendar privacy settings."),
  [ACT_KIND.CALENDAR_REFRESH]: press("Could not read the calendars on this system."),
  [ACT_KIND.CALENDAR_SET_SELECTED]: {
    payload: s.record({
      accountId: exactId,
      calendarId: exactId,
      selected: s.boolean(),
    }),
    result: answersSettings,
    refusal: "Could not save that calendar choice on this system.",
  },
  [ACT_KIND.TRACKER_CONNECT]: settingsPress("Could not connect Linear on this system."),
  [ACT_KIND.TRACKER_CANCEL_SIGN_IN]: press("Could not cancel that sign-in on this system."),
  [ACT_KIND.TRACKER_REOPEN_SIGN_IN]: press("Could not reopen that sign-in on this system."),
  [ACT_KIND.TRACKER_DISCONNECT]: settingsPress("Could not disconnect Linear on this system."),
  [ACT_KIND.UPDATE_CHECK]: {
    payload: noPayload,
    result: wireResult<UpdateSnapshot>(),
    refusal: "Could not check for updates on this system.",
  },
  [ACT_KIND.UPDATE_INSTALL]: press("Could not install that update on this system."),
  [ACT_KIND.UPDATE_OPEN_RELEASE]: press("Could not open the releases page."),
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: press("Could not open the changelog."),
  [ACT_KIND.SESSION_OPEN]: {
    payload: oneSession,
    result: answersSessionOpen,
    refusal: "Could not open that session on this system.",
  },
  [ACT_KIND.SESSION_OPEN_APPLICATION]: {
    payload: fields<{ identity: SessionIdentity; applicationId: SessionApplicationId }>({
      identity: isSessionIdentity,
      applicationId: (value) => isWireString(value) && isSessionApplicationId(value),
    }),
    result: answersSessionOpen,
    refusal: "Could not open that session in that app on this system.",
  },
  [ACT_KIND.SESSION_OPEN_CHANGE]: {
    payload: oneSession,
    result: answersSessionOpen,
    refusal: "Could not open that pull request on this system.",
  },
  [ACT_KIND.SESSION_SEND_MESSAGE]: {
    payload: fields<{ identity: SessionIdentity; text: string }>({
      identity: isSessionIdentity,
      text: isComposedMessage,
    }),
    result: answersSessionWrite,
    refusal: "Could not send that message on this system.",
  },
  [ACT_KIND.SESSION_EXECUTE_CONTROL]: {
    payload: fields<{ identity: SessionIdentity; controlId: string }>({
      identity: isSessionIdentity,
      controlId: isControlId,
    }),
    result: answersSessionWrite,
    refusal: "Could not run that control on this system.",
  },
  [ACT_KIND.BRAIN_CANCEL_ASK]: {
    payload: s.record({ runId: exactId }),
    result: wireResult<BrainRequestSnapshot | undefined>(
      (value) => value === undefined || isBrainRequestSnapshot(value),
    ),
    refusal: "Could not reach Luke's runtime to cancel that.",
  },
  [ACT_KIND.CONVERSATION_RATE_MESSAGE]: {
    payload: conversationRateMessageParamsSchema,
    result: wireResult<ConversationRateMessageResult>(
      (value) => conversationRateMessageResultSchema.read(value).ok,
    ),
    refusal: "Could not record that rating on this system.",
  },
  [ACT_KIND.VOICE_COMMAND]: {
    payload: s.record({
      command: s.enumOf(Object.values(VOICE_COMMAND)),
    }),
    result: wireResult<VoiceCommandOutcome | undefined>(
      (value) => value === undefined || isVoiceCommandOutcome(value),
    ),
    refusal: "Could not carry that command on this system.",
  },
  [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: {
    payload: voiceCreateLiveSessionParamsSchema,
    result: wireResult<VoiceCreateLiveSessionResult | undefined>(
      (value) => value === undefined || voiceCreateLiveSessionResultSchema.read(value).ok,
    ),
    refusal: "Could not open a voice session on this system.",
  },
  [ACT_KIND.VOICE_END_LIVE_SESSION]: press("Could not end the voice session on this system."),
  [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: {
    payload: voiceReportLiveTransportParamsSchema,
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not report the voice transport on this system.",
  },
  [ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: {
    payload: voiceReportLiveActivityParamsSchema,
    result: wireResult<undefined>((value) => value === undefined),
    refusal: "Could not report the voice activity on this system.",
  },
  [ACT_KIND.VOICE_STOP_SPEAKING]: {
    payload: noPayload,
    result: wireResult<boolean>((value) => s.boolean().read(value).ok),
    refusal: "Could not tell Luke to stop speaking on this system.",
  },
  [ACT_KIND.VOICE_DIAGNOSTICS]: {
    payload: noPayload,
    result: wireResult<LiveDiagnostics | undefined>(),
    refusal: "Could not read the voice diagnostics on this system.",
  },
  [ACT_KIND.MICROPHONE_REQUEST]: {
    payload: noPayload,
    result: wireResult<MicrophoneStatus>(),
    refusal: "Could not ask for the microphone on this system.",
  },
  [ACT_KIND.MICROPHONE_ROUTE]: {
    payload: noPayload,
    result: wireResult<MicrophoneRoute | undefined>(),
    refusal: "Could not read the microphone route on this system.",
  },
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: press("Could not open the microphone privacy settings."),
  [ACT_KIND.WINDOW_SET_EXPANDED]: {
    payload: s.record({
      expanded: s.boolean(),
      focus: s.boolean().optional(),
    }),
    result: wireResult<WindowMode>(),
    refusal: "Could not resize the panel on this system.",
  },
  [ACT_KIND.WINDOW_FOCUS_PANEL]: press("Could not focus the panel on this system."),
  [ACT_KIND.WINDOW_COPY_TEXT]: {
    payload: s.record({ words: s.text({ max: 100_000, ends: TEXT_ENDS.KEEP }) }),
    result: answersNothing,
    refusal: "Could not copy that to the clipboard on this system.",
  },
  [ACT_KIND.WINDOW_QUIT]: press("Could not quit on this system."),
  [ACT_KIND.FEEDBACK_SUMMON]: {
    payload: s.record({ kind: s.enumOf(Object.values(FEEDBACK_KIND)) }),
    result: answersNothing,
    refusal: "Could not open the composer on this system.",
  },
  [ACT_KIND.FEEDBACK_SEND]: {
    payload: fields<{ submission: FeedbackSubmission }>({
      submission: (value) => feedbackSubmission(value) !== undefined,
    }),
    result: wireResult<FeedbackResult>(),
    refusal: "Could not send that on this system.",
  },
  [ACT_KIND.ONBOARDING_SKIP_CALENDAR]: press("Could not skip that step on this system."),
  [ACT_KIND.ONBOARDING_COMPLETE_CALENDAR]: press("Could not settle that step on this system."),
  [ACT_KIND.INTRODUCTION_CREATE_SESSION]: {
    payload: s.record({
      sdp: s.text({ max: LIVE_SDP_MAX_CHARACTERS, ends: TEXT_ENDS.KEEP }),
      titles: s.array(s.text({ max: INTRODUCTION_SEED_BOUNDS.TITLE_CHARS, oneLine: true }), {
        max: INTRODUCTION_SEED_BOUNDS.TITLES,
      }),
    }),
    result: wireResult<VoiceCreateLiveSessionResult | undefined>(
      (value) => value === undefined || voiceCreateLiveSessionResultSchema.read(value).ok,
    ),
    refusal: "Could not open the introduction's voice session on this system.",
  },
  [ACT_KIND.INTRODUCTION_END_SESSION]: press("Could not end the introduction's voice session."),
  [ACT_KIND.INTRODUCTION_COMPLETE]: {
    payload: s.record({ given: s.boolean() }),
    result: answersNothing,
    refusal: "Could not record the introduction on this system.",
  },
  [ACT_KIND.INTRODUCTION_ABANDON]: {
    payload: s.record({ reason: s.text({ max: 1024, oneLine: true }) }),
    result: answersNothing,
    refusal: "Could not stand the introduction down on this system.",
  },
} as const satisfies Record<ActKind, ActDeclaration<unknown, unknown>>;

type SchemaValue<Declaration> = Declaration extends ActSchema<infer Value> ? Value : never;

/** What one kind's payload is, read from that kind's own schema. */
export type ActPayload<Kind extends ActKind> = SchemaValue<(typeof ACT)[Kind]["payload"]>;

/** What one kind answers with, read from that kind's own guard. */
export type ActResultFor<Kind extends ActKind> = WireGuardValue<(typeof ACT)[Kind]["result"]>;

/**
 * One command as it crosses: the kind, and the payload its kind takes. A kind
 * that carries nothing has no `payload` key at all, so a payload sent to one
 * is a shape this type cannot describe and the boundary refuses.
 */
export type Act = {
  [Kind in ActKind]: ActPayload<Kind> extends undefined
    ? { readonly kind: Kind }
    : { readonly kind: Kind; readonly payload: ActPayload<Kind> };
}[ActKind];

/** What became of one act. Every answer is a value; nothing here is a throw. */
export const ACT_OUTCOME_STATUS = {
  DONE: "done",
  /** The act was admitted and refused, with a sentence its row can draw. */
  REFUSED: "refused",
  /** No kind by that name, which a build in step with its windows never sees. */
  UNKNOWN_ACT: "unknown-act",
} as const;

export type ActOutcome<Kind extends ActKind = ActKind> =
  | { readonly status: typeof ACT_OUTCOME_STATUS.DONE; readonly value: ActResultFor<Kind> }
  | { readonly status: typeof ACT_OUTCOME_STATUS.REFUSED; readonly reason: string }
  | { readonly status: typeof ACT_OUTCOME_STATUS.UNKNOWN_ACT };

const ACT_KINDS: readonly string[] = Object.values(ACT_KIND);

function isActKind(value: UnparsedWireValue): value is ActKind {
  return isWireString(value) && ACT_KINDS.includes(value);
}

/**
 * One act as its kind's own schema admits it, or nothing. The whole envelope
 * is read: an unnamed kind, a key beside `kind` and `payload`, a payload a
 * kind takes none of, and a payload its schema refuses are each refused here.
 */
export function parsedAct(value: UnparsedWireValue): Act | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) if (key !== "kind" && key !== "payload") return undefined;
  const kind = value.kind;
  if (!isActKind(kind)) return undefined;
  const read = ACT[kind].payload.read(value.payload);
  if (!read.ok) return undefined;
  // SAFETY: the kind's own schema admitted this payload, which is the pairing Act declares.
  return (read.value === undefined ? { kind } : { kind, payload: read.value }) as Act;
}

/** Whether an answer is one of the three outcomes, whatever its kind's own value is. */
export function isActOutcome(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (value.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) return Object.keys(value).length === 1;
  if (value.status === ACT_OUTCOME_STATUS.REFUSED) {
    return Object.keys(value).length === 2 && isWireString(value.reason);
  }
  if (value.status !== ACT_OUTCOME_STATUS.DONE) return false;
  for (const key of Object.keys(value)) if (key !== "status" && key !== "value") return false;
  return isWireValue(value.value);
}
