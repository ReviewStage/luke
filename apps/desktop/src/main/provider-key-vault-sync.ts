import type { HostedVaultClient } from "@sidecar/account";
import type { CredentialProviderId } from "@sidecar/credentials";
import { isVaultProviderId, VAULT_PROVIDER_ID } from "@sidecar/hosted";

/**
 * Mirrors the local provider keys into the account's vault, entirely inside
 * the main process: a key on its way to or from the vault never enters the
 * renderer, and the vault client refuses on its own wherever no account
 * stands, which is also what keeps a fixture or evidence run silent.
 *
 * Every act here is the direct product of a hand on the panel — a key's own
 * Save or delete, or the Sync provider keys switch moving — never a timer or
 * anything a model decided. The one read of a stored key this module makes,
 * the sweep's, exists because the switch's turning on is the developer asking
 * for exactly that: the keys already stored here, synced. A failure is quiet
 * by design; the local key is the working one either way, and the next save
 * or flip of the switch is the retry.
 */
export class ProviderKeyVaultSync {
  readonly #vault: HostedVaultClient;
  readonly #readStoredApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
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
  }) {
    this.#vault = options.vault;
    this.#readStoredApiKey = options.readStoredApiKey;
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
      if (key) {
        if (syncOn) await this.#vault.storeKey(providerId, key);
        return;
      }
      // A cleared key clears its synced copy regardless of the switch: the
      // switch governs what goes up, never what may keep standing after the
      // developer deleted the thing it mirrors.
      await this.#vault.deleteKey(providerId);
    });
  }

  /**
   * The switch moved. On sweeps every vault-provider key stored here up;
   * off deletes every synced copy, blindly, because a delete of nothing
   * answers `deleted: false` and costs nothing.
   */
  apply(syncOn: boolean): Promise<void> {
    return this.#enqueue(async () => {
      for (const providerId of Object.values(VAULT_PROVIDER_ID)) {
        if (!syncOn) {
          await this.#vault.deleteKey(providerId);
          continue;
        }
        const key = (await this.#readStoredApiKey(providerId))?.trim();
        if (key) await this.#vault.storeKey(providerId, key);
      }
    });
  }
}
