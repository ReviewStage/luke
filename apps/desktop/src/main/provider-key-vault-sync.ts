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
  readonly #readApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;

  constructor(options: {
    vault: HostedVaultClient;
    readApiKey: (providerId: CredentialProviderId) => Promise<string | undefined>;
  }) {
    this.#vault = options.vault;
    this.#readApiKey = options.readApiKey;
  }

  /** A save landed locally; mirror it while the switch is on. */
  async keySaved(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
    syncOn: boolean,
  ): Promise<void> {
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
  }

  /**
   * The switch moved. On sweeps every locally held vault-provider key up;
   * off deletes every synced copy, blindly, because a delete of nothing
   * answers `deleted: false` and costs nothing.
   */
  async apply(syncOn: boolean): Promise<void> {
    for (const providerId of Object.values(VAULT_PROVIDER_ID)) {
      if (!syncOn) {
        await this.#vault.deleteKey(providerId);
        continue;
      }
      const key = (await this.#readApiKey(providerId))?.trim();
      if (key) await this.#vault.storeKey(providerId, key);
    }
  }
}
