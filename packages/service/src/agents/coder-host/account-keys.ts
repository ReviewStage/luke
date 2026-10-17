import type { DatabaseServices } from "@luke/database/core/query";
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
import type { TaskStoreEffect, TaskStoreFailure } from "@luke/database/models/task-store";
import {
  type FastAccess,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeyProvider,
} from "@luke/features/provider-key-wire";
import { DateTime, Effect, type Redacted, Result } from "effect";
import { ModelCatalog } from "../../providers/model-catalog.js";
import type { WebStoreRun } from "../../run.js";
import type { MeterSeams } from "../agent-runtime/meter.js";
import type { LukeKeys, ProviderKey, ProviderKeys } from "./model.js";

/**
 * account-keys.ts -- the keys one account's coding-agent step runs on: its own where it saved one, Luke's where it did not.
 *
 * Read afresh for every step, so a key saved, replaced, or removed in
 * Settings is the one the agent's next step runs on. A provider the account
 * holds a row for runs on that row's key and never on Luke's: where the
 * deployment's ring cannot open the row, or the deployment holds no ring at
 * all, the provider answers unreadable and its steps are refused, so a key
 * the account meant to pay for is never quietly replaced by Luke's. Each
 * opened key carries where its status is reported, through the runner the
 * edge hands in, since the model's middleware that reports it is a promise
 * with no fiber to compose into.
 */

/** What the read is handed: Luke's own keys, the deployment's ring as its environment holds it, and the edge's runner for a report. */
export interface AccountKeysSeams {
  readonly luke: LukeKeys;
  /** The account's meter, which Luke's own keys carry (`../agent-runtime/meter.ts`). */
  readonly meter: (userId: string) => MeterSeams;
  readonly ring: Redacted.Redacted | undefined;
  readonly run: WebStoreRun;
}

/** The provider's key: the account's own opened, unreadable, or Luke's where the account holds none. */
function keyOf(
  userId: string,
  provider: ProviderKeyProvider,
  row: ProviderKeyRow | undefined,
  ring: KeyRing | undefined,
  seams: AccountKeysSeams,
): ProviderKey | typeof PROVIDER_KEY_UNREADABLE | undefined {
  if (row === undefined) {
    const luke =
      provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? seams.luke.anthropic : seams.luke.openAi;
    return luke === undefined ? undefined : { key: luke, meter: seams.meter(userId) };
  }
  if (ring === undefined) return PROVIDER_KEY_UNREADABLE;
  const opened = openProviderKey(ring, { userId, provider }, row);
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
  return Effect.map(listProviderKeyRows(userId), (rows) => {
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

/**
 * Whether the Anthropic key the account's steps run on may run fast mode, as
 * a step would choose that key: its own key's answer where it holds a row,
 * readable or not, and the instance's answer for Luke's key where it holds
 * none; nothing where no fast request has answered.
 */
export function anthropicFastAccess(
  userId: string,
): Effect.Effect<FastAccess | undefined, TaskStoreFailure, DatabaseServices | ModelCatalog> {
  return Effect.gen(function* () {
    const rows = yield* listProviderKeyRows(userId);
    const own = rows.find((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
    if (own !== undefined) return own.fastAccess ?? undefined;
    const catalog = yield* ModelCatalog;
    return yield* catalog.lukeFastAccess;
  });
}

/**
 * The key a call beside the account's steps spends on for one provider, as
 * a step would choose it: the account's own where it holds a row, and
 * Luke's where it holds none, with whether it is Luke's, which is counted on
 * the account's meter; nothing where neither stands or the account's row
 * cannot be opened, which leaves the call unmade rather than spend Luke's.
 */
export function spendingKeyOf(
  userId: string,
  provider: ProviderKeyProvider,
  luke: LukeKeys,
  ring: Redacted.Redacted | undefined,
): TaskStoreEffect<{ readonly key: Redacted.Redacted; readonly lukes: boolean } | undefined> {
  return Effect.map(listProviderKeyRows(userId), (rows) => {
    const row = rows.find((each) => each.provider === provider);
    if (row === undefined) {
      const lukes = provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? luke.anthropic : luke.openAi;
      return lukes === undefined ? undefined : { key: lukes, lukes: true };
    }
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) return undefined;
    const opened = openProviderKey(parsed.success, { userId, provider }, row);
    return Result.isFailure(opened) ? undefined : { key: opened.success, lukes: false };
  });
}
