import type * as FileSystem from "@effect/platform/FileSystem";
import {
  PRODUCT_EVENT,
  type ProductEventPropertiesFor,
  productEventFromWire,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { ProductEventSender } from "@sidecar/analytics/sender";
import {
  CREDENTIAL_PROVIDERS,
  isCredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import { HostedVaultClient, vaultKeyIsStorable } from "@sidecar/hosted";
import {
  CLOUD_AGENT_PROVIDER_ID,
  type CloudAgentProviderId,
  isCloudAgentProviderId,
} from "@sidecar/session";
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
import { ACTION_RESULT_STATUS, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { Effect, Option } from "effect";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import type { Composer } from "./composer.js";
import { startedAndStopped } from "./effect/composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AppIdentity, type Environment, SecretCipher } from "./effect/seams.js";
import { settingsOverrides } from "./effect/settings-overrides.js";
import { hostSettingSideEffects } from "./settings-side-effects.js";
import { apiKeyRejection, SettingsStore, type StoredAccount } from "./settings-store.js";
import { reporterOf } from "./wire-helpers.js";

type StoredSettings = SettingsUpdateResult["settings"]["stored"];

/**
 * What the settings write path reaches in the other concerns. Every one of
 * them is a genuine back-edge: a setting is where the developer changes what
 * a loop, a credential, or a voice does, so the write cannot be the leaf of
 * the graph however much simpler that would be.
 */
interface SettingsLinks {
  refreshAccount: () => Effect.Effect<void, unknown>;
  /** The vault holds a Conductor key, stored just now or found at sign-in; onboarding's key step is answered. */
  cloudKeyHeld: () => void;
  applyVoiceCredential: () => Promise<void>;
  setVoice: (voice: StoredSettings["voice"]) => void;
  reconcileSpeech: () => void;
  broadcastWorkspaceProjects: () => Promise<void>;
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
  /**
   * The vault's key list read again, after a key an earlier build kept on this
   * Mac has been handed to it: run when the account's capabilities open, so a
   * cloud provider's row answers for what the service holds.
   */
  reconcileVaultKeys: () => Promise<void>;
  /** The account is gone, and so is what its vault held: every cloud provider's row reads not connected. */
  forgetVaultKeys: () => void;
  reconcileAccountPreferences: () => Promise<void>;
  /** The developer's own preference write, on its way to the account behind it. */
  pushAccountPreferences: () => void;
  /** The account behind the hydrated preferences changed; the next push hydrates again. */
  forgetAccountPreferenceHydration: () => void;
  /** The count the account actions flush before they end the account they are authenticated with. */
  flushProductEvents: () => Promise<void>;
  link: (links: SettingsLinks) => void;
}

/**
 * The settings concern, over the kernel it takes as a tag rather than as a
 * constructor argument. It is the first composer built, so it takes no
 * sibling composer as a dependency.
 */
export const composeSettings = (): Effect.Effect<
  SettingsComposer,
  never,
  HostKernelTag | Environment | SecretCipher | AppIdentity | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const kernel = yield* HostKernelTag;
    const cipher = yield* SecretCipher;
    const identity = yield* AppIdentity;
    const overrides = yield* settingsOverrides;
    const runtime = yield* Effect.runtime<FileSystem.FileSystem>();
    const { runMode, report } = kernel;
    const late = yield* lateService<SettingsLinks>();
    const links = (): SettingsLinks => {
      const standing = late.unsafePeek();
      if (Option.isNone(standing)) {
        throw new Error("the settings composer's links are read before link() has run");
      }
      return standing.value;
    };

    /**
     * Which cloud agent providers the vault holds a key for, as it last listed
     * them: what a Conductor row's connected state is read from, since the key
     * itself is the service's and never this Mac's. Filled when the account's
     * capabilities open, moved by each store and delete, and emptied when the
     * account goes.
     */
    const vaultKeys = new Set<CloudAgentProviderId>();
    const store = new SettingsStore({
      directory: () => kernel.stateRoot,
      // A fixture or evidence run refuses the credentials it resolves, so nothing is
      // reported as available that would not actually happen.
      credentialsUsable: runMode.observesProviders,
      vaultKeyHeld: (providerId) => vaultKeys.has(providerId),
      cipher,
      overrides,
      runtime,
    });

    /**
     * One account read, lifted from the store's own Promise into a
     * never-failing Effect: a store that could not be read is an account
     * this attempt cannot name, exactly as a rejected promise already read
     * here before `accountBearer` gained an Effect of its own.
     */
    const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
      Effect.tryPromise(() => store.readAccount()).pipe(Effect.orElseSucceed(() => undefined));

    const productEvents = new ProductEventSender({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      appVersion: identity.appVersion,
      sends: runMode.sendsNetwork,
      readAccessToken: () => Effect.map(readStoredAccount(), (account) => account?.accessToken),
      refreshAccount: () => links().refreshAccount(),
      readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
    });
    const hostedVault = new HostedVaultClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      readAccessToken: () =>
        runMode.sendsNetwork
          ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
          : Effect.succeed(undefined),
      refreshAccount: () => links().refreshAccount(),
      readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
    });
    const accountPreferencesClient = new AccountPreferencesClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      readAccessToken: () =>
        runMode.sendsNetwork
          ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
          : Effect.succeed(undefined),
      refreshAccount: () => links().refreshAccount(),
      readAccountKey: () =>
        Effect.tryPromise(() => readAccountPreferenceAccountKey()).pipe(
          Effect.orElseSucceed(() => undefined),
        ),
    });
    let accountPreferencesHydratedAccount: string | undefined;
    let accountPreferencesSync: Promise<void> = Promise.resolve();

    /**
     * Every touch of the vault's key list rides one chain, in the order the
     * hands and the account's edges took them, and every step that awaited
     * the service checks two things before it writes: that no sign-out has
     * moved the generation since it began, and that the account it began
     * under is the one signed in. A list that returns after a sign-out, or a
     * store that finishes after the account changed, installs nothing.
     */
    let vaultActions: Promise<void> = Promise.resolve();
    let vaultGeneration = 0;
    function enqueueVault<Answer>(action: () => Promise<Answer>): Promise<Answer> {
      const next = vaultActions.then(action, action);
      vaultActions = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    }

    /**
     * Who is signed in, by address: the one name an identity refresh cannot
     * add or drop mid-flight, where the opaque id can, so a store that
     * outlived a refresh is not read as a sign-out.
     */
    async function signedInAccountKey(): Promise<string | undefined> {
      return (await store.readAccount())?.email;
    }

    /** Whether a step begun under this generation and account may still write. */
    async function vaultStillCurrent(generation: number, accountKey: string): Promise<boolean> {
      return vaultGeneration === generation && (await signedInAccountKey()) === accountKey;
    }

    /**
     * The row says what the vault last listed, so until the first list of a
     * sign-in lands it says not connected; the emit that follows the list is
     * what brings it to true. A list that could not be read is asked for once
     * more, and one that still cannot leaves the last answer standing — the
     * vault did not say its keys were gone, only that it could not be asked —
     * until the next reconcile: a save, a sign-in, or a launch. Answers the
     * providers listed, or nothing when the vault could not be asked.
     */
    async function refreshVaultKeys(
      generation: number,
      accountKey: string,
    ): Promise<ReadonlySet<CloudAgentProviderId> | undefined> {
      const listed = (await hostedVault.listKeys()) ?? (await hostedVault.listKeys());
      if (listed === undefined) return undefined;
      if (!(await vaultStillCurrent(generation, accountKey))) return undefined;
      vaultKeys.clear();
      for (const entry of listed) vaultKeys.add(entry.providerId);
      return new Set(vaultKeys);
    }

    /**
     * A cloud provider's key an earlier build kept encrypted on this Mac is
     * handed to the vault once and then deleted here, so after this the
     * machine holds none — and only to the account that build last synced it
     * for, read from the tenant record it kept, so a later sign-in on a shared
     * Mac cannot claim someone else's key. The vault's own list is read
     * first: a provider the vault already holds a key for keeps the vault's,
     * which the developer may have saved since from any device, and the
     * leftover here is deleted without travelling. A key with no tenant on
     * record, or another account's, stays where it is and is sent nowhere:
     * its row reads not connected, and the developer enters the key again
     * under their own account. A vault that refuses leaves the key for the
     * next sign-in rather than losing it; an environment key is not Luke's to
     * send. Answers whether the vault's list moved.
     */
    async function migrateLocalCloudKeys(
      generation: number,
      account: StoredAccount,
      held: ReadonlySet<CloudAgentProviderId>,
    ): Promise<boolean> {
      const tenant = await store.readVaultSyncAccount();
      if (tenant === undefined || (tenant !== account.id && tenant !== account.email)) return false;
      let moved = false;
      for (const providerId of Object.values(CLOUD_AGENT_PROVIDER_ID)) {
        const local = await store.readStoredApiKey(providerId);
        if (local === undefined) continue;
        if (!held.has(providerId)) {
          const stored = await hostedVault.storeKey(providerId, local);
          if (!stored?.stored) continue;
          moved = true;
        }
        if (!(await vaultStillCurrent(generation, account.email))) return moved;
        // The vault answered that it holds this key, so the row says so from
        // here whether or not the list that follows can be read.
        vaultKeys.add(providerId);
        await store.setApiKey(providerId, undefined);
      }
      return moved;
    }

    function reconcileVaultKeys(): Promise<void> {
      return enqueueVault(async () => {
        const generation = vaultGeneration;
        const account = await store.readAccount();
        if (!account) return;
        const held = await refreshVaultKeys(generation, account.email);
        if (held === undefined) return;
        if (await migrateLocalCloudKeys(generation, account, held)) {
          await refreshVaultKeys(generation, account.email);
        }
        if (!(await vaultStillCurrent(generation, account.email))) return;
        await emitSettings();
        if (vaultKeys.has(CLOUD_AGENT_PROVIDER_ID.CONDUCTOR)) links().cloudKeyHeld();
      });
    }

    /**
     * The account is gone: the set empties now and the generation moves, so
     * whatever vault call is still in flight installs nothing when it returns,
     * and the sign-out's own emit reads the row as not connected.
     */
    function forgetVaultKeys(): void {
      vaultGeneration += 1;
      vaultKeys.clear();
    }

    /**
     * A cloud agent provider's key: stored with Luke's service in the same
     * press, under the account's own bearer, and never written to this
     * machine, so the desktop holds no provider key. The row learns the
     * result from the vault's own answer, and its connected state from what
     * the vault now holds for the account still signed in. A leftover an
     * earlier build kept here is deleted in the same press, since the vault's
     * key is now the one that stands.
     */
    function storeCloudKey(
      providerId: CloudAgentProviderId,
      apiKey: string | undefined,
      reporter: string | undefined,
    ): Promise<SettingsUpdateResult> {
      return enqueueVault(async () => {
        const generation = vaultGeneration;
        const accountKey = await signedInAccountKey();
        if (accountKey === undefined) {
          return refusedSettings(
            "Sign in first: this key is held by Luke's service, not on this Mac.",
          );
        }
        const normalized = apiKey?.trim();
        if (normalized) {
          const rejection =
            apiKeyRejection(normalized, CREDENTIAL_PROVIDERS[providerId].keyFormat) ??
            (vaultKeyIsStorable(normalized) ? undefined : "That API key contains spaces.");
          if (rejection) return refusedSettings(rejection);
          const stored = await hostedVault.storeKey(providerId, normalized);
          if (!stored?.stored) {
            return refusedSettings("Could not store that key with Luke's service.");
          }
          if (!(await vaultStillCurrent(generation, accountKey))) {
            return refusedSettings("The account signed out while the key was being stored.");
          }
          vaultKeys.add(providerId);
          links().cloudKeyHeld();
          await store.setApiKey(providerId, undefined);
        } else {
          const deleted = await hostedVault.deleteKey(providerId);
          if (deleted === undefined) {
            return refusedSettings("Could not remove that key from Luke's service.");
          }
          if (!(await vaultStillCurrent(generation, accountKey))) {
            return refusedSettings("The account signed out while the key was being removed.");
          }
          vaultKeys.delete(providerId);
        }
        recordProductEvent(
          normalized ? PRODUCT_EVENT.PROVIDER_CONNECT : PRODUCT_EVENT.PROVIDER_DISCONNECT,
          { connection_id: providerId },
        );
        const settings = await store.snapshot();
        emitSettingsSnapshot(settings, reporter);
        return { status: ACTION_RESULT_STATUS.ACCEPTED, settings };
      });
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

    function recordSettingUpdate(
      field: AppSettingField,
      settings: SettingsUpdateResult["settings"],
    ) {
      const analytics = settingAnalytics(field, settings.stored);
      if (!analytics) return;
      recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
        setting_id: analytics.id,
        setting_value: analytics.value,
      });
    }

    const sideEffects = hostSettingSideEffects({
      setVoice: (voice) => links().setVoice(voice),
      applyVoiceCredential: () => links().applyVoiceCredential(),
      reconcileSpeech: () => links().reconcileSpeech(),
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
      if (
        changed.includes(APP_SETTING_SCHEMA.workspaceAgentDefaults.field) ||
        changed.includes(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field) ||
        changed.includes(APP_SETTING_SCHEMA.workspaceProjectDefaults.field)
      ) {
        await links().broadcastWorkspaceProjects();
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
      [GATEWAY_METHOD.SETTINGS_SNAPSHOT]: () =>
        Effect.map(
          Effect.promise(() => store.snapshot()),
          (snapshot) => ({ settings: carried(snapshot) }),
        ),
      [GATEWAY_METHOD.SETTINGS_UPDATE]: (params) =>
        Effect.gen(function* () {
          const field = params.field;
          if (!isAppSettingField(field) || isKeyedAppSettingField(field)) {
            return yield* invalid("field must name a plain setting");
          }
          const parsed = APP_SETTING_SCHEMA[field].guard(params.value);
          if (!parsed.valid) return yield* invalid("value is not the shape that setting takes");
          const result = yield* Effect.promise(() =>
            settingsWrite(
              () => store.set(field, parsed.value),
              async (saved) => {
                if (saved.reason) return;
                recordSettingUpdate(field, saved.settings);
                await applyHostSettingSideEffect(field, saved.settings);
              },
              "Could not save that setting on this system.",
              reporterOf(params),
            ),
          );
          if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
          return carried(result);
        }),
      [GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY]: (params) =>
        Effect.gen(function* () {
          const field = params.field;
          if (!isKeyedAppSettingField(field))
            return yield* invalid("field must name a keyed setting");
          const key = params.key;
          if (!isSettingEntryKey(field, key))
            return yield* invalid("key is not one that setting takes");
          // SAFETY: the guard is the parser; a wire value is one it reads.
          const parsed = settingEntryGuard(field, key, params.value as UnparsedWireValue);
          if (!parsed.valid) return yield* invalid("value is not the shape that entry takes");
          // SAFETY: settingEntryGuard validated workspace project defaults as a wire string.
          const projectWire = parsed.value as UnparsedWireValue;
          if (
            field === APP_SETTING_SCHEMA.workspaceProjectDefaults.field &&
            isWireString(projectWire) &&
            !links().workspaceProjectOffered(key, projectWire)
          ) {
            return yield* invalid("that project is not one a provider offers");
          }
          const result = yield* Effect.promise(() =>
            settingsWrite(
              // SAFETY: settingEntryGuard validated the entry before it reaches the store.
              () => store.setEntry(field, key, parsed.value as SettingEntryValue<typeof field>),
              async (saved) => {
                if (saved.reason) return;
                recordSettingUpdate(field, saved.settings);
                await applyHostSettingSideEffect(field, saved.settings);
              },
              "Could not save that setting on this system.",
              reporterOf(params),
            ),
          );
          if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
          return carried(result);
        }),
      [GATEWAY_METHOD.SETTINGS_RESET]: (params) =>
        Effect.gen(function* () {
          const scope = params.scope;
          if (!isSettingsResetScope(scope))
            return yield* invalid("scope is not one this build knows");
          const result = yield* Effect.promise(() =>
            settingsWrite(
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
            ),
          );
          if (!result.reason && resetTouchesAccountPreferences(scope)) pushAccountPreferences();
          return carried(result);
        }),
      [GATEWAY_METHOD.CREDENTIAL_SET_API_KEY]: (params) =>
        Effect.gen(function* () {
          const providerId = params.providerId;
          if (!isCredentialProviderId(providerId))
            return yield* invalid("providerId is not one this build knows");
          const apiKey = params.apiKey;
          if (apiKey !== undefined && !isWireString(apiKey)) {
            return yield* invalid("apiKey must be a string");
          }
          if (isCloudAgentProviderId(providerId)) {
            return carried(
              yield* Effect.promise(() => storeCloudKey(providerId, apiKey, reporterOf(params))),
            );
          }
          const result = yield* Effect.promise(() =>
            settingsWrite(
              () => store.setApiKey(providerId, apiKey),
              async (saved) => {
                if (saved.reason) return;
                if (providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
                  await links().applyVoiceCredential();
                  await emitSettings();
                }
                recordProductEvent(
                  apiKey?.trim()
                    ? PRODUCT_EVENT.PROVIDER_CONNECT
                    : PRODUCT_EVENT.PROVIDER_DISCONNECT,
                  { connection_id: providerId },
                );
              },
              "Could not save that API key on this system.",
              reporterOf(params),
            ),
          );
          return carried(result);
        }),
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
        return Effect.succeed({});
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
      reconcileVaultKeys,
      forgetVaultKeys,
      reconcileAccountPreferences,
      pushAccountPreferences,
      forgetAccountPreferenceHydration: () => {
        accountPreferencesHydratedAccount = undefined;
      },
      flushProductEvents: () => productEvents.flush(),
      link: (next) => {
        late.unsafeSet(next);
      },
      lifetime: startedAndStopped(
        Effect.sync(() => {
          void store.snapshot();
          productEvents.arm();
          productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: identity.appVersion });
          productEvents.markDayActive();
          if (runMode.sendsNetwork) productEvents.start();
        }),
        Effect.sync(() => {
          productEvents.stop();
        }),
      ),
    };
  });
