import {
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  type SessionApplication,
} from "@sidecar/session";

/**
 * The two routes Cursor's own deep-link handler resolves to an exact chat,
 * each composed on this machine from an observed id and handed to the
 * operating system, reaching Cursor's write paths never. A local chat the
 * app holds answers `/agent` by its chat id; a cloud agent answers
 * `/background-agent` by its agent id — the same address Cursor's own
 * dashboard fires from its Open in Cursor buttons. Either opens the exact
 * chat whether Cursor is running or not, and an id Cursor cannot resolve
 * draws its own not-found notice rather than acting on anything.
 */
export function cursorChatLink(providerSessionId: string): string {
  return `cursor://anysphere.cursor-deeplink/agent?id=${encodeURIComponent(providerSessionId)}`;
}

export function cursorCloudAgentLink(agentId: string): string {
  return `cursor://anysphere.cursor-deeplink/background-agent?bcId=${encodeURIComponent(agentId)}`;
}

/**
 * The Cursor app riding a chat it can open as an app association, the way
 * ChatGPT rides a local Codex chat: the agent stays the row's identity, and
 * the mark's press opens the exact chat in the app. The application id is
 * deliberately not the provider's — the app chip counts the chats the Cursor
 * app can open, where the agent chip counts every Cursor chat — so a local
 * CLI chat, which the app cannot open, wears the agent identity alone.
 */
export function cursorApplication(link: string): SessionApplication {
  return {
    id: SESSION_APPLICATION_ID.CURSOR,
    displayName: "Cursor",
    scope: SESSION_APPLICATION_SCOPE.SESSION,
    link,
  };
}
