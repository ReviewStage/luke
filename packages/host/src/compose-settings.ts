import {
  PRODUCT_EVENT,
  type ProductEventPropertiesFor,
  ProductEventSender,
  productEventFromWire,
  type RecordProductEvent,
} from "@sidecar/analytics";
import {
  CREDENTIAL_PROVIDER_ID,
  type CredentialProviderId,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
  invalid,
} from "@sidecar/gateway";
import { HostedVaultClient } from "@sidecar/hosted";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  isAppSettingField,
  isKeyedAppSettingField,
  isSettingEntryKey,
  isSettingsResetScope,
  type SettingEntryValue,
  settingAnalytics,
  settingEntryGuard,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, isWireString, lateRef, type UnparsedWireValue } from "@sidecar/wire";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { ProviderKeyVaultSync, type VaultSyncAccount } from "./provider-key-vault-sync.js";
import { hostSettingSideEffects } from "./settings-side-effects.js";
import { SettingsStore } from "./settings-store.js";
import { reporterOf } from "./wire-helpers.js";

type StoredSettings = SettingsUpdateResult["settings"]["stored"];

/**
 * What the settings write path reaches in the other concerns. Every one of
 * them is a genuine back-edge: a setting is where the developer changes what
 * a loop, a credential, or a voice does, so the write cannot be the leaf of
 * the graph however much simpler that would be.
 */
interface SettingsLinks {
  refreshAccount: () => Promise<void>;
  applyVoiceCredential: () => Promise<void>;
  setVoice: (voice: StoredSettings["voice"]) => void;
  setVoiceSpeed: (speed: StoredSettings["voiceSpeed"]) => void;
  reconcileSpeech: () => void;
  refreshSupersetWorkspaceHost: () => Promise<void>;
  broadcastWorkspaceProjects: () => Promise<void>;
  /** One provider's sessions read again after its key changed. */
  refreshCredentialAdapter: (providerId: CredentialProviderId) => void;
  refreshIssues: () => void;
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
}

export interface SettingsComposer extends Composer {
  readonly store: SettingsStore;
  readonly recordProductEvent: RecordProductEvent;
  /** One count per provider per day, as the observation pass makes it. */
  recordProductEventOncePerDay: ProductEventSender["recordOncePerDay"];
  emitSettingsSnapshot: (settings: SettingsUpdateResult["settings"], reporter?: string) => void;
  emitSettings: () => Promise<void>;
  refusedSettings: (reason: string) => Promise<SettingsUpdateResult>;
  settingsWrite: (
    save: () => Promise<SettingsUpdateResult>,
    apply: (result: SettingsUpdateResult) => Promise<void> | void,
    refusal: string,
    reporter: string | undefined,
  ) => Promise<SettingsUpdateResult>;
  reconcileProviderKeyVault: () => void;
  reconcileAccountPreferences: () => Promise<void>;
  /** The developer's own preference write, on its way to the account behind it. */
  pushAccountPreferences: () => void;
  /** The account behind the hydrated preferences changed; the next push hydrates again. */
  forgetAccountPreferenceHydration: () => void;
  /** The count the account actions flush before they end the account they are authenticated with. */
  flushProductEvents: () => Promise<void>;
  link: (links: SettingsLinks) => void;
}

export interface SettingsDependencies {
  kernel: HostKernel;
}

export function composeSettings(dependencies: SettingsDependencies): SettingsComposer {
  const { kernel } = dependencies;
  const { runMode, report, options } = kernel;
  const links = lateRef<SettingsLinks>("the settings composer's links");

  const store = new SettingsStore({
    directory: () => kernel.stateRoot,
    // A fixture or evidence run refuses the credentials it resolves, so nothing is
    // reported as available that would not actually happen.
    credentialsUsable: runMode.observesProviders,
    cipher: options.cipher,
    environment: options.environment,
  });

  const productEvents = new ProductEventSender({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    appVersion: options.appVersion,
    sends: runMode.sendsNetwork,
    readAccessToken: async () => (await store.readAccount())?.accessToken,
    refreshAccount: () => links.get().refreshAccount(),
    readAccountKey: async () => (await store.readAccount())?.email,
  });
  const hostedVault = new HostedVaultClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    readAccessToken: async () =>
      runMode.sendsNetwork ? (await store.readAccount())?.accessToken : undefined,
    refreshAccount: () => links.get().refreshAccount(),
    readAccountKey: async () => (await store.readAccount())?.email,
  });
  const accountPreferencesClient = new AccountPreferencesClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    readAccessToken: async () =>
      runMode.sendsNetwork ? (await store.readAccount())?.accessToken : undefined,
    refreshAccount: () => links.get().refreshAccount(),
    readAccountKey: readAccountPreferenceAccountKey,
  });
  const vaultSync = new ProviderKeyVaultSync({
    vault: hostedVault,
    readStoredApiKey: (providerId) => store.readStoredApiKey(providerId),
    account: async () => {
      const held = await store.readAccount();
      if (!held) return undefined;
      const vaultAccount: VaultSyncAccount = { email: held.email };
      if (held.id) vaultAccount.id = held.id;
      return vaultAccount;
    },
    tenant: {
      read: () => store.readVaultSyncAccount(),
      write: (accountKey) => store.setVaultSyncAccount(accountKey),
    },
  });

  let accountPreferencesHydratedAccount: string | undefined;
  let accountPreferencesSync: Promise<void> = Promise.resolve();

  function reconcileProviderKeyVault(): void {
    void store
      .snapshot()
      .then((settings) =>
        settings.stored.syncProviderKeys ? vaultSync.apply(true, { claim: false }) : undefined,
      );
  }

  async function readAccountPreferenceAccountKey(): Promise<string | undefined> {
    return (await store.readAccount())?.email;
  }

  function queueAccountPreferencesSync(label: string, work: () => Promise<void>): Promise<void> {
    const queued = accountPreferencesSync.then(work, work).catch((error) => {
      report(
        `Account preferences ${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    accountPreferencesSync = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  function accountPreferencesEmpty(preferences: AccountPreferences): boolean {
    return Object.keys(preferences).length === 0;
  }

  function accountPreferencesSame(left: AccountPreferences, right: AccountPreferences): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  async function accountPreferenceHydrationBaseline(
    accountEmail: string,
  ): Promise<AccountPreferences> {
    const baseline = await store.accountPreferencesSyncBaseline(accountEmail);
    if (baseline !== undefined) return baseline;
    const preferences = await store.accountPreferences();
    await store.setAccountPreferencesSyncBaseline(accountEmail, preferences);
    return preferences;
  }

  function isAccountPreferenceField(field: AppSettingField): field is AccountPreferenceField {
    return ACCOUNT_PREFERENCE_FIELDS.some((candidate) => candidate === field);
  }

  function resetTouchesAccountPreferences(scope: UnparsedWireValue): boolean {
    return ACCOUNT_PREFERENCE_FIELDS.some((field) => {
      const definition = APP_SETTING_SCHEMA[field];
      return "resetScope" in definition && definition.resetScope === scope;
    });
  }

  async function reconcileAccountPreferences(): Promise<void> {
    return queueAccountPreferencesSync("reconcile", async () => {
      const accountKey = await readAccountPreferenceAccountKey();
      if (!accountKey) return;
      await hydrateAccountPreferences(accountKey);
    });
  }

  async function hydrateAccountPreferences(accountKey: string): Promise<boolean> {
    const baseline = await accountPreferenceHydrationBaseline(accountKey);
    if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
    const remote = await accountPreferencesClient.readPreferences();
    if (!remote || (await readAccountPreferenceAccountKey()) !== accountKey) return false;

    if (!remote.hasStoredSnapshot) {
      const preferences = await store.accountPreferences();
      if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
      if (!accountPreferencesEmpty(preferences)) {
        const written = await accountPreferencesClient.writePreferences(preferences);
        if (!written || (await readAccountPreferenceAccountKey()) !== accountKey) return false;
      }
      if (!(await store.setAccountPreferencesSyncBaseline(accountKey, preferences))) {
        return false;
      }
      accountPreferencesHydratedAccount = accountKey;
      return true;
    }

    const saved = await store.applyAccountPreferences(remote.preferences, {
      accountEmail: accountKey,
      preferences: baseline,
    });
    if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
    accountPreferencesHydratedAccount = accountKey;
    const preferences = await store.accountPreferences();
    if ((await readAccountPreferenceAccountKey()) !== accountKey) return false;
    if (saved.changed.length > 0) {
      await applyAccountPreferenceSideEffects(saved, saved.changed);
    }
    if (!accountPreferencesSame(preferences, remote.preferences)) {
      const written = await accountPreferencesClient.writePreferences(preferences);
      if (!written || (await readAccountPreferenceAccountKey()) !== accountKey) return true;
    }
    await store.setAccountPreferencesSyncBaseline(accountKey, preferences);
    return true;
  }

  function pushAccountPreferences(): void {
    void queueAccountPreferencesSync("write", async () => {
      const accountKey = await readAccountPreferenceAccountKey();
      if (!accountKey) return;
      if (
        accountPreferencesHydratedAccount !== accountKey &&
        !(await hydrateAccountPreferences(accountKey))
      ) {
        return;
      }
      const preferences = await store.accountPreferences();
      if (
        (await readAccountPreferenceAccountKey()) !== accountKey ||
        accountPreferencesHydratedAccount !== accountKey
      ) {
        return;
      }
      const written = await accountPreferencesClient.writePreferences(preferences);
      if (!written || (await readAccountPreferenceAccountKey()) !== accountKey) return;
      await store.setAccountPreferencesSyncBaseline(accountKey, preferences);
    });
  }

  const recordProductEvent: RecordProductEvent = (name, properties) =>
    productEvents.record(name, properties);

  function emitSettingsSnapshot(
    settings: SettingsUpdateResult["settings"],
    reporter?: string,
  ): void {
    kernel.emit(GATEWAY_EVENT.SETTINGS_CHANGED, {
      settings: carried(settings),
      ...(reporter !== undefined ? { reporter } : undefined),
    });
  }

  async function emitSettings(): Promise<void> {
    emitSettingsSnapshot(await store.snapshot());
  }

  function recordSettingUpdate(field: AppSettingField, settings: SettingsUpdateResult["settings"]) {
    const analytics = settingAnalytics(field, settings.stored);
    if (!analytics) return;
    recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
      setting_id: analytics.id,
      setting_value: analytics.value,
    });
  }

  const sideEffects = hostSettingSideEffects({
    setVoice: (voice) => links.get().setVoice(voice),
    setVoiceSpeed: (speed) => links.get().setVoiceSpeed(speed),
    applyVoiceCredential: () => links.get().applyVoiceCredential(),
    reconcileSpeech: () => links.get().reconcileSpeech(),
    applyVaultSync: (syncProviderKeys) => void vaultSync.apply(syncProviderKeys, { claim: true }),
    emitSettings,
  });

  async function applyHostSettingSideEffect(
    field: AppSettingField,
    settings: SettingsUpdateResult["settings"],
  ): Promise<void> {
    await sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({ settings: settings.stored });
  }

  async function applyAccountPreferenceSideEffects(
    result: SettingsUpdateResult,
    changed: readonly AccountPreferenceField[],
  ): Promise<void> {
    for (const field of changed) {
      await applyHostSettingSideEffect(field, result.settings);
    }
    const workspaceAgentDefaultsChanged = changed.includes(
      APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
    );
    if (workspaceAgentDefaultsChanged) {
      await links.get().refreshSupersetWorkspaceHost();
    }
    if (
      workspaceAgentDefaultsChanged ||
      changed.includes(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field) ||
      changed.includes(APP_SETTING_SCHEMA.workspaceProjectDefaults.field)
    ) {
      await links.get().broadcastWorkspaceProjects();
    }
    emitSettingsSnapshot(result.settings);
  }

  const refusedSettings = async (reason: string): Promise<SettingsUpdateResult> => ({
    status: ACTION_RESULT_STATUS.REJECTED,
    settings: await store.snapshot(),
    reason,
  });

  /** Runs one settings write and, when it landed, its host side effects and the change event. */
  async function settingsWrite(
    save: () => Promise<SettingsUpdateResult>,
    apply: (result: SettingsUpdateResult) => Promise<void> | void,
    refusal: string,
    reporter: string | undefined,
  ): Promise<SettingsUpdateResult> {
    let saved: SettingsUpdateResult;
    try {
      saved = await save();
      await apply(saved);
    } catch {
      return refusedSettings(refusal);
    }
    emitSettingsSnapshot(saved.settings, reporter);
    return saved;
  }

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.SETTINGS_SNAPSHOT]: async () =>
      gatewayOk({ settings: carried(await store.snapshot()) }),
    [GATEWAY_METHOD.SETTINGS_UPDATE]: async (params) => {
      const field = params.field;
      if (!isAppSettingField(field) || isKeyedAppSettingField(field)) {
        return invalid("field must name a plain setting");
      }
      const parsed = APP_SETTING_SCHEMA[field].guard(params.value);
      if (!parsed.valid) return invalid("value is not the shape that setting takes");
      const result = await settingsWrite(
        () => store.set(field, parsed.value),
        async (saved) => {
          if (saved.reason) return;
          recordSettingUpdate(field, saved.settings);
          await applyHostSettingSideEffect(field, saved.settings);
        },
        "Could not save that setting on this system.",
        reporterOf(params),
      );
      if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY]: async (params) => {
      const field = params.field;
      if (!isKeyedAppSettingField(field)) return invalid("field must name a keyed setting");
      const key = params.key;
      if (!isSettingEntryKey(field, key)) return invalid("key is not one that setting takes");
      // SAFETY: the guard is the parser; a wire value is one it reads.
      const parsed = settingEntryGuard(field, key, params.value as UnparsedWireValue);
      if (!parsed.valid) return invalid("value is not the shape that entry takes");
      // SAFETY: settingEntryGuard validated workspace project defaults as a wire string.
      const projectWire = parsed.value as UnparsedWireValue;
      if (
        field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field &&
        isWireString(projectWire) &&
        !links.get().workspaceProjectOffered(key, projectWire)
      ) {
        return invalid("that project is not one a provider offers");
      }
      const result = await settingsWrite(
        // SAFETY: settingEntryGuard validated the entry before it reaches the store.
        () => store.setEntry(field, key, parsed.value as SettingEntryValue<typeof field>),
        async (saved) => {
          if (saved.reason) return;
          recordSettingUpdate(field, saved.settings);
          await applyHostSettingSideEffect(field, saved.settings);
        },
        "Could not save that setting on this system.",
        reporterOf(params),
      );
      if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.SETTINGS_RESET]: async (params) => {
      const scope = params.scope;
      if (!isSettingsResetScope(scope)) return invalid("scope is not one this build knows");
      const result = await settingsWrite(
        () => store.resetSettings(scope),
        async (saved) => {
          if (saved.reason) return;
          recordProductEvent(PRODUCT_EVENT.SETTINGS_RESET, {});
          for (const field of APP_SETTING_FIELDS) {
            const definition = APP_SETTING_SCHEMA[field];
            if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
            await applyHostSettingSideEffect(field, saved.settings);
          }
        },
        "Could not reset those settings on this system.",
        reporterOf(params),
      );
      if (!result.reason && resetTouchesAccountPreferences(scope)) pushAccountPreferences();
      return gatewayOk(carried(result));
    },
    [GATEWAY_METHOD.CREDENTIAL_SET_API_KEY]: async (params) => {
      const providerId = params.providerId;
      if (!isCredentialProviderId(providerId))
        return invalid("providerId is not one this build knows");
      if (params.apiKey !== undefined && !isWireString(params.apiKey)) {
        return invalid("apiKey must be a string");
      }
      const apiKey = params.apiKey;
      const result = await settingsWrite(
        () => store.setApiKey(providerId, apiKey),
        async (saved) => {
          if (saved.reason) return;
          links.get().refreshCredentialAdapter(providerId);
          if (providerId === CREDENTIAL_PROVIDER_ID.LINEAR) links.get().refreshIssues();
          if (providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
            await links.get().applyVoiceCredential();
            await emitSettings();
          }
          void vaultSync.keySaved(providerId, apiKey, saved.settings.stored.syncProviderKeys);
          recordProductEvent(
            apiKey?.trim() ? PRODUCT_EVENT.PROVIDER_CONNECT : PRODUCT_EVENT.PROVIDER_DISCONNECT,
            { connection_id: providerId },
          );
        },
        "Could not save that API key on this system.",
        reporterOf(params),
      );
      return gatewayOk(carried(result));
    },
    // A count the client's own surfaces made: read against the allowlist
    // again here, and queued only when it reads. Nothing observed can travel
    // in one, because the reader builds the event from the allowlist rather
    // than from what arrived.
    [GATEWAY_METHOD.ANALYTICS_RECORD]: (params) => {
      const event = productEventFromWire(params.event);
      if (!event) return invalid("event is not one the allowlist names");
      // SAFETY: the reader built these properties from the allowlist for this very name.
      productEvents.record(
        event.name,
        event.properties as ProductEventPropertiesFor<typeof event.name>,
      );
      return gatewayOk({});
    },
  };

  return {
    methods,
    store,
    recordProductEvent,
    recordProductEventOncePerDay: (name, key, properties) =>
      productEvents.recordOncePerDay(name, key, properties),
    emitSettingsSnapshot,
    emitSettings,
    refusedSettings,
    settingsWrite,
    reconcileProviderKeyVault,
    reconcileAccountPreferences,
    pushAccountPreferences,
    forgetAccountPreferenceHydration: () => {
      accountPreferencesHydratedAccount = undefined;
    },
    flushProductEvents: () => productEvents.flush(),
    link: (next) => {
      links.set(next);
    },
    start: async () => {
      void store.snapshot();
      productEvents.arm();
      productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: options.appVersion });
      productEvents.markDayActive();
      if (runMode.sendsNetwork) productEvents.start();
    },
    stop: async () => {
      productEvents.stop();
    },
  };
}
