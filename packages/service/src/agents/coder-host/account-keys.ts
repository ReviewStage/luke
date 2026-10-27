import {
  type KeyRing,
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  parseKeyRing,
} from "@luke/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  type ProviderKeyRow,
  setProviderKeyFastAccess,
  setProviderKeyStatus,
} from "@luke/database/models/provider-key-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@luke/features/provider-key-wire";
import { DateTime, Effect, type Redacted, Result } from "effect";
import type { WebStoreRun } from "../../run.js";
import type { OwnKey, ProviderKey, ProviderKeys } from "./model.js";

/**
 * account-keys.ts -- the keys one account's coding-agent step, and every call beside its agents, runs on: its own API keys, and never Luke's.
 *
 * Read afresh for every step, so a key saved, replaced, or removed in
 * Settings is the one the agent's next step runs on. A provider the account
 * holds a row for runs on that row's key; one it holds none for is absent,
 * so its steps are refused as having no key, and nothing falls back to
 * Luke's own. Where the deployment's ring cannot open the row, or the
 * deployment holds no ring at all, the provider answers unreadable and its
 * steps are refused too. Only
 * API keys are read here; a subscription credential runs no eve step. Each
 * opened key carries where its status is reported, through the runner the
 * edge hands in, since the model's middleware that reports it is a promise
 * with no fiber to compose into.
 */

/** What the read is handed: the deployment's ring as its environment holds it, and the edge's runner for a report. */
export interface AccountKeysSeams {
  readonly ring: Redacted.Redacted | undefined;
  readonly run: WebStoreRun;
}

/** The provider's key: the account's own opened, unreadable, or none where the account holds no row. */
function keyOf(
  userId: string,
  provider: ProviderKeyProvider,
  row: ProviderKeyRow | undefined,
  ring: KeyRing | undefined,
  seams: AccountKeysSeams,
): ProviderKey | typeof PROVIDER_KEY_UNREADABLE | undefined {
  if (row === undefined) return undefined;
  if (ring === undefined) return PROVIDER_KEY_UNREADABLE;
  const opened = openProviderKey(ring, { userId, provider, kind: PROVIDER_KEY_KIND.API_KEY }, row);
  if (Result.isFailure(opened)) return PROVIDER_KEY_UNREADABLE;
  return {
    key: opened.success,
    account: {
      status: row.status,
      report: (status) =>
        seams.run(
          Effect.flatMap(DateTime.nowAsDate, (now) =>
            setProviderKeyStatus(userId, provider, row.sealedKey, status, now),
          ),
        ),
      ...(row.fastAccess === null ? undefined : { fastAccess: row.fastAccess }),
      reportFast: (access) =>
        seams.run(setProviderKeyFastAccess(userId, provider, row.sealedKey, access)),
    },
  };
}

/** The keys the account's step runs on, read from its rows now. */
export function accountProviderKeys(
  userId: string,
  seams: AccountKeysSeams,
): TaskStoreEffect<ProviderKeys> {
  return Effect.map(listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY), (rows) => {
    const parsed = seams.ring === undefined ? undefined : parseKeyRing(seams.ring);
    const ring = parsed !== undefined && Result.isSuccess(parsed) ? parsed.success : undefined;
    const rowOf = (provider: ProviderKeyProvider) => rows.find((row) => row.provider === provider);
    return {
      anthropic: keyOf(
        userId,
        PROVIDER_KEY_PROVIDER.ANTHROPIC,
        rowOf(PROVIDER_KEY_PROVIDER.ANTHROPIC),
        ring,
        seams,
      ),
      openAi: keyOf(
        userId,
        PROVIDER_KEY_PROVIDER.OPENAI,
        rowOf(PROVIDER_KEY_PROVIDER.OPENAI),
        ring,
        seams,
      ),
    };
  });
}

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
 * the call unmade. Luke's own key is never one.
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
