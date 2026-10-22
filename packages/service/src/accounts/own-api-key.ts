/**
 * own-api-key.ts -- the API key one account saved for a provider, opened, and nothing where it saved none.
 *
 * Every model call Luke makes for an account outside a coding agent's step
 * (a voice call, a dictated clip) runs on the account's own key and never on
 * Luke's, since Luke pays for no model call. The key is read afresh on every
 * call, so one saved, replaced, or removed in Settings is the next call's.
 * A row the deployment's ring cannot open (no ring, a malformed one, or one
 * that no longer holds the row's version) answers unreadable rather than
 * none, since the account did save a key and adding another would not help:
 * the call is left unmade and answered unavailable, never spent elsewhere.
 */

import {
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  type ProviderKeyUnreadable,
  parseKeyRing,
} from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { PROVIDER_KEY_KIND, type ProviderKeyProvider } from "@luke/features/provider-key-wire";
import { Effect, type Redacted, Result } from "effect";

/** The account's own API key, nothing where it saved none, or unreadable where it saved one the deployment cannot open. */
export type OwnApiKey = Redacted.Redacted | ProviderKeyUnreadable | undefined;

/** The account's own API key for the provider, opened under the deployment's ring. */
export function ownApiKeyOf(
  userId: string,
  provider: ProviderKeyProvider,
  ring: Redacted.Redacted | undefined,
): TaskStoreEffect<OwnApiKey> {
  return Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY), (rows) => {
    const row = rows.find((each) => each.provider === provider);
    if (row === undefined) return undefined;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) return PROVIDER_KEY_UNREADABLE;
    const opened = openProviderKey(
      parsed.success,
      { userId, provider, kind: PROVIDER_KEY_KIND.API_KEY },
      row,
    );
    return Result.isFailure(opened) ? PROVIDER_KEY_UNREADABLE : opened.success;
  });
}
