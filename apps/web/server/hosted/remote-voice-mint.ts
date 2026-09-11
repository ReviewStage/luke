import {
  type CloudFetch,
  CONTEXT_ITEM_KIND,
  contextItemId,
  type ObservedSession,
} from "../core.js";
import { observedSessionForResponse } from "./observe.js";
import { remoteSessionContextText } from "./remote-context.js";
import { observeProviders, readApiKeyFor } from "./vault-keys.js";
import type { HostedVaultRoute } from "./vault-route.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in iPhone, on the
 * key this deployment holds. Unlike the desktop mint, this endpoint also runs
 * a cloud observe pass and pre-serializes the session roster as a context item
 * so the phone can be a thin terminal: it forwards the opaque string into the
 * Realtime conversation without re-implementing context serialization logic.
 *
 * The tool list is narrowed to the actions the remote action endpoints serve; the
 * server re-validates every action on its own fresh observation pass regardless,
 * so the phone's narrowed set is a first gate, not the last.
 */

/** The fields the phone's mint takes, and nothing beyond them. */
export const MOBILE_MINT_STRICT_FIELDS: readonly string[] = ["voice", "speed"];

/** What a roster read needs of the deployment: the vault secret and the caller's stored keys. */
export interface RemoteObserveSeams
  extends Pick<HostedVaultRoute, "encryptionSecret" | "readVaultKeys"> {
  fetch?: CloudFetch | undefined;
}

/**
 * The phone's roster: one cloud observe pass under the caller's own stored
 * keys, or nothing at all when this deployment holds no vault secret. It
 * answers a list rather than a refusal — a mint whose roster could not be
 * read is still a mint.
 */
export async function observeCloudSessions(
  userId: string,
  options: RemoteObserveSeams,
): Promise<ObservedSession[]> {
  const secret = (options.encryptionSecret ?? "").trim();
  if (!secret) return [];

  const rows = await options.readVaultKeys(userId).catch(() => []);
  const passes = await observeProviders({
    readApiKey: readApiKeyFor(rows, secret),
    read: (adapter) => adapter.observe(),
    seams: options,
  });

  const sessions: ObservedSession[] = [];
  for (const pass of passes) {
    for (const observation of pass.answer ?? []) {
      sessions.push(observedSessionForResponse(pass.providerId, observation));
    }
  }
  return sessions;
}

/** The roster's context item as the mint answers it: the item's own id and its text. */
export interface RemoteSessionContextItem {
  itemId: string;
  text: string;
}

/**
 * The roster as the one context item the phone forwards into its Realtime
 * conversation. The label prefix matches the one `sessionContextEvents` in
 * `@sidecar/brain` applies, so the model reads remote and desktop context
 * items identically.
 */
export function remoteSessionContextItem(
  sessions: readonly ObservedSession[],
  now: number,
): RemoteSessionContextItem {
  return {
    itemId: contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 0),
    text: `[observed session status, sent automatically]\n${remoteSessionContextText(sessions, now)}`,
  };
}
