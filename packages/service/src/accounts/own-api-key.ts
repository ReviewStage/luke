import {
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  type ProviderKeyUnreadable,
  parseKeyRing,
} from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import { PROVIDER_KEY_KIND, type ProviderKeyProvider } from "@repo/features/provider-key-wire";
import { Effect, type Redacted, Result } from "effect";

export type OwnApiKey = Redacted.Redacted | ProviderKeyUnreadable | undefined;

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
