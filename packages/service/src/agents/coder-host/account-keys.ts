import { openProviderKey, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows, type ProviderKeyRow } from "@repo/database/models/provider-key-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@repo/features/provider-key-wire";
import { Effect, type Redacted, Result } from "effect";
import type { OwnKey } from "./model.js";

/**
 * account-keys.ts -- the key a call beside one account's agents runs on: its own API key, and never ours.
 *
 * Read afresh for every call, so a key saved, replaced, or removed in
 * Settings is the one the next call spends. Only API keys are read here;
 * a row the deployment's ring cannot open, or one on a deployment holding
 * no ring at all, is no key, and nothing falls back to our own.
 */

/** The row's key opened under the ring, or nothing where the ring is missing or cannot open it. */
function openedRow(
  userId: string,
  row: ProviderKeyRow,
  ring: Redacted.Redacted | undefined,
): Redacted.Redacted | undefined {
  const parsed = ring === undefined ? undefined : parseKeyRing(ring);
  if (parsed === undefined || Result.isFailure(parsed)) return undefined;
  const owner = { userId, provider: row.provider, kind: PROVIDER_KEY_KIND.API_KEY };
  const opened = openProviderKey(parsed.success, owner, row);
  return Result.isFailure(opened) ? undefined : opened.success;
}

/**
 * The account's own API key a call beside its agents spends on, such as an
 * agent's title, a pull request's chapters, or a replay's summary: the
 * preferred provider's where the account saved one that opens, the other
 * provider's otherwise, and nothing where it holds neither, which leaves
 * the call unmade. Our own key is never one.
 */
export function ownKeyOf(
  userId: string,
  preferred: ProviderKeyProvider,
  ring: Redacted.Redacted | undefined,
): TaskStoreEffect<OwnKey | undefined> {
  return Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY), (rows) => {
    const order = [
      preferred,
      ...Object.values(PROVIDER_KEY_PROVIDER).filter((other) => other !== preferred),
    ];
    for (const provider of order) {
      const row = rows.find((each) => each.provider === provider);
      const key = row === undefined ? undefined : openedRow(userId, row, ring);
      if (key !== undefined) return { provider, key };
    }
    return undefined;
  });
}
