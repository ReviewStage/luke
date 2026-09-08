/**
 * Luke's runtime as one host: everything that executes, persists, schedules,
 * observes, or holds an account, composed once over an explicit state root
 * and reached only through the Gateway server it answers with. It draws
 * nothing and imports no Electron: what a window must learn leaves as a host
 * event, and what only the machine a client runs on can do arrives as a
 * capability asked of the native node by name. The desktop composes this in
 * its own process today and reaches it over the in-process transport; a
 * process on the other side of a socket is the same host over another
 * transport.
 *
 * This package's modules are not all public, which is what the hand-listed
 * barrel says: every name here has a client that reaches it, and a name a
 * client does not reach yet is added when one arrives.
 */
export { REJECTED_SUBMISSION } from "./brain/publication.js";
export { composeHost, type Host } from "./compose-host.js";
export type { ConversationOperations } from "./conversation-operations.js";
export type { HostSeams } from "./host-kernel.js";
export {
  INTRODUCTION_FADE_MS,
  INTRODUCTION_HANDOFF_READY_MS,
  INTRODUCTION_PEEK_FRESH_MS,
  INTRODUCTION_RENDER_DEADLINE_MS,
  shouldRunIntroduction,
} from "./introduction-flow.js";
export { jsonStateFile } from "./json-state-file.js";
export {
  HOST_NATIVE_NODE_ID,
  HOST_NODE_CAPABILITY,
  HOST_NODE_CAPABILITY_LIST,
  HOST_OPERATOR_CLIENT_ID,
} from "./node-capabilities.js";
export { onboardingStateFile } from "./onboarding-state.js";
export { createGatewayOperator, type GatewayOperator } from "./operator.js";
export { type RunMode, runModeFor, sentryReportingEnabled } from "./run-mode.js";
export { createGatewayService, type GrantedWords } from "./service.js";
export { OPEN_REFUSAL, type SessionActionPerformer } from "./session-action-performer.js";
export { storeWorkerPath } from "./store-path.js";
export { VoiceReceiver } from "./voice-receiver.js";
