import {
  type AccountPreferenceField,
  type AccountPreferences,
  type AccountPreferencesAnswer,
  accountPreferencesEmpty,
  sameAccountPreferences,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "#shared/contracts";

export interface AccountPreferencesSyncAccount {
  email: string;
}

export interface AccountPreferencesSyncStore {
  accountPreferences(): Promise<AccountPreferences>;
  applyAccountPreferences(
    preferences: AccountPreferences,
  ): Promise<SettingsUpdateResult & { changed: readonly AccountPreferenceField[] }>;
}

export interface AccountPreferencesClientLike {
  readPreferences(): Promise<AccountPreferencesAnswer | undefined>;
  writePreferences(preferences: AccountPreferences): Promise<AccountPreferencesAnswer | undefined>;
}

/**
 * Keeps the account preference snapshot and this Mac's local store in
 * sync. Pulling runs when account capabilities start; pushing runs only after
 * a local setting write that already succeeded. The hosted client owns bearer
 * refresh and account retry guards, so this class only decides direction.
 */
export class AccountPreferencesSync {
  readonly #client: AccountPreferencesClientLike;
  readonly #settings: AccountPreferencesSyncStore;
  readonly #account: () => Promise<AccountPreferencesSyncAccount | undefined>;
  readonly #applied: (
    result: SettingsUpdateResult,
    changed: readonly AccountPreferenceField[],
  ) => void | Promise<void>;
  #acts: Promise<void> = Promise.resolve();

  constructor(options: {
    client: AccountPreferencesClientLike;
    settings: AccountPreferencesSyncStore;
    account: () => Promise<AccountPreferencesSyncAccount | undefined>;
    applied: (
      result: SettingsUpdateResult,
      changed: readonly AccountPreferenceField[],
    ) => void | Promise<void>;
  }) {
    this.#client = options.client;
    this.#settings = options.settings;
    this.#account = options.account;
    this.#applied = options.applied;
  }

  reconcile(): Promise<void> {
    return this.#enqueue(async () => {
      const account = await this.#account();
      if (account === undefined) return;
      const localBeforeRead = await this.#settings.accountPreferences();
      const remote = await this.#client.readPreferences();
      if (remote === undefined) return;
      if (!(await this.#sameAccount(account))) return;
      const localAfterRead = await this.#settings.accountPreferences();

      if (remote.updatedAt === undefined) {
        if (!accountPreferencesEmpty(localAfterRead) && (await this.#sameAccount(account))) {
          await this.#client.writePreferences(localAfterRead);
        }
        return;
      }

      if (!sameAccountPreferences(localBeforeRead, localAfterRead)) return;
      const result = await this.#settings.applyAccountPreferences(remote.preferences);
      if (result.changed.length === 0 || !(await this.#sameAccount(account))) return;
      await this.#applied(result, result.changed);
    });
  }

  preferencesChanged(): Promise<void> {
    return this.#enqueue(async () => {
      const account = await this.#account();
      if (account === undefined) return;
      const preferences = await this.#settings.accountPreferences();
      if (!(await this.#sameAccount(account))) return;
      await this.#client.writePreferences(preferences);
    });
  }

  #enqueue(act: () => Promise<void>): Promise<void> {
    const settled = this.#acts.then(act);
    this.#acts = settled.catch(() => undefined);
    return settled;
  }

  async #sameAccount(account: AccountPreferencesSyncAccount): Promise<boolean> {
    return (await this.#account())?.email === account.email;
  }
}
