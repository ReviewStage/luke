import type { CredentialProviderId } from "@sidecar/credentials";
import type { HostedVaultClient } from "@sidecar/hosted";
import { CLOUD_AGENT_PROVIDER_ID, isCloudAgentProviderId } from "@sidecar/session";
import { Cause, Effect, Queue } from "effect";

/** The signed-in account, by the names the tenant record may hold it under. */
export interface VaultSyncAccount {
  id?: string;
  email: string;
}

/** The strongest name an account offers, for writing the tenant record. */
function tenantName(account: VaultSyncAccount): string {
  return account.id ?? account.email;
}

/** Whether a tenant record names this account, under either of its names. */
function accountAnswersTo(account: VaultSyncAccount, tenant: string): boolean {
  return tenant === account.id || tenant === account.email;
}

export interface ProviderKeyVaultSyncOptions {
  vault: HostedVaultClient;
  /**
   * The key stored in Luke's own encrypted file, and never one resolved
   * from the launch environment: an environment key was configured for
   * this machine's shell, not entered into Luke, so the sweep may not
   * send it anywhere.
   */
  readStoredApiKey: (
    providerId: CredentialProviderId,
  ) => Effect.Effect<string | undefined, unknown>;
  /** The signed-in account's identity, or nothing signed out. */
  account: () => Effect.Effect<VaultSyncAccount | undefined, unknown>;
  /** Which account this Mac's keys were last synced for, persisted. */
  tenant: {
    read: () => Effect.Effect<string | undefined, unknown>;
    write: (accountKey: string) => Effect.Effect<void, unknown>;
  };
}

export interface ProviderKeyVaultSync {
  /** A save landed locally; mirror it while the switch is on. */
  keySaved: (
    providerId: CredentialProviderId,
    apiKey: string | undefined,
    syncOn: boolean,
  ) => Effect.Effect<void>;
  /**
   * The switch moved. Off deletes every synced copy, blindly, because a
   * delete of nothing answers `deleted: false` and costs nothing. On sweeps
   * every vault-provider key stored here up — at the flip itself as a claim
   * for the signed-in account, and at capabilities starting as the standing
   * reconcile, which uploads only for the account the keys were last synced
   * for. Whose account stands is re-read before every key, so a sweep that
   * outlives its sign-in writes nothing more.
   */
  apply: (syncOn: boolean, options: { claim: boolean }) => Effect.Effect<void>;
  /**
   * The one chain every action rides, for as long as the fiber running it
   * stands. A failure is dropped rather than carried forward: every action is
   * quiet on its own, and one that failed must not still the hands behind it.
   */
  readonly actions: Effect.Effect<never>;
}

/**
 * Mirrors the local provider keys into the account's vault, entirely inside
 * the main process: a key on its way to or from the vault never enters the
 * renderer, and the vault client refuses on its own wherever no account
 * stands, which is also what keeps a fixture or evidence run silent.
 *
 * Every action here is the direct product of a hand on the panel — a key's own
 * Save or delete, or the Sync provider keys switch moving — or the standing
 * state that switch declares, reconciled when account capabilities start.
 * The one read of a stored key this module makes exists because the switch
 * says so, and it reads only keys entered into Luke, never the environment's.
 * A failure is quiet by design; the local key is the working one either way,
 * and the next save, flip, or launch is the retry.
 *
 * The keys live in a machine-wide store while the vault is an account's, and
 * the tenant record is what keeps that from becoming a leak: an automatic
 * reconcile uploads only for the account the keys were last synced for, so a
 * different person signing in on this Mac inherits nothing. Only a hand can
 * claim the keys for a new account — the switch's own flip, or a key's own
 * save — and every sweep re-checks whose account stands before each key it
 * touches, so an action outliving its sign-out goes quiet instead of landing on
 * whoever signed in next.
 *
 * Every action rides one queue, so saves and switch flips land on the vault in
 * the order the hands took them: a save mid-sweep, or a quick off-and-on of
 * the switch, cannot interleave into a vault that agrees with neither.
 */
export const providerKeyVaultSync = (
  options: ProviderKeyVaultSyncOptions,
): Effect.Effect<ProviderKeyVaultSync> =>
  Effect.gen(function* () {
    const queued = yield* Queue.unbounded<Effect.Effect<void, unknown>>();
    const enqueue = (act: Effect.Effect<void, unknown>): Effect.Effect<void> =>
      Effect.asVoid(Queue.offer(queued, act));

    const keySaved: ProviderKeyVaultSync["keySaved"] = (providerId, apiKey, syncOn) =>
      enqueue(
        Effect.gen(function* () {
          if (!isCloudAgentProviderId(providerId)) return;
          const key = apiKey?.trim();
          if (!key) {
            // A cleared key clears its synced copy regardless of the switch: the
            // switch governs what goes up, never what may keep standing after
            // the developer deleted the thing it mirrors.
            yield* Effect.promise(() => options.vault.deleteKey(providerId));
            return;
          }
          if (!syncOn) return;
          const account = yield* options.account();
          if (account === undefined) return;
          const stored = yield* Effect.promise(() => options.vault.storeKey(providerId, key));
          // Their own key, saved by their own hand: the save is also the claim.
          if (stored) yield* options.tenant.write(tenantName(account));
        }),
      );

    const apply: ProviderKeyVaultSync["apply"] = (syncOn, { claim }) =>
      enqueue(
        Effect.gen(function* () {
          if (!syncOn) {
            for (const providerId of Object.values(CLOUD_AGENT_PROVIDER_ID)) {
              yield* Effect.promise(() => options.vault.deleteKey(providerId));
            }
            return;
          }
          const account = yield* options.account();
          if (account === undefined) return;
          const tenant = yield* options.tenant.read();
          // The record may hold either of the account's names — the id when the
          // sign-in carried one, else the address — and an identity refresh may
          // fill the id in later, so a match on either keeps the standing
          // reconcile standing rather than orphaning it on the stronger name.
          if (!claim && tenant !== undefined && !accountAnswersTo(account, tenant)) return;
          let storedAny = false;
          for (const providerId of Object.values(CLOUD_AGENT_PROVIDER_ID)) {
            if ((yield* options.account())?.email !== account.email) return;
            const key = (yield* options.readStoredApiKey(providerId))?.trim();
            if (key && (yield* Effect.promise(() => options.vault.storeKey(providerId, key)))) {
              storedAny = true;
            }
          }
          // Only a sweep that actually moved a key claims the tenant: an empty
          // one says nothing about whose keys these are, and a claim it made
          // would let a passing sign-in inherit whatever is saved here later.
          if (storedAny) yield* options.tenant.write(tenantName(account));
        }),
      );

    const actions = Queue.take(queued).pipe(
      Effect.flatMap((act) =>
        Effect.catchAllCause(act, (cause) =>
          // An interruption is the fiber being ended rather than an action
          // going wrong, so it stands; every other way an action could not be
          // carried, a defect included, is the quiet the next hand retries.
          Cause.isInterruptedOnly(cause) ? Effect.interrupt : Effect.void,
        ),
      ),
      Effect.forever,
    );

    return { keySaved, apply, actions };
  });
