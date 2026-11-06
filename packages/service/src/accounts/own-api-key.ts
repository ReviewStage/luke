/**
 * own-api-key.ts -- the API key one account saved for a provider, opened, and nothing where it saved none.
 *
 * Every model call we make for an account outside a coding agent's step
 * (a voice call, a dictated clip) runs on the account's own key and never on
 * ours, since we pay for no model call. The key is read afresh on every
 * call, so one saved, replaced, or removed in Settings is the next call's.
 * A row the deployment's ring cannot open (no ring, a malformed one, or one
 * that no longer holds the row's version) answers unreadable rather than
 * none, since the account did save a key and adding another would not help:
 * the call is left unmade and answered unavailable, never spent elsewhere.
 *
 * A Preview is the one exception: its database is copied from production's,
 * so every key in it is sealed under production's ring, which a Preview
 * never holds. There, a key that is missing or unreadable is answered with
 * the Preview's own stand-in key for the provider (`HostedEnvironment`'s
 * `previewApiKeys`), where it holds one and the account is an admin of ours
 * (`admin/admin-access.ts`); the account's own key still wins wherever it
 * opens. No other deployment holds a stand-in, and no other account spends
 * one, since every member who can sign in to a Preview would otherwise run
 * on it.
 */

import { readAccountAccess } from "@repo/database/models/account-store";
import {
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  type ProviderKeyUnreadable,
  parseKeyRing,
} from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import { PROVIDER_KEY_KIND, type ProviderKeyProvider } from "@repo/features/provider-key-wire";
import { Effect, Redacted, Result } from "effect";
import { isAdminRole } from "../admin/admin-access.js";
import type { HostedEnvironmentValues, PreviewApiKeys } from "../environment.js";

/** The account's own API key, nothing where it saved none, or unreadable where it saved one the deployment cannot open. */
export type OwnApiKey = Redacted.Redacted | ProviderKeyUnreadable | undefined;

/** What of the deployment's environment an account's key is read under: the ring it opens under, and a Preview's stand-ins. */
export type AccountKeyEnvironment = Pick<
  HostedEnvironmentValues,
  "providerKeyEncryptionKeys" | "previewApiKeys"
>;

/**
 * The Preview's stand-in keys the account may spend: every one the
 * deployment holds for an admin of ours, and none for any other account. The
 * account's role is read only where the deployment holds a stand-in, so
 * production and a local run read nothing more.
 */
export function previewKeysOf(
  userId: string,
  environment: Pick<AccountKeyEnvironment, "previewApiKeys">,
): TaskStoreEffect<PreviewApiKeys> {
  const keys = environment.previewApiKeys;
  if (Object.keys(keys).length === 0) return Effect.succeed(keys);
  return Effect.map(readAccountAccess(userId), (access) => (isAdminRole(access.role) ? keys : {}));
}

/** The account's own API key for the provider, opened under the deployment's ring, nothing where it saved none, or unreadable where it does not open. */
function openedOwnKey(
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

/** The account's own API key for the provider, opened under the deployment's ring, or a Preview's stand-in for an admin, as above. */
export function ownApiKeyOf(
  userId: string,
  provider: ProviderKeyProvider,
  environment: AccountKeyEnvironment,
): TaskStoreEffect<OwnApiKey> {
  return Effect.gen(function* () {
    const own = yield* openedOwnKey(userId, provider, environment.providerKeyEncryptionKeys);
    if (Redacted.isRedacted(own)) return own;
    const standIns = yield* previewKeysOf(userId, environment);
    return standIns[provider] ?? own;
  });
}
