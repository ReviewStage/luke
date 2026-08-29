import type { HostedVaultClient } from "@sidecar/account";
import type { CredentialProviderId } from "@sidecar/credentials";
import { isVaultProviderId, VAULT_PROVIDER_ID } from "@sidecar/hosted";

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

/**
 * Mirrors the local provider keys into the account's vault, entirely inside
 * the main process: a key on its way to or from the vault never enters the
 * renderer, and the vault client refuses on its own wherever no account
 * stands, which is also what keeps a fixture or evidence run silent.
 *
 * Every act here is the direct product of a hand on the panel — a key's own
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
 * touches, so an act outliving its sign-out goes quiet instead of landing on
 * whoever signed in next.
 */
export class ProviderKeyVaultSync {
  readonly #vault: HostedVaultClient;
  readonly #readStoredApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
  readonly #account: () => Promise<VaultSyncAccount | undefined>;
  readonly #tenant: {
    read: () => Promise<string | undefined>;
    write: (accountKey: string) => Promise<void>;
  };
  /**
   * Every act rides one chain, so saves and switch flips land on the vault
   * in the order the hands took them: a save mid-sweep, or a quick off-and-on
   * of the switch, cannot interleave into a vault that agrees with neither.
   */
  #acts: Promise<void> = Promise.resolve();

  constructor(options: {
    vault: HostedVaultClient;
    /**
     * The key stored in Luke's own encrypted file, and never one resolved
     * from the launch environment: an environment key was configured for
     * this machine's shell, not entered into Luke, so the sweep may not
     * send it anywhere.
     */
    readStoredApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
    /** The signed-in account's identity, or nothing signed out. */
    account: () => Promise<VaultSyncAccount | undefined>;
    /** Which account this Mac's keys were last synced for, persisted. */
    tenant: {
      read: () => Promise<string | undefined>;
      write: (accountKey: string) => Promise<void>;
    };
  }) {
    this.#vault = options.vault;
    this.#readStoredApiKey = options.readStoredApiKey;
    this.#account = options.account;
    this.#tenant = options.tenant;
  }

  #enqueue(act: () => Promise<void>): Promise<void> {
    const settled = this.#acts.then(act);
    // The chain never carries a refusal forward: every act is quiet on its
    // own, and one that threw must not still a queue of later hands.
    this.#acts = settled.catch(() => undefined);
    return settled;
  }

  /** A save landed locally; mirror it while the switch is on. */
  keySaved(providerId: CredentialProviderId, apiKey: string | undefined, syncOn: boolean) {
    return this.#enqueue(async () => {
      if (!isVaultProviderId(providerId)) return;
      const key = apiKey?.trim();
      if (!key) {
        // A cleared key clears its synced copy regardless of the switch: the
        // switch governs what goes up, never what may keep standing after
        // the developer deleted the thing it mirrors.
        await this.#vault.deleteKey(providerId);
        return;
      }
      if (!syncOn) return;
      const account = await this.#account();
      if (account === undefined) return;
      const stored = await this.#vault.storeKey(providerId, key);
      // Their own key, saved by their own hand: the save is also the claim.
      if (stored) await this.#tenant.write(tenantName(account));
    });
  }

  /**
   * The switch moved. Off deletes every synced copy, blindly, because a
   * delete of nothing answers `deleted: false` and costs nothing. On sweeps
   * every vault-provider key stored here up — at the flip itself as a claim
   * for the signed-in account, and at capabilities starting as the standing
   * reconcile, which uploads only for the account the keys were last synced
   * for. Whose account stands is re-read before every key, so a sweep that
   * outlives its sign-in writes nothing more.
   */
  apply(syncOn: boolean, options: { claim: boolean }): Promise<void> {
    return this.#enqueue(async () => {
      if (!syncOn) {
        for (const providerId of Object.values(VAULT_PROVIDER_ID)) {
          await this.#vault.deleteKey(providerId);
        }
        return;
      }
      const account = await this.#account();
      if (account === undefined) return;
      const tenant = await this.#tenant.read();
      // The record may hold either of the account's names — the id when the
      // sign-in carried one, else the address — and an identity refresh may
      // fill the id in later, so a match on either keeps the standing
      // reconcile standing rather than orphaning it on the stronger name.
      if (!options.claim && tenant !== undefined && !accountAnswersTo(account, tenant)) return;
      let storedAny = false;
      for (const providerId of Object.values(VAULT_PROVIDER_ID)) {
        if ((await this.#account())?.email !== account.email) return;
        const key = (await this.#readStoredApiKey(providerId))?.trim();
        if (key && (await this.#vault.storeKey(providerId, key))) storedAny = true;
      }
      // Only a sweep that actually moved a key claims the tenant: an empty
      // one says nothing about whose keys these are, and a claim it made
      // would let a passing sign-in inherit whatever is saved here later.
      if (storedAny) await this.#tenant.write(tenantName(account));
    });
  }
}
