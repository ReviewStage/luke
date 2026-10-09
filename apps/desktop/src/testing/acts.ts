import { ACT_KIND, type Act, type ActKind } from "#shared/messages/acts";

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
  [ACT_KIND.SETTINGS_RESET]: { kind: ACT_KIND.SETTINGS_RESET, payload: { scope: "voice" } },
  [ACT_KIND.UPDATE_CHECK]: { kind: ACT_KIND.UPDATE_CHECK },
  [ACT_KIND.UPDATE_INSTALL]: { kind: ACT_KIND.UPDATE_INSTALL },
  [ACT_KIND.UPDATE_OPEN_RELEASE]: { kind: ACT_KIND.UPDATE_OPEN_RELEASE },
  [ACT_KIND.UPDATE_OPEN_CHANGELOG]: { kind: ACT_KIND.UPDATE_OPEN_CHANGELOG },
  [ACT_KIND.PLANNING_REFRESH]: { kind: ACT_KIND.PLANNING_REFRESH },
  [ACT_KIND.PLANNING_CLOSE]: { kind: ACT_KIND.PLANNING_CLOSE },
  [ACT_KIND.PLANNING_SELECT]: {
    kind: ACT_KIND.PLANNING_SELECT,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_START]: {
    kind: ACT_KIND.PLANNING_START,
    payload: { name: "Teammate invitations", folderPath: "/Users/dev/relay" },
  },
  [ACT_KIND.PLANNING_DELETE]: {
    kind: ACT_KIND.PLANNING_DELETE,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_RENAME]: {
    kind: ACT_KIND.PLANNING_RENAME,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", name: "Team invites" },
  },
  [ACT_KIND.PLANNING_CHOOSE_FOLDER]: { kind: ACT_KIND.PLANNING_CHOOSE_FOLDER },
  [ACT_KIND.PLANNING_SET_FOLDER]: {
    kind: ACT_KIND.PLANNING_SET_FOLDER,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", folderPath: "/Users/dev/relay" },
  },
  [ACT_KIND.PLANNING_REVEAL_FOLDER]: {
    kind: ACT_KIND.PLANNING_REVEAL_FOLDER,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_TALK]: { kind: ACT_KIND.PLANNING_TALK },
  [ACT_KIND.PLANNING_BOARD_SAVE]: {
    kind: ACT_KIND.PLANNING_BOARD_SAVE,
    payload: {
      planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
      elements: [{ id: "api", type: "rectangle", x: 0, y: 0, width: 200, height: 80 }],
      appliedDrawing: 1,
    },
  },
  [ACT_KIND.VOICE_COMMAND]: {
    kind: ACT_KIND.VOICE_COMMAND,
    payload: { command: "end-call" },
  },
  [ACT_KIND.VOICE_CREATE_LIVE_SESSION]: {
    kind: ACT_KIND.VOICE_CREATE_LIVE_SESSION,
    payload: {
      sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
      planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    },
  },
  [ACT_KIND.VOICE_END_LIVE_SESSION]: {
    kind: ACT_KIND.VOICE_END_LIVE_SESSION,
    payload: { sessionId: "sess_1" },
  },
  [ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT]: {
    kind: ACT_KIND.VOICE_REPORT_LIVE_TRANSPORT,
    payload: { sessionId: "sess_1", state: "connected" },
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
  [ACT_KIND.WINDOW_FOCUS_PANEL]: { kind: ACT_KIND.WINDOW_FOCUS_PANEL },
  [ACT_KIND.WINDOW_COPY_TEXT]: { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "checkout" } },
  [ACT_KIND.FEEDBACK_SEND]: {
    kind: ACT_KIND.FEEDBACK_SEND,
    payload: { submission: { kind: "feedback", message: "it works", images: [] } },
  },
} as const satisfies { readonly [Kind in ActKind]: Act & { kind: Kind } };
