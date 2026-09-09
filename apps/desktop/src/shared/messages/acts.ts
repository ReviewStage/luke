import {
  type BrainAskSubmission,
  type BrainAskSubmissionResult,
  type BrainAskWait,
  type BrainReplyClaimResult,
  type BrainRequestSnapshot,
  isBrainAskSubmission,
  isBrainAskSubmissionResult,
  isBrainAskWait,
  isBrainReplyClaimResult,
  isBrainRequestSnapshot,
} from "@sidecar/brain/requests-wire";
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
import type { RealtimeConnection } from "@sidecar/hosted";
import type { SupersetSignInSnapshot } from "@sidecar/providers/superset/sign-in-stage";
import type { RealtimeDiagnostics } from "@sidecar/realtime";
import {
  isProviderId,
  isSessionApplicationId,
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
  type KeyedAppSettingField,
  SETTINGS_RESET_SCOPE,
  type SettingEntryValue,
  settingEntryGuard,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import type { WindowMode } from "@sidecar/surface";
import {
  type ActionResult,
  isActionResult,
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
import type { SessionOpenResult } from "./session";
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
 *
 * An act is not one of `@sidecar/actions`'s actions. An action is a validated
 * thing Luke does at the developer's ask, admitted by `admit()` against a
 * session's own advertisement; an act is one window of this build asking its
 * own main process for an effect. A press that carries an action to a session
 * does so by asking the host, which is where the action is admitted.
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
  SUPERSET_BEGIN_SIGN_IN: "superset.beginSignIn",
  SUPERSET_SUBMIT_CODE: "superset.submitCode",
  SUPERSET_CHOOSE_ORGANIZATION: "superset.chooseOrganization",
  SUPERSET_REOPEN_SIGN_IN: "superset.reopenSignIn",
  SUPERSET_CANCEL_SIGN_IN: "superset.cancelSignIn",
  SUPERSET_DISCONNECT: "superset.disconnect",
  UPDATE_CHECK: "update.check",
  UPDATE_INSTALL: "update.install",
  UPDATE_OPEN_RELEASE: "update.openRelease",
  UPDATE_OPEN_CHANGELOG: "update.openChangelog",
  SESSION_OPEN: "session.open",
  SESSION_OPEN_APPLICATION: "session.openApplication",
  SESSION_OPEN_CHANGE: "session.openChange",
  BRAIN_SUBMIT_ASK: "brain.submitAsk",
  BRAIN_WAIT_ASK: "brain.waitAsk",
  BRAIN_CANCEL_ASK: "brain.cancelAsk",
  BRAIN_CLAIM_REPLY: "brain.claimReply",
  VOICE_COMMAND: "voice.command",
  VOICE_MINT_CREDENTIAL: "voice.mintCredential",
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
  INTRODUCTION_PEEK_SESSIONS: "introduction.peekSessions",
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

/** The record itself when it carries no key the payload does not name, and nothing otherwise. */
function onlyKeys(
  value: UnparsedWireValue,
  keys: readonly string[],
): UnparsedWireValue | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) if (!keys.includes(key)) return undefined;
  return value;
}

/**
 * An identifier that has to match the one it names elsewhere — a session, a
 * run, a delivery, an account, a calendar — so its ends are admitted as
 * written rather than trimmed into a value the roster would not hold.
 */
const exactId = s.text({ max: 512, ends: TEXT_ENDS.KEEP });

/** Every credential provider this build registered, which is what its record is keyed by. */
const CREDENTIAL_PROVIDER_IDS = Object.keys(CREDENTIAL_PROVIDERS).filter(isCredentialProviderId);

/**
 * A session as its provider named it. The provider id is admitted against the
 * registry rather than typed by it: an identity carries the id its provider
 * reported, and this build's own registry is what says whether that is one it
 * observes.
 */
function isSessionIdentity(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  return (
    isWireString(value.providerId) &&
    isProviderId(value.providerId) &&
    isWireString(value.providerSessionId) &&
    value.providerSessionId.length > 0
  );
}

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
    const value = onlyKeys(raw, ["field", "value"]);
    if (!value || !isRecord(value)) return malformed();
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
    const value = onlyKeys(raw, ["field", "key", "value"]);
    if (!value || !isRecord(value)) return malformed();
    const field = value.field;
    if (!isWireString(field) || !isKeyedAppSettingField(field)) return malformed(["field"]);
    const key = value.key;
    if (!isWireString(key) || !isSettingEntryKey(field, key)) return malformed(["key"]);
    if (!settingEntryGuard(field, key, value.value).valid) return malformed(["value"]);
    // SAFETY: the entry guard above admitted this value for this field and key.
    return { ok: true, value: { field, key, value: value.value } as SettingEntryPayload };
  },
};

/**
 * Every act's payload, one schema per kind. The schema is the whole of what
 * the boundary admits: it runs in the preload before the invoke leaves the
 * window and again in the router, so a caller inside the main process cannot
 * reach a row with a payload the window could not have sent.
 */
export const ACT_SCHEMA = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: s.record({
    provider: s.enumOf(Object.values(ACCOUNT_PROVIDER)),
  }),
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: noPayload,
  [ACT_KIND.ACCOUNT_SIGN_OUT]: noPayload,
  [ACT_KIND.ACCOUNT_DELETE]: noPayload,
  [ACT_KIND.SETTING_UPDATE]: settingUpdatePayload,
  [ACT_KIND.SETTING_UPDATE_ENTRY]: settingEntryPayload,
  [ACT_KIND.SETTINGS_RESET]: s.record({
    scope: s.enumOf(Object.values(SETTINGS_RESET_SCOPE)),
  }),
  [ACT_KIND.CREDENTIAL_SET_API_KEY]: s.record({
    providerId: s.enumOf(CREDENTIAL_PROVIDER_IDS),
    apiKey: s.text({ max: 4096, ends: TEXT_ENDS.KEEP, allowEmpty: true }).optional(),
  }),
  [ACT_KIND.CREDENTIAL_OPEN_API_KEYS]: s.record({
    providerId: s.enumOf(CREDENTIAL_PROVIDER_IDS),
  }),
  [ACT_KIND.CALENDAR_CONNECT_GOOGLE]: noPayload,
  [ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: noPayload,
  [ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: noPayload,
  [ACT_KIND.CALENDAR_REMOVE_ACCOUNT]: s.record({ accountId: exactId }),
  [ACT_KIND.CALENDAR_CONNECT_APPLE]: noPayload,
  [ACT_KIND.CALENDAR_DISCONNECT_APPLE]: noPayload,
  [ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS]: noPayload,
  [ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT]: noPayload,
  [ACT_KIND.CALENDAR_OPEN_SETTINGS]: noPayload,
  [ACT_KIND.CALENDAR_REFRESH]: noPayload,
  [ACT_KIND.CALENDAR_SET_SELECTED]: s.record({
    accountId: exactId,
    calendarId: exactId,
    selected: s.boolean(),
  }),
  [ACT_KIND.TRACKER_CONNECT]: noPayload,
  [ACT_KIND.TRACKER_CANCEL_SIGN_IN]: noPayload,
  [ACT_KIND.TRACKER_REOPEN_SIGN_IN]: noPayload,
  [ACT_KIND.TRACKER_DISCONNECT]: noPayload,
  [ACT_KIND.SUPERSET_BEGIN_SIGN_IN]: noPayload,
  [ACT_KIND.SUPERSET_SUBMIT_CODE]: s.record({ code: s.text({ max: 512 }) }),
  [ACT_KIND.SUPERSET_CHOOSE_ORGANIZATION]: s.record({ slug: exactId }),
  [ACT_KIND.SUPERSET_REOPEN_SIGN_IN]: noPayload,
  [ACT_KIND.SUPERSET_CANCEL_SIGN_IN]: noPayload,
  [ACT_KIND.SUPERSET_DISCONNECT]: noPayload,
  [ACT_KIND.UPDATE_CHECK]: noPayload,
  [ACT_KIND.UPDATE_INSTALL]: noPayload,
  [ACT_KIND.UPDATE_OPEN_RELEASE]: noPayload,
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: noPayload,
  [ACT_KIND.SESSION_OPEN]: guarded<{ identity: SessionIdentity }>(
    (value) =>
      onlyKeys(value, ["identity"]) !== undefined &&
      isRecord(value) &&
      isSessionIdentity(value.identity),
  ),
  [ACT_KIND.SESSION_OPEN_APPLICATION]: guarded<{
    identity: SessionIdentity;
    applicationId: SessionApplicationId;
  }>(
    (value) =>
      onlyKeys(value, ["identity", "applicationId"]) !== undefined &&
      isRecord(value) &&
      isSessionIdentity(value.identity) &&
      isWireString(value.applicationId) &&
      isSessionApplicationId(value.applicationId),
  ),
  [ACT_KIND.SESSION_OPEN_CHANGE]: guarded<{ identity: SessionIdentity }>(
    (value) =>
      onlyKeys(value, ["identity"]) !== undefined &&
      isRecord(value) &&
      isSessionIdentity(value.identity),
  ),
  [ACT_KIND.BRAIN_SUBMIT_ASK]: guarded<{ submission: BrainAskSubmission }>(
    (value) =>
      onlyKeys(value, ["submission"]) !== undefined &&
      isRecord(value) &&
      isBrainAskSubmission(value.submission),
  ),
  [ACT_KIND.BRAIN_WAIT_ASK]: s.record({
    runId: exactId,
    epoch: s.wholeNumber({ minimum: 0 }),
  }),
  [ACT_KIND.BRAIN_CANCEL_ASK]: s.record({ runId: exactId }),
  [ACT_KIND.BRAIN_CLAIM_REPLY]: s.record({
    runId: exactId,
    deliveryId: exactId,
    epoch: s.wholeNumber({ minimum: 0 }),
  }),
  [ACT_KIND.VOICE_COMMAND]: s.record({
    command: s.enumOf(Object.values(VOICE_COMMAND)),
  }),
  [ACT_KIND.VOICE_MINT_CREDENTIAL]: noPayload,
  [ACT_KIND.VOICE_DIAGNOSTICS]: noPayload,
  [ACT_KIND.MICROPHONE_REQUEST]: noPayload,
  [ACT_KIND.MICROPHONE_ROUTE]: noPayload,
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: noPayload,
  [ACT_KIND.WINDOW_SET_EXPANDED]: s.record({
    expanded: s.boolean(),
    focus: s.boolean().optional(),
  }),
  [ACT_KIND.WINDOW_FOCUS_PANEL]: noPayload,
  [ACT_KIND.WINDOW_COPY_TEXT]: s.record({ words: s.text({ max: 100_000, ends: TEXT_ENDS.KEEP }) }),
  [ACT_KIND.WINDOW_QUIT]: noPayload,
  [ACT_KIND.FEEDBACK_SUMMON]: s.record({ kind: s.enumOf(Object.values(FEEDBACK_KIND)) }),
  [ACT_KIND.FEEDBACK_SEND]: guarded<{ submission: FeedbackSubmission }>(
    (value) =>
      onlyKeys(value, ["submission"]) !== undefined &&
      isRecord(value) &&
      feedbackSubmission(value.submission) !== undefined,
  ),
  [ACT_KIND.ONBOARDING_SKIP_CALENDAR]: noPayload,
  [ACT_KIND.ONBOARDING_COMPLETE_CALENDAR]: noPayload,
  [ACT_KIND.INTRODUCTION_PEEK_SESSIONS]: noPayload,
  [ACT_KIND.INTRODUCTION_COMPLETE]: s.record({ given: s.boolean() }),
  [ACT_KIND.INTRODUCTION_ABANDON]: s.record({ reason: s.text({ max: 1024, oneLine: true }) }),
} as const satisfies Record<ActKind, ActSchema<unknown>>;

type SchemaValue<Declaration> = Declaration extends ActSchema<infer Value> ? Value : never;

/** What one kind's payload is, read from that kind's own schema. */
export type ActPayload<Kind extends ActKind> = SchemaValue<(typeof ACT_SCHEMA)[Kind]>;

/**
 * Every act's answer, one guard per kind, checked where the answer is read:
 * in the router before the outcome is minted, and in the window that asked
 * before its caller sees a value. A kind whose answer has a domain reader of
 * its own names it here; the rest carry the structured-clone shape alone,
 * which is all a `void` or a snapshot the host composed needs.
 */
export const ACT_RESULT = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: wireResult<AccountSnapshot>(),
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.ACCOUNT_SIGN_OUT]: wireResult<AccountSnapshot>(),
  [ACT_KIND.ACCOUNT_DELETE]: wireResult<AccountSnapshot>(),
  [ACT_KIND.SETTING_UPDATE]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.SETTING_UPDATE_ENTRY]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.SETTINGS_RESET]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.CREDENTIAL_SET_API_KEY]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.CREDENTIAL_OPEN_API_KEYS]: wireResult<void>(),
  [ACT_KIND.CALENDAR_CONNECT_GOOGLE]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.CALENDAR_REMOVE_ACCOUNT]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.CALENDAR_CONNECT_APPLE]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.CALENDAR_DISCONNECT_APPLE]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS]: wireResult<AppleCalendarAccess>(),
  [ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT]: wireResult<void>(),
  [ACT_KIND.CALENDAR_OPEN_SETTINGS]: wireResult<void>(),
  [ACT_KIND.CALENDAR_REFRESH]: wireResult<void>(),
  [ACT_KIND.CALENDAR_SET_SELECTED]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.TRACKER_CONNECT]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.TRACKER_CANCEL_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.TRACKER_REOPEN_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.TRACKER_DISCONNECT]: wireResult<SettingsUpdateResult>(),
  [ACT_KIND.SUPERSET_BEGIN_SIGN_IN]: wireResult<SupersetSignInSnapshot | undefined>(),
  [ACT_KIND.SUPERSET_SUBMIT_CODE]: wireResult<SupersetSignInSnapshot | undefined>(),
  [ACT_KIND.SUPERSET_CHOOSE_ORGANIZATION]: wireResult<SupersetSignInSnapshot | undefined>(),
  [ACT_KIND.SUPERSET_REOPEN_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.SUPERSET_CANCEL_SIGN_IN]: wireResult<void>(),
  [ACT_KIND.SUPERSET_DISCONNECT]: wireResult<ActionResult>(isActionResult),
  [ACT_KIND.UPDATE_CHECK]: wireResult<UpdateSnapshot>(),
  [ACT_KIND.UPDATE_INSTALL]: wireResult<void>(),
  [ACT_KIND.UPDATE_OPEN_RELEASE]: wireResult<void>(),
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: wireResult<void>(),
  [ACT_KIND.SESSION_OPEN]: wireResult<SessionOpenResult>(),
  [ACT_KIND.SESSION_OPEN_APPLICATION]: wireResult<SessionOpenResult>(),
  [ACT_KIND.SESSION_OPEN_CHANGE]: wireResult<SessionOpenResult>(),
  [ACT_KIND.BRAIN_SUBMIT_ASK]: wireResult<BrainAskSubmissionResult>(isBrainAskSubmissionResult),
  [ACT_KIND.BRAIN_WAIT_ASK]: wireResult<BrainAskWait>(isBrainAskWait),
  [ACT_KIND.BRAIN_CANCEL_ASK]: wireResult<BrainRequestSnapshot | undefined>(
    (value) => value === undefined || isBrainRequestSnapshot(value),
  ),
  [ACT_KIND.BRAIN_CLAIM_REPLY]: wireResult<BrainReplyClaimResult>(isBrainReplyClaimResult),
  [ACT_KIND.VOICE_COMMAND]: wireResult<VoiceCommandOutcome | undefined>(
    (value) => value === undefined || isVoiceCommandOutcome(value),
  ),
  [ACT_KIND.VOICE_MINT_CREDENTIAL]: wireResult<RealtimeConnection | undefined>(),
  [ACT_KIND.VOICE_DIAGNOSTICS]: wireResult<RealtimeDiagnostics>(),
  [ACT_KIND.MICROPHONE_REQUEST]: wireResult<MicrophoneStatus>(),
  [ACT_KIND.MICROPHONE_ROUTE]: wireResult<MicrophoneRoute | undefined>(),
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: wireResult<void>(),
  [ACT_KIND.WINDOW_SET_EXPANDED]: wireResult<WindowMode>(),
  [ACT_KIND.WINDOW_FOCUS_PANEL]: wireResult<void>(),
  [ACT_KIND.WINDOW_COPY_TEXT]: wireResult<void>(),
  [ACT_KIND.WINDOW_QUIT]: wireResult<void>(),
  [ACT_KIND.FEEDBACK_SUMMON]: wireResult<void>(),
  [ACT_KIND.FEEDBACK_SEND]: wireResult<FeedbackResult>(),
  [ACT_KIND.ONBOARDING_SKIP_CALENDAR]: wireResult<void>(),
  [ACT_KIND.ONBOARDING_COMPLETE_CALENDAR]: wireResult<void>(),
  [ACT_KIND.INTRODUCTION_PEEK_SESSIONS]: wireResult<readonly Session[]>(),
  [ACT_KIND.INTRODUCTION_COMPLETE]: wireResult<void>(),
  [ACT_KIND.INTRODUCTION_ABANDON]: wireResult<void>(),
} as const satisfies Record<ActKind, WireGuard<unknown>>;

/**
 * What one kind's refusal says when the act could not be carried at all: the
 * host unreachable, a window gone, the machine refusing. One sentence per
 * kind, fixed by this build, so what reaches the window that asked is
 * something its row can draw rather than whatever message an exception
 * happened to carry.
 */
export const ACT_REFUSAL = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: "Could not start signing in on this system.",
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: "Could not cancel that sign-in on this system.",
  [ACT_KIND.ACCOUNT_SIGN_OUT]: "Could not sign out on this system.",
  [ACT_KIND.ACCOUNT_DELETE]: "Could not delete that account on this system.",
  [ACT_KIND.SETTING_UPDATE]: "Could not save that setting on this system.",
  [ACT_KIND.SETTING_UPDATE_ENTRY]: "Could not save that setting on this system.",
  [ACT_KIND.SETTINGS_RESET]: "Could not reset those settings on this system.",
  [ACT_KIND.CREDENTIAL_SET_API_KEY]: "Could not save that API key on this system.",
  [ACT_KIND.CREDENTIAL_OPEN_API_KEYS]: "Could not open that provider's keys page.",
  [ACT_KIND.CALENDAR_CONNECT_GOOGLE]: "Could not connect Google Calendar on this system.",
  [ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: "Could not cancel that sign-in on this system.",
  [ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: "Could not reopen that sign-in on this system.",
  [ACT_KIND.CALENDAR_REMOVE_ACCOUNT]: "Could not disconnect that account on this system.",
  [ACT_KIND.CALENDAR_CONNECT_APPLE]: "Could not connect Apple Calendar on this system.",
  [ACT_KIND.CALENDAR_DISCONNECT_APPLE]: "Could not disconnect Apple Calendar on this system.",
  [ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS]: "Could not read Calendar access on this system.",
  [ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT]: "Could not cancel that connection on this system.",
  [ACT_KIND.CALENDAR_OPEN_SETTINGS]: "Could not open the Calendar privacy settings.",
  [ACT_KIND.CALENDAR_REFRESH]: "Could not read the calendars on this system.",
  [ACT_KIND.CALENDAR_SET_SELECTED]: "Could not save that calendar choice on this system.",
  [ACT_KIND.TRACKER_CONNECT]: "Could not connect Linear on this system.",
  [ACT_KIND.TRACKER_CANCEL_SIGN_IN]: "Could not cancel that sign-in on this system.",
  [ACT_KIND.TRACKER_REOPEN_SIGN_IN]: "Could not reopen that sign-in on this system.",
  [ACT_KIND.TRACKER_DISCONNECT]: "Could not disconnect Linear on this system.",
  [ACT_KIND.SUPERSET_BEGIN_SIGN_IN]: "Could not start signing in to Superset on this system.",
  [ACT_KIND.SUPERSET_SUBMIT_CODE]: "Could not send that code to Superset on this system.",
  [ACT_KIND.SUPERSET_CHOOSE_ORGANIZATION]: "Could not choose that organization on this system.",
  [ACT_KIND.SUPERSET_REOPEN_SIGN_IN]: "Could not reopen that sign-in on this system.",
  [ACT_KIND.SUPERSET_CANCEL_SIGN_IN]: "Could not cancel that sign-in on this system.",
  [ACT_KIND.SUPERSET_DISCONNECT]: "Could not disconnect Superset on this system.",
  [ACT_KIND.UPDATE_CHECK]: "Could not check for updates on this system.",
  [ACT_KIND.UPDATE_INSTALL]: "Could not install that update on this system.",
  [ACT_KIND.UPDATE_OPEN_RELEASE]: "Could not open the releases page.",
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: "Could not open the changelog.",
  [ACT_KIND.SESSION_OPEN]: "Could not open that session on this system.",
  [ACT_KIND.SESSION_OPEN_APPLICATION]: "Could not open that session in that app on this system.",
  [ACT_KIND.SESSION_OPEN_CHANGE]: "Could not open that pull request on this system.",
  [ACT_KIND.BRAIN_SUBMIT_ASK]: "Could not reach Luke's runtime to ask that.",
  [ACT_KIND.BRAIN_WAIT_ASK]: "Could not reach Luke's runtime to wait on that.",
  [ACT_KIND.BRAIN_CANCEL_ASK]: "Could not reach Luke's runtime to cancel that.",
  [ACT_KIND.BRAIN_CLAIM_REPLY]: "Could not reach Luke's runtime to claim that reply.",
  [ACT_KIND.VOICE_COMMAND]: "Could not carry that command on this system.",
  [ACT_KIND.VOICE_MINT_CREDENTIAL]: "Could not open a voice call on this system.",
  [ACT_KIND.VOICE_DIAGNOSTICS]: "Could not read the voice diagnostics on this system.",
  [ACT_KIND.MICROPHONE_REQUEST]: "Could not ask for the microphone on this system.",
  [ACT_KIND.MICROPHONE_ROUTE]: "Could not read the microphone route on this system.",
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: "Could not open the microphone privacy settings.",
  [ACT_KIND.WINDOW_SET_EXPANDED]: "Could not resize the panel on this system.",
  [ACT_KIND.WINDOW_FOCUS_PANEL]: "Could not focus the panel on this system.",
  [ACT_KIND.WINDOW_COPY_TEXT]: "Could not copy that to the clipboard on this system.",
  [ACT_KIND.WINDOW_QUIT]: "Could not quit on this system.",
  [ACT_KIND.FEEDBACK_SUMMON]: "Could not open the composer on this system.",
  [ACT_KIND.FEEDBACK_SEND]: "Could not send that on this system.",
  [ACT_KIND.ONBOARDING_SKIP_CALENDAR]: "Could not skip that step on this system.",
  [ACT_KIND.ONBOARDING_COMPLETE_CALENDAR]: "Could not settle that step on this system.",
  [ACT_KIND.INTRODUCTION_PEEK_SESSIONS]: "Could not read this machine's sessions.",
  [ACT_KIND.INTRODUCTION_COMPLETE]: "Could not record the introduction on this system.",
  [ACT_KIND.INTRODUCTION_ABANDON]: "Could not stand the introduction down on this system.",
} as const satisfies Record<ActKind, string>;

/** What one kind answers with, read from that kind's own guard. */
export type ActResultFor<Kind extends ActKind> = WireGuardValue<(typeof ACT_RESULT)[Kind]>;

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

/** One act narrowed to a single kind, which is what a router row is handed. */
export type ActOf<Kind extends ActKind> = Extract<Act, { kind: Kind }>;

/** What became of one act. Every answer is a value; nothing here is a throw. */
export const ACT_OUTCOME_STATUS = {
  DONE: "done",
  /** The act was admitted and refused, with a sentence its row can draw. */
  REFUSED: "refused",
  /** No kind by that name, which a build in step with its windows never sees. */
  UNKNOWN_ACT: "unknown-act",
} as const;

export type ActOutcomeStatus = (typeof ACT_OUTCOME_STATUS)[keyof typeof ACT_OUTCOME_STATUS];

export type ActOutcome<Kind extends ActKind = ActKind> =
  | { readonly status: typeof ACT_OUTCOME_STATUS.DONE; readonly value: ActResultFor<Kind> }
  | { readonly status: typeof ACT_OUTCOME_STATUS.REFUSED; readonly reason: string }
  | { readonly status: typeof ACT_OUTCOME_STATUS.UNKNOWN_ACT };

const ACT_KINDS: readonly string[] = Object.values(ACT_KIND);

export function isActKind(value: UnparsedWireValue): value is ActKind {
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
  const read = ACT_SCHEMA[kind].read(value.payload);
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
