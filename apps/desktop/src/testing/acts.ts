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
  [ACT_KIND.CONTACT_EMAIL]: { kind: ACT_KIND.CONTACT_EMAIL },
  [ACT_KIND.PLANNING_REFRESH]: { kind: ACT_KIND.PLANNING_REFRESH },
  [ACT_KIND.PLANNING_WORK_EARLIER]: { kind: ACT_KIND.PLANNING_WORK_EARLIER },
  [ACT_KIND.PLANNING_FILE]: {
    kind: ACT_KIND.PLANNING_FILE,
    payload: {
      planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
      path: "src/invite.ts",
      firstLine: 1,
      lastLine: 500,
    },
  },
  [ACT_KIND.PLANNING_TREE]: {
    kind: ACT_KIND.PLANNING_TREE,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", path: "src" },
  },
  [ACT_KIND.PLANNING_SKILLS]: {
    kind: ACT_KIND.PLANNING_SKILLS,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_COLOUR_CODE]: {
    kind: ACT_KIND.PLANNING_COLOUR_CODE,
    payload: { language: "ts", code: "export const seats = 3;" },
  },
  [ACT_KIND.PLANNING_REVISIONS]: {
    kind: ACT_KIND.PLANNING_REVISIONS,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_REVISION]: {
    kind: ACT_KIND.PLANNING_REVISION,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", seq: 2 },
  },
  [ACT_KIND.PLANNING_RESTORE]: {
    kind: ACT_KIND.PLANNING_RESTORE,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", seq: 2 },
  },
  [ACT_KIND.PLANNING_CLOSE]: { kind: ACT_KIND.PLANNING_CLOSE },
  [ACT_KIND.PLANNING_SELECT]: {
    kind: ACT_KIND.PLANNING_SELECT,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_START]: {
    kind: ACT_KIND.PLANNING_START,
    payload: { name: "Teammate invitations", repository: "acme/relay" },
  },
  [ACT_KIND.PLANNING_DELETE]: {
    kind: ACT_KIND.PLANNING_DELETE,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.PLANNING_RENAME]: {
    kind: ACT_KIND.PLANNING_RENAME,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", name: "Team invites" },
  },
  [ACT_KIND.PLANNING_PIN]: {
    kind: ACT_KIND.PLANNING_PIN,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", pinned: true },
  },
  [ACT_KIND.PLANNING_PIN_REPOSITORY]: {
    kind: ACT_KIND.PLANNING_PIN_REPOSITORY,
    payload: { repository: "acme/relay", pinned: true },
  },
  [ACT_KIND.PLANNING_ARCHIVE]: {
    kind: ACT_KIND.PLANNING_ARCHIVE,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", archived: true },
  },
  [ACT_KIND.PLANNING_REPOSITORIES]: { kind: ACT_KIND.PLANNING_REPOSITORIES },
  [ACT_KIND.PLANNING_SET_REPOSITORY]: {
    kind: ACT_KIND.PLANNING_SET_REPOSITORY,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", repository: "acme/relay" },
  },
  [ACT_KIND.PLANNING_EDIT]: {
    kind: ACT_KIND.PLANNING_EDIT,
    payload: {
      planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
      edit: { document: { base: "", value: "Invites expire after 7 days." } },
    },
  },
  [ACT_KIND.GITHUB_OPEN]: {
    kind: ACT_KIND.GITHUB_OPEN,
    payload: { url: "https://github.com/acme/relay" },
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
  [ACT_KIND.CODING_AGENTS_MODELS]: { kind: ACT_KIND.CODING_AGENTS_MODELS },
  [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: { kind: ACT_KIND.CODING_AGENTS_DEFAULT_READ },
  [ACT_KIND.LINEAR_STATUS]: { kind: ACT_KIND.LINEAR_STATUS },
  [ACT_KIND.LINEAR_CONNECT]: { kind: ACT_KIND.LINEAR_CONNECT },
  [ACT_KIND.LINEAR_DISCONNECT]: { kind: ACT_KIND.LINEAR_DISCONNECT },
  [ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: {
    kind: ACT_KIND.CODING_AGENTS_DEFAULT_WRITE,
    payload: { model: "anthropic/claude-opus-5.5", effort: "high" },
  },
  [ACT_KIND.CODING_AGENTS_LIST]: {
    kind: ACT_KIND.CODING_AGENTS_LIST,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10" },
  },
  [ACT_KIND.CODING_AGENTS_START]: {
    kind: ACT_KIND.CODING_AGENTS_START,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", idempotencyKey: "press-1" },
  },
  [ACT_KIND.CODING_AGENTS_MESSAGES]: {
    kind: ACT_KIND.CODING_AGENTS_MESSAGES,
    payload: { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", after: "0:0" },
  },
  [ACT_KIND.CODING_AGENTS_MESSAGE]: {
    kind: ACT_KIND.CODING_AGENTS_MESSAGE,
    payload: {
      agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      text: "Also expire them after a week.",
      clientKey: "7f9e2c1d-4b3a-4c5d-9e8f-0a1b2c3d4e5f",
    },
  },
  [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: {
    kind: ACT_KIND.CODING_AGENTS_PULL_REQUEST,
    payload: { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" },
  },
  [ACT_KIND.PROVIDER_KEYS_READ]: { kind: ACT_KIND.PROVIDER_KEYS_READ },
  [ACT_KIND.PROVIDER_KEYS_SAVE]: {
    kind: ACT_KIND.PROVIDER_KEYS_SAVE,
    payload: { provider: "anthropic", key: "sk-ant-api03-synthetic-000000000000000000" },
  },
  [ACT_KIND.PROVIDER_KEYS_REMOVE]: {
    kind: ACT_KIND.PROVIDER_KEYS_REMOVE,
    payload: { provider: "anthropic" },
  },
  [ACT_KIND.PLAN_TEMPLATE_READ]: { kind: ACT_KIND.PLAN_TEMPLATE_READ },
  [ACT_KIND.PLAN_TEMPLATE_WRITE]: {
    kind: ACT_KIND.PLAN_TEMPLATE_WRITE,
    payload: { template: "## Context\n\nWhy this work exists.\n" },
  },
  [ACT_KIND.PLAN_TEMPLATE_REVISIONS]: { kind: ACT_KIND.PLAN_TEMPLATE_REVISIONS, payload: {} },
  [ACT_KIND.PLAN_TEMPLATE_REVISION]: {
    kind: ACT_KIND.PLAN_TEMPLATE_REVISION,
    payload: { seq: 2 },
  },
  [ACT_KIND.PLAN_TEMPLATE_RESTORE]: {
    kind: ACT_KIND.PLAN_TEMPLATE_RESTORE,
    payload: { seq: 2 },
  },
  [ACT_KIND.DICTATION_TRANSCRIBE]: {
    kind: ACT_KIND.DICTATION_TRANSCRIBE,
    payload: { audio: "GkXfow==", durationMs: 1_500, keywords: ["luke"] },
  },
  [ACT_KIND.CODING_AGENTS_CHOOSE]: {
    kind: ACT_KIND.CODING_AGENTS_CHOOSE,
    payload: {
      agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
    },
  },
  [ACT_KIND.CODING_AGENTS_RENAME]: {
    kind: ACT_KIND.CODING_AGENTS_RENAME,
    payload: { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", title: "Sign-out button" },
  },
  [ACT_KIND.CODING_AGENTS_STOP]: {
    kind: ACT_KIND.CODING_AGENTS_STOP,
    payload: { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" },
  },
  [ACT_KIND.CODING_AGENTS_ARCHIVE]: {
    kind: ACT_KIND.CODING_AGENTS_ARCHIVE,
    payload: { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", archived: true },
  },
  [ACT_KIND.CODING_AGENTS_SHOWN]: {
    kind: ACT_KIND.CODING_AGENTS_SHOWN,
    payload: { agentId: null, inboxPlanId: null },
  },
  [ACT_KIND.CODING_AGENTS_INBOX]: {
    kind: ACT_KIND.CODING_AGENTS_INBOX,
    payload: { planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", after: "0" },
  },
  [ACT_KIND.CODING_AGENTS_INBOX_ANSWER]: {
    kind: ACT_KIND.CODING_AGENTS_INBOX_ANSWER,
    payload: {
      itemId: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
      revision: 1,
      reply: "approved",
      clientKey: "7f9e2c1d-4b3a-4c5d-9e8f-0a1b2c3d4e5f",
    },
  },
  [ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]: {
    kind: ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT,
    payload: {
      itemId: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
      attachmentId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
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
  [ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS]: { kind: ACT_KIND.NOTIFICATIONS_OPEN_SETTINGS },
  [ACT_KIND.WINDOW_FOCUS_PANEL]: { kind: ACT_KIND.WINDOW_FOCUS_PANEL },
  [ACT_KIND.CALL_SHOW_PLAN]: { kind: ACT_KIND.CALL_SHOW_PLAN },
  [ACT_KIND.WINDOW_COPY_TEXT]: { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "checkout" } },
  [ACT_KIND.WINDOW_SAVE_FILE]: {
    kind: ACT_KIND.WINDOW_SAVE_FILE,
    payload: { name: "invite.ts", text: "export {};" },
  },
  [ACT_KIND.FEEDBACK_SEND]: {
    kind: ACT_KIND.FEEDBACK_SEND,
    payload: { submission: { kind: "feedback", message: "it works", images: [] } },
  },
} as const satisfies { readonly [Kind in ActKind]: Act & { kind: Kind } };
