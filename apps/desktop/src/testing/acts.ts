import { ACT_KIND, type Act, type ActKind } from "#shared/messages/acts";

const IDENTITY = { providerId: "claude-code", providerSessionId: "session-a" };

/**
 * One admissible act per kind. Total by its type, so a kind added to the
 * vocabulary with no example here does not build — the table below is what
 * proves every kind is reachable at all, and a kind nothing can send is a
 * kind nobody meant to add.
 */
export const ONE_ACT_OF_EACH_KIND = {
  [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: {
    kind: ACT_KIND.ACCOUNT_BEGIN_SIGN_IN,
    payload: { provider: "google" },
  },
  [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: { kind: ACT_KIND.ACCOUNT_CANCEL_SIGN_IN },
  [ACT_KIND.ACCOUNT_SIGN_OUT]: { kind: ACT_KIND.ACCOUNT_SIGN_OUT },
  [ACT_KIND.ACCOUNT_DELETE]: { kind: ACT_KIND.ACCOUNT_DELETE },
  [ACT_KIND.SETTING_UPDATE]: {
    kind: ACT_KIND.SETTING_UPDATE,
    payload: { field: "openAtLogin", value: true },
  },
  [ACT_KIND.SETTING_UPDATE_ENTRY]: {
    kind: ACT_KIND.SETTING_UPDATE_ENTRY,
    payload: { field: "workspaceProjectDefaults", key: "conductor", value: "luke" },
  },
  [ACT_KIND.SETTINGS_RESET]: { kind: ACT_KIND.SETTINGS_RESET, payload: { scope: "voice" } },
  [ACT_KIND.CREDENTIAL_SET_API_KEY]: {
    kind: ACT_KIND.CREDENTIAL_SET_API_KEY,
    payload: { providerId: "openai", apiKey: "sk-test" },
  },
  [ACT_KIND.CREDENTIAL_OPEN_API_KEYS]: {
    kind: ACT_KIND.CREDENTIAL_OPEN_API_KEYS,
    payload: { providerId: "openai" },
  },
  [ACT_KIND.CALENDAR_CONNECT_GOOGLE]: { kind: ACT_KIND.CALENDAR_CONNECT_GOOGLE },
  [ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN]: { kind: ACT_KIND.CALENDAR_CANCEL_GOOGLE_SIGN_IN },
  [ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN]: { kind: ACT_KIND.CALENDAR_REOPEN_GOOGLE_SIGN_IN },
  [ACT_KIND.CALENDAR_REMOVE_ACCOUNT]: {
    kind: ACT_KIND.CALENDAR_REMOVE_ACCOUNT,
    payload: { accountId: "account-1" },
  },
  [ACT_KIND.CALENDAR_CONNECT_APPLE]: { kind: ACT_KIND.CALENDAR_CONNECT_APPLE },
  [ACT_KIND.CALENDAR_DISCONNECT_APPLE]: { kind: ACT_KIND.CALENDAR_DISCONNECT_APPLE },
  [ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS]: { kind: ACT_KIND.CALENDAR_APPLE_ACCESS_STATUS },
  [ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT]: { kind: ACT_KIND.CALENDAR_CANCEL_APPLE_CONNECT },
  [ACT_KIND.CALENDAR_OPEN_SETTINGS]: { kind: ACT_KIND.CALENDAR_OPEN_SETTINGS },
  [ACT_KIND.CALENDAR_REFRESH]: { kind: ACT_KIND.CALENDAR_REFRESH },
  [ACT_KIND.CALENDAR_SET_SELECTED]: {
    kind: ACT_KIND.CALENDAR_SET_SELECTED,
    payload: { accountId: "account-1", calendarId: "calendar-1", selected: true },
  },
  [ACT_KIND.UPDATE_CHECK]: { kind: ACT_KIND.UPDATE_CHECK },
  [ACT_KIND.UPDATE_INSTALL]: { kind: ACT_KIND.UPDATE_INSTALL },
  [ACT_KIND.UPDATE_OPEN_RELEASE]: { kind: ACT_KIND.UPDATE_OPEN_RELEASE },
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: { kind: ACT_KIND.UPDATE_OPEN_CHANGELOG },
  [ACT_KIND.SESSION_OPEN]: { kind: ACT_KIND.SESSION_OPEN, payload: { identity: IDENTITY } },
  [ACT_KIND.SESSION_OPEN_APPLICATION]: {
    kind: ACT_KIND.SESSION_OPEN_APPLICATION,
    payload: { identity: IDENTITY, applicationId: "conductor" },
  },
  [ACT_KIND.SESSION_OPEN_CHANGE]: {
    kind: ACT_KIND.SESSION_OPEN_CHANGE,
    payload: { identity: IDENTITY },
  },
  [ACT_KIND.SESSION_SEND_MESSAGE]: {
    kind: ACT_KIND.SESSION_SEND_MESSAGE,
    payload: { identity: IDENTITY, text: "please add a test for the retry" },
  },
  [ACT_KIND.SESSION_EXECUTE_CONTROL]: {
    kind: ACT_KIND.SESSION_EXECUTE_CONTROL,
    payload: { identity: IDENTITY, controlId: "cancel-run" },
  },
  [ACT_KIND.BRAIN_CANCEL_ASK]: { kind: ACT_KIND.BRAIN_CANCEL_ASK, payload: { runId: "run-1" } },
  [ACT_KIND.CONVERSATION_RATE_MESSAGE]: {
    kind: ACT_KIND.CONVERSATION_RATE_MESSAGE,
    payload: { messageId: "2b000000-0000-4000-8000-000000000202", rating: "up" },
  },
  [ACT_KIND.VOICE_COMMAND]: {
    kind: ACT_KIND.VOICE_COMMAND,
    payload: { command: "clear-conversation" },
  },
  [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: {
    kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
    payload: { sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n" },
  },
  [ACT_KIND.VOICE_END_LIVE_SESSION]: { kind: ACT_KIND.VOICE_END_LIVE_SESSION },
  [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: {
    kind: ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT,
    payload: { state: "connected" },
  },
  [ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY]: {
    kind: ACT_KIND.VOICE_REPORT_LIVE_ACTIVITY,
    payload: { idle: true },
  },
  [ACT_KIND.VOICE_STOP_SPEAKING]: { kind: ACT_KIND.VOICE_STOP_SPEAKING },
  [ACT_KIND.VOICE_DIAGNOSTICS]: { kind: ACT_KIND.VOICE_DIAGNOSTICS },
  [ACT_KIND.MICROPHONE_REQUEST]: { kind: ACT_KIND.MICROPHONE_REQUEST },
  [ACT_KIND.MICROPHONE_ROUTE]: { kind: ACT_KIND.MICROPHONE_ROUTE },
  [ACT_KIND.MICROPHONE_OPEN_SETTINGS]: { kind: ACT_KIND.MICROPHONE_OPEN_SETTINGS },
  [ACT_KIND.WINDOW_SET_EXPANDED]: {
    kind: ACT_KIND.WINDOW_SET_EXPANDED,
    payload: { expanded: true, focus: false },
  },
  [ACT_KIND.WINDOW_FOCUS_PANEL]: { kind: ACT_KIND.WINDOW_FOCUS_PANEL },
  [ACT_KIND.WINDOW_COPY_TEXT]: { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "checkout" } },
  [ACT_KIND.WINDOW_QUIT]: { kind: ACT_KIND.WINDOW_QUIT },
  [ACT_KIND.FEEDBACK_SUMMON]: { kind: ACT_KIND.FEEDBACK_SUMMON, payload: { kind: "feedback" } },
  [ACT_KIND.FEEDBACK_SEND]: {
    kind: ACT_KIND.FEEDBACK_SEND,
    payload: { submission: { kind: "feedback", message: "it works", images: [] } },
  },
  [ACT_KIND.ONBOARDING_SKIP_CALENDAR]: { kind: ACT_KIND.ONBOARDING_SKIP_CALENDAR },
  [ACT_KIND.ONBOARDING_SKIP_CONDUCTOR_KEY]: { kind: ACT_KIND.ONBOARDING_SKIP_CONDUCTOR_KEY },
  [ACT_KIND.ONBOARDING_COMPLETE_CALENDAR]: { kind: ACT_KIND.ONBOARDING_COMPLETE_CALENDAR },
  [ACT_KIND.INTRODUCTION_CREATE_SESSION]: {
    kind: ACT_KIND.INTRODUCTION_CREATE_SESSION,
    payload: { sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n", titles: ["Fix the flaky test"] },
  },
  [ACT_KIND.INTRODUCTION_END_SESSION]: { kind: ACT_KIND.INTRODUCTION_END_SESSION },
  [ACT_KIND.INTRODUCTION_COMPLETE]: {
    kind: ACT_KIND.INTRODUCTION_COMPLETE,
    payload: { given: true },
  },
  [ACT_KIND.INTRODUCTION_ABANDON]: {
    kind: ACT_KIND.INTRODUCTION_ABANDON,
    payload: { reason: "the voice never connected" },
  },
} as const satisfies { readonly [Kind in ActKind]: Act & { kind: Kind } };
