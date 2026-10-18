/**
 * index.ts -- the client core: the app-state document and what keeps it current from the host, which a desktop shell and a web bridge assemble the same way.
 */
export {
  AppStateStore,
  initialAppState,
  publishAppStateChanges,
  voiceWindowGone,
  voiceWindowState,
  windowAppState,
} from "./app-state-store.js";
export { linkClientNotices } from "./client-notices.js";
export { linkNetworkWatch } from "./network-watch.js";
export { createOperatorClient, type OperatorClient } from "./operator-client.js";
