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
