/**
 * own-api-key.ts -- the API key one account saved for a provider, opened, and nothing where it saved none.
 *
 * Every model call Luke makes for an account outside a coding agent's step
 * (a voice call, a dictated clip) runs on the account's own key and never on
 * Luke's, since Luke pays for no model call. The key is read afresh on every
 * call, so one saved, replaced, or removed in Settings is the next call's.
 * A row the deployment's ring cannot open answers as no key, which leaves
 * the call unmade rather than spent on anything else.
 */

import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { PROVIDER_KEY_KIND, type ProviderKeyProvider } from "@luke/features/provider-key-wire";
import { Effect, type Redacted, Result } from "effect";

/** The account's own API key for the provider, opened under the deployment's ring; nothing where it holds none or the ring cannot open it. */
export function ownApiKeyOf(
  userId: string,
  provider: ProviderKeyProvider,
  ring: Redacted.Redacted | undefined,
): TaskStoreEffect<Redacted.Redacted | undefined> {
  return Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY), (rows) => {
    const row = rows.find((each) => each.provider === provider);
    if (row === undefined || ring === undefined) return undefined;
    const parsed = parseKeyRing(ring);
    if (Result.isFailure(parsed)) return undefined;
    const opened = openProviderKey(
      parsed.success,
      { userId, provider, kind: PROVIDER_KEY_KIND.API_KEY },
      row,
    );
    return Result.isFailure(opened) ? undefined : opened.success;
  });
}
