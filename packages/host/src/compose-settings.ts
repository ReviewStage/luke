import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
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
import { HostedVaultClient } from "@sidecar/hosted";
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
import { Cause, Deferred, Effect, Option, Queue } from "effect";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import type { Composer } from "./composer.js";
import { startedAndStopped } from "./effect/composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AppIdentity, type Environment, SecretCipher } from "./effect/seams.js";
import { settingsOverrides } from "./effect/settings-overrides.js";
import { heldProductEvents } from "./held-product-events.js";
import { hostSettingSideEffects } from "./settings-side-effects.js";
import { apiKeyRejection, SettingsStore, type StoredAccount } from "./settings-store.js";
import { vaultStepBearer } from "./vault-step-bearer.js";
import { type VaultStepEra, vaultStepEraStands } from "./vault-step-era.js";
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
  applyVoiceCredential: Effect.Effect<void>;
  setVoice: (voice: StoredSettings["voice"]) => void;
  reconcileSpeech: () => void;
  broadcastWorkspaceProjects: Effect.Effect<void>;
  workspaceProjectOffered: (providerId: string, providerProjectId: string) => boolean;
}

export interface SettingsComposer extends Composer {
  readonly store: SettingsStore;
  readonly recordProductEvent: RecordProductEvent;
  /** One count per provider per day, as the observation pass makes it. */
  recordProductEventOncePerDay: ProductEventSender["recordOncePerDay"];
  emitSettingsSnapshot: (settings: SettingsUpdateResult["settings"], reporter?: string) => void;
  emitSettings: () => Effect.Effect<void>;
  refusedSettings: (reason: string) => Effect.Effect<SettingsUpdateResult>;
  /**
   * One settings write and, when it landed, its host side effects and the
   * change event. The refusal answers for every way the write or its effects
   * could not be carried, defect included, exactly as the promise door here
   * caught a rejection from either.
   */
  settingsWrite: (
    save: () => Effect.Effect<SettingsUpdateResult, unknown>,
    apply: (result: SettingsUpdateResult) => Effect.Effect<void, unknown>,
    refusal: string,
    reporter: string | undefined,
  ) => Effect.Effect<SettingsUpdateResult>;
  /**
   * The vault's key list read again, and a key an earlier build kept on this
   * Mac handed to it: offered onto the vault's queue when the account's
   * capabilities open, so a cloud provider's row answers for what the
   * service holds. Offered rather than run, so the open waits on no network.
   */
  reconcileVaultKeys: () => Effect.Effect<void>;
  /** The account is gone, and so is what its vault held: every cloud provider's row reads not connected. */
  forgetVaultKeys: () => void;
  reconcileAccountPreferences: () => Effect.Effect<void>;
  /**
   * The developer's own preference write, on its way to the account behind it,
   * offered rather than run: the observation composer asks for one from a
   * promise-shaped body that has no fiber to yield on.
   */
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
    const fileSystemContext = yield* Effect.context<FileSystem.FileSystem>();
    const fileSystem = yield* FileSystem.FileSystem;
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
    /**
     * The account the step now on the vault's queue began under, by address,
     * or nothing between steps. The vault client reads its bearer fresh for
     * every attempt, so the bearer is bound here to that account: a call whose
     * header would be read after another account signed in reads no credential
     * at all and never travels, rather than carrying the first account's key
     * under the second's bearer.
     */
    let vaultStepAccount: string | undefined;
    const store = new SettingsStore({
      directory: () => kernel.stateRoot,
      // A fixture or evidence run refuses the credentials it resolves, so nothing is
      // reported as available that would not actually happen.
      credentialsUsable: runMode.observesProviders,
      vaultKeyHeld: (providerId) => vaultKeys.has(providerId),
      cipher,
      overrides,
      fileSystem,
    });

    /**
     * One account read: a store that could not be read is an account this
     * attempt cannot name, which is what every caller of this already treated
     * a failed read as.
     */
    const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
      store.readAccount().pipe(Effect.orElseSucceed(() => undefined));

    // The quit's drain flushes ahead of this composer's stop, so a batch no
    // account could carry at that flush is on disk before the queue is dropped.
    const productEvents = new ProductEventSender({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      appVersion: identity.appVersion,
      sends: runMode.sendsNetwork,
      readAccessToken: () => Effect.map(readStoredAccount(), (account) => account?.accessToken),
      refreshAccount: () => links().refreshAccount(),
      readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
      held: heldProductEvents(kernel.stateRoot, report, fileSystemContext),
    });
    const hostedVault = new HostedVaultClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      readAccessToken: () =>
        runMode.sendsNetwork
          ? Effect.map(readStoredAccount(), (account) => vaultStepBearer(account, vaultStepAccount))
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
        readAccountPreferenceAccountKey().pipe(Effect.orElseSucceed(() => undefined)),
    });
    let accountPreferencesHydratedAccount: string | undefined;

    /**
     * One account-preferences action and the name its failure is reported
     * under. Every one of them rides this queue, so a reconcile and a push
     * cannot interleave into a snapshot that agrees with neither, exactly as
     * the one promise chain they were written on held them.
     */
    interface AccountPreferencesAction {
      readonly label: string;
      readonly work: Effect.Effect<void, unknown>;
    }
    const accountPreferencesActions = yield* Queue.unbounded<AccountPreferencesAction>();

    /**
     * An action offered rather than run: the hands and loops that ask for one
     * are not all fibers, and an offer onto an unbounded queue is what every
     * one of them can make where it stands.
     */
    const queueAccountPreferencesSync = (
      label: string,
      work: Effect.Effect<void, unknown>,
    ): void => {
      Queue.unsafeOffer(accountPreferencesActions, { label, work });
    };

    const failureReason = (cause: Cause.Cause<unknown>): string => {
      const error = Cause.squash(cause);
      return error instanceof Error ? error.message : String(error);
    };

    /** The queue drained one action at a time, for as long as the fiber running it stands. */
    const drainAccountPreferencesSync = Queue.take(accountPreferencesActions).pipe(
      Effect.flatMap(({ label, work }) =>
        Effect.catchAllCause(work, (cause) =>
          // An interruption is this fiber being ended rather than the action
          // going wrong; every other way it could not be carried, a defect
          // included, is the line the promise chain's own `catch` reported.
          Cause.isInterruptedOnly(cause)
            ? Effect.interrupt
            : Effect.sync(() => {
                report(`Account preferences ${label} failed: ${failureReason(cause)}`);
              }),
        ),
      ),
      Effect.forever,
    );

    /**
     * Every touch of the vault's key list rides one queue, drained by a fiber
     * of this composer's lifetime scope, in the order the hands and the
     * account's edges took them and one at a time. A step is offered with
     * the era its hand pressed in — the generation standing and the account
     * signed in at the press — and begins only if that era still stands when
     * the queue reaches it, so a Save that waited behind a reconcile's round
     * trips cannot run under whoever signed in meanwhile; and every step that
     * awaited the service checks the same two things before it writes, so a
     * list that returns after a sign-out, or a store that finishes after the
     * account changed, installs nothing. The bearer every call on the queue
     * carries is the era's own account's, so a call that outlived it travels
     * under nobody's.
     */
    const vaultActions = yield* Queue.unbounded<Effect.Effect<void>>();
    let vaultGeneration = 0;

    /** One step as the queue takes it: the account it began under is forgotten however it ends. */
    const vaultStep = <Answer>(step: Effect.Effect<Answer>): Effect.Effect<Answer> =>
      Effect.ensuring(
        step,
        Effect.sync(() => {
          vaultStepAccount = undefined;
        }),
      );

    /** A step offered onto the vault's queue and not waited for. */
    const offerVault = (step: Effect.Effect<void>): Effect.Effect<void> =>
      Effect.asVoid(Queue.offer(vaultActions, vaultStep(step)));

    /**
     * A step offered onto the vault's queue and waited for: the hand that
     * pressed Save is answered once the steps ahead of it are done and its
     * own has ended, with whatever its own ended in.
     */
    const enqueueVault = <Answer>(step: Effect.Effect<Answer>): Effect.Effect<Answer> =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<Answer>();
        yield* Queue.offer(
          vaultActions,
          Effect.flatMap(Effect.exit(vaultStep(step)), (exit) =>
            Effect.asVoid(Deferred.done(answer, exit)),
          ),
        );
        return yield* Deferred.await(answer);
      });

    /** The queue drained one step at a time, for as long as the fiber running it stands. */
    const drainVaultActions = Queue.take(vaultActions).pipe(
      Effect.flatMap((step) =>
        Effect.catchAllCause(step, (cause) =>
          // An interruption is this fiber being ended rather than a step going
          // wrong, so it stands; every other way a step could not be carried
          // is quiet here, since a waited-for step has already answered its
          // hand through its own deferred.
          Cause.isInterruptedOnly(cause) ? Effect.interrupt : Effect.void,
        ),
      ),
      Effect.forever,
    );

    /**
     * Who is signed in, by address: the one name an identity refresh cannot
     * add or drop mid-flight, where the opaque id can, so a store that
     * outlived a refresh is not read as a sign-out.
     */
    const signedInAccountKey = (): Effect.Effect<string | undefined> =>
      Effect.map(readStoredAccount(), (account) => account?.email);

    /** Whether the era a step was pressed in still stands, so it may begin or still write. */
    const vaultStillCurrent = (generation: number, accountKey: string): Effect.Effect<boolean> =>
      Effect.map(signedInAccountKey(), (signedIn) =>
        vaultStepEraStands({ generation, accountKey }, vaultGeneration, signedIn),
      );

    /** The era of a press: the generation standing and the account signed in, or nothing signed out. */
    const vaultEraNow = (): Effect.Effect<VaultStepEra | undefined> =>
      Effect.map(signedInAccountKey(), (accountKey) =>
        accountKey === undefined ? undefined : { generation: vaultGeneration, accountKey },
      );

    /**
     * A step begins only if the era of its press still stands; then its calls
     * travel as that account. Answers whether it began.
     */
    const beginVaultStep = (era: VaultStepEra): Effect.Effect<boolean> =>
      Effect.map(vaultStillCurrent(era.generation, era.accountKey), (stands) => {
        if (stands) vaultStepAccount = era.accountKey;
        return stands;
      });

    /**
     * The row says what the vault last listed, so until the first list of a
     * sign-in lands it says not connected; the emit that follows the list is
     * what brings it to true. A list that could not be read is asked for once
     * more, and one that still cannot leaves the last answer standing — the
     * vault did not say its keys were gone, only that it could not be asked —
     * until the next reconcile: a save, a sign-in, or a launch. Answers the
     * providers listed, or nothing when the vault could not be asked.
     */
    const refreshVaultKeys = (
      generation: number,
      accountKey: string,
    ): Effect.Effect<ReadonlySet<CloudAgentProviderId> | undefined> =>
      Effect.gen(function* () {
        const listed =
          (yield* Effect.promise(() => hostedVault.listKeys())) ??
          (yield* Effect.promise(() => hostedVault.listKeys()));
        if (listed === undefined) return undefined;
        if (!(yield* vaultStillCurrent(generation, accountKey))) return undefined;
        vaultKeys.clear();
        for (const entry of listed) vaultKeys.add(entry.providerId);
        return new Set(vaultKeys);
      });

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
    const migrateLocalCloudKeys = (
      generation: number,
      account: StoredAccount,
      held: ReadonlySet<CloudAgentProviderId>,
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const tenant = yield* Effect.orDie(store.readVaultSyncAccount());
        if (tenant === undefined || (tenant !== account.id && tenant !== account.email)) {
          return false;
        }
        let moved = false;
        for (const providerId of Object.values(CLOUD_AGENT_PROVIDER_ID)) {
          const local = yield* Effect.orDie(store.readStoredApiKey(providerId));
          if (local === undefined) continue;
          if (!held.has(providerId)) {
            const stored = yield* Effect.promise(() => hostedVault.storeKey(providerId, local));
            if (!stored?.stored) continue;
            moved = true;
          }
          if (!(yield* vaultStillCurrent(generation, account.email))) return moved;
          // The vault answered that it holds this key, so the row says so from
          // here whether or not the list that follows can be read.
          vaultKeys.add(providerId);
          yield* Effect.orDie(store.setApiKey(providerId, undefined));
        }
        return moved;
      });

    const reconcileVaultKeys = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const account = yield* readStoredAccount();
        if (!account) return;
        const era: VaultStepEra = { generation: vaultGeneration, accountKey: account.email };
        yield* offerVault(
          Effect.gen(function* () {
            if (!(yield* beginVaultStep(era))) return;
            const held = yield* refreshVaultKeys(era.generation, era.accountKey);
            if (held === undefined) return;
            if (yield* migrateLocalCloudKeys(era.generation, account, held)) {
              yield* refreshVaultKeys(era.generation, era.accountKey);
            }
            if (!(yield* vaultStillCurrent(era.generation, era.accountKey))) return;
            yield* emitSettings();
          }),
        );
      });

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
    const storeCloudKey = (
      providerId: CloudAgentProviderId,
      apiKey: string | undefined,
      reporter: string | undefined,
    ): Effect.Effect<SettingsUpdateResult> =>
      Effect.gen(function* () {
        // The era is the press's, read before the step is offered: a Save
        // that waits behind the steps ahead of it belongs to the account that
        // pressed, and begins under no other.
        const era = yield* vaultEraNow();
        if (era === undefined) {
          return yield* refusedSettings(
            "Sign in first: this key is held by Luke's service, not on this Mac.",
          );
        }
        return yield* enqueueVault(storeCloudKeyStep(era, providerId, apiKey, reporter));
      });

    /** The Save's own step, once the queue reaches it. */
    const storeCloudKeyStep = (
      era: VaultStepEra,
      providerId: CloudAgentProviderId,
      apiKey: string | undefined,
      reporter: string | undefined,
    ): Effect.Effect<SettingsUpdateResult> =>
      Effect.gen(function* () {
        const { generation, accountKey } = era;
        if (!(yield* beginVaultStep(era))) {
          return yield* refusedSettings(
            "The account changed before the key was stored; sign in and enter it again.",
          );
        }
        const normalized = apiKey?.trim();
        if (normalized) {
          // The same door the local path holds, and it already holds the
          // vault's own shape rule: the length it caps at is the vault's, and
          // printable ASCII admits no whitespace, so a key that passes here is
          // one the vault stores, and each refusal names its own reason.
          const rejection = apiKeyRejection(normalized, CREDENTIAL_PROVIDERS[providerId].keyFormat);
          if (rejection) return yield* refusedSettings(rejection);
          const stored = yield* Effect.promise(() => hostedVault.storeKey(providerId, normalized));
          if (!stored?.stored) {
            return yield* refusedSettings("Could not store that key with Luke's service.");
          }
          if (!(yield* vaultStillCurrent(generation, accountKey))) {
            return yield* refusedSettings("The account signed out while the key was being stored.");
          }
          vaultKeys.add(providerId);
          yield* Effect.orDie(store.setApiKey(providerId, undefined));
        } else {
          const deleted = yield* Effect.promise(() => hostedVault.deleteKey(providerId));
          if (deleted === undefined) {
            return yield* refusedSettings("Could not remove that key from Luke's service.");
          }
          if (!(yield* vaultStillCurrent(generation, accountKey))) {
            return yield* refusedSettings(
              "The account signed out while the key was being removed.",
            );
          }
          vaultKeys.delete(providerId);
        }
        recordProductEvent(
          normalized ? PRODUCT_EVENT.PROVIDER_CONNECT : PRODUCT_EVENT.PROVIDER_DISCONNECT,
          { connection_id: providerId },
        );
        const settings = yield* Effect.orDie(store.snapshot());
        emitSettingsSnapshot(settings, reporter);
        return { status: ACTION_RESULT_STATUS.ACCEPTED, settings };
      });

    const readAccountPreferenceAccountKey = (): Effect.Effect<string | undefined, PlatformError> =>
      Effect.map(store.readAccount(), (account) => account?.email);

    function accountPreferencesEmpty(preferences: AccountPreferences): boolean {
      return Object.keys(preferences).length === 0;
    }

    function accountPreferencesSame(left: AccountPreferences, right: AccountPreferences): boolean {
      return JSON.stringify(left) === JSON.stringify(right);
    }

    const accountPreferenceHydrationBaseline = (
      accountEmail: string,
    ): Effect.Effect<AccountPreferences, PlatformError> =>
      Effect.gen(function* () {
        const baseline = yield* store.accountPreferencesSyncBaseline(accountEmail);
        if (baseline !== undefined) return baseline;
        const preferences = yield* store.accountPreferences();
        yield* store.setAccountPreferencesSyncBaseline(accountEmail, preferences);
        return preferences;
      });

    function isAccountPreferenceField(field: AppSettingField): field is AccountPreferenceField {
      return ACCOUNT_PREFERENCE_FIELDS.some((candidate) => candidate === field);
    }

    function resetTouchesAccountPreferences(scope: UnparsedWireValue): boolean {
      return ACCOUNT_PREFERENCE_FIELDS.some((field) => {
        const definition = APP_SETTING_SCHEMA[field];
        return "resetScope" in definition && definition.resetScope === scope;
      });
    }

    const reconcileAccountPreferences = (): Effect.Effect<void> =>
      Effect.sync(() => {
        queueAccountPreferencesSync(
          "reconcile",
          Effect.gen(function* () {
            const accountKey = yield* readAccountPreferenceAccountKey();
            if (!accountKey) return;
            yield* hydrateAccountPreferences(accountKey);
          }),
        );
      });

    const hydrateAccountPreferences = (accountKey: string): Effect.Effect<boolean, PlatformError> =>
      Effect.gen(function* () {
        const baseline = yield* accountPreferenceHydrationBaseline(accountKey);
        if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
        const remote = yield* accountPreferencesClient.readPreferences();
        if (!remote || (yield* readAccountPreferenceAccountKey()) !== accountKey) return false;

        if (!remote.hasStoredSnapshot) {
          const preferences = yield* store.accountPreferences();
          if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
          if (!accountPreferencesEmpty(preferences)) {
            const written = yield* accountPreferencesClient.writePreferences(preferences);
            if (!written || (yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
          }
          if (!(yield* store.setAccountPreferencesSyncBaseline(accountKey, preferences))) {
            return false;
          }
          accountPreferencesHydratedAccount = accountKey;
          return true;
        }

        const saved = yield* store.applyAccountPreferences(remote.preferences, {
          accountEmail: accountKey,
          preferences: baseline,
        });
        if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
        accountPreferencesHydratedAccount = accountKey;
        const preferences = yield* store.accountPreferences();
        if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
        if (saved.changed.length > 0) {
          yield* applyAccountPreferenceSideEffects(saved, saved.changed);
        }
        if (!accountPreferencesSame(preferences, remote.preferences)) {
          const written = yield* accountPreferencesClient.writePreferences(preferences);
          if (!written || (yield* readAccountPreferenceAccountKey()) !== accountKey) return true;
        }
        yield* store.setAccountPreferencesSyncBaseline(accountKey, preferences);
        return true;
      });

    function pushAccountPreferences(): void {
      queueAccountPreferencesSync(
        "write",
        Effect.gen(function* () {
          const accountKey = yield* readAccountPreferenceAccountKey();
          if (!accountKey) return;
          if (
            accountPreferencesHydratedAccount !== accountKey &&
            !(yield* hydrateAccountPreferences(accountKey))
          ) {
            return;
          }
          const preferences = yield* store.accountPreferences();
          if (
            (yield* readAccountPreferenceAccountKey()) !== accountKey ||
            accountPreferencesHydratedAccount !== accountKey
          ) {
            return;
          }
          const written = yield* accountPreferencesClient.writePreferences(preferences);
          if (!written || (yield* readAccountPreferenceAccountKey()) !== accountKey) return;
          yield* store.setAccountPreferencesSyncBaseline(accountKey, preferences);
        }),
      );
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

    const emitSettings = (): Effect.Effect<void> =>
      Effect.map(Effect.orDie(store.snapshot()), (snapshot) => {
        emitSettingsSnapshot(snapshot);
      });

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
      applyVoiceCredential: Effect.suspend(() => links().applyVoiceCredential),
      reconcileSpeech: () => links().reconcileSpeech(),
      emitSettings,
    });

    const applyHostSettingSideEffect = (
      field: AppSettingField,
      settings: SettingsUpdateResult["settings"],
    ): Effect.Effect<void> =>
      sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({ settings: settings.stored });

    const applyAccountPreferenceSideEffects = (
      result: SettingsUpdateResult,
      changed: readonly AccountPreferenceField[],
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        for (const field of changed) {
          yield* applyHostSettingSideEffect(field, result.settings);
        }
        if (
          changed.includes(APP_SETTING_SCHEMA.workspaceAgentDefaults.field) ||
          changed.includes(APP_SETTING_SCHEMA.defaultWorkspaceProvider.field) ||
          changed.includes(APP_SETTING_SCHEMA.workspaceProjectDefaults.field)
        ) {
          yield* links().broadcastWorkspaceProjects;
        }
        emitSettingsSnapshot(result.settings);
      });

    const refusedSettings = (reason: string): Effect.Effect<SettingsUpdateResult> =>
      Effect.map(Effect.orDie(store.snapshot()), (settings) => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        settings,
        reason,
      }));

    /** Runs one settings write and, when it landed, its host side effects and the change event. */
    function settingsWrite(
      save: () => Effect.Effect<SettingsUpdateResult, unknown>,
      apply: (result: SettingsUpdateResult) => Effect.Effect<void, unknown>,
      refusal: string,
      reporter: string | undefined,
    ): Effect.Effect<SettingsUpdateResult> {
      return Effect.flatMap(save(), (saved) => Effect.as(apply(saved), saved)).pipe(
        Effect.tap((saved) =>
          Effect.sync(() => {
            emitSettingsSnapshot(saved.settings, reporter);
          }),
        ),
        // A write that could not be carried is the row's own refusal rather
        // than the request's failure, and a step that threw is one of those
        // ways, which is what the promise door's own `catch` already read it
        // as. An interruption is not: it is the caller ending this fiber.
        Effect.catchAllCause((cause) =>
          Cause.isInterruptedOnly(cause) ? Effect.interrupt : refusedSettings(refusal),
        ),
      );
    }

    const methods: GatewayMethodTable = {
      [GATEWAY_METHOD.SETTINGS_SNAPSHOT]: () =>
        Effect.map(Effect.orDie(store.snapshot()), (snapshot) => ({
          settings: carried(snapshot),
        })),
      [GATEWAY_METHOD.SETTINGS_UPDATE]: (params) =>
        Effect.gen(function* () {
          const field = params.field;
          if (!isAppSettingField(field) || isKeyedAppSettingField(field)) {
            return yield* invalid("field must name a plain setting");
          }
          const parsed = APP_SETTING_SCHEMA[field].guard(params.value);
          if (!parsed.valid) return yield* invalid("value is not the shape that setting takes");
          const result = yield* settingsWrite(
            () => store.set(field, parsed.value),
            (saved) =>
              saved.reason
                ? Effect.void
                : Effect.gen(function* () {
                    recordSettingUpdate(field, saved.settings);
                    yield* applyHostSettingSideEffect(field, saved.settings);
                  }),
            "Could not save that setting on this system.",
            reporterOf(params),
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
          const result = yield* settingsWrite(
            // SAFETY: settingEntryGuard validated the entry before it reaches the store.
            () => store.setEntry(field, key, parsed.value as SettingEntryValue<typeof field>),
            (saved) =>
              saved.reason
                ? Effect.void
                : Effect.gen(function* () {
                    recordSettingUpdate(field, saved.settings);
                    yield* applyHostSettingSideEffect(field, saved.settings);
                  }),
            "Could not save that setting on this system.",
            reporterOf(params),
          );
          if (!result.reason && isAccountPreferenceField(field)) pushAccountPreferences();
          return carried(result);
        }),
      [GATEWAY_METHOD.SETTINGS_RESET]: (params) =>
        Effect.gen(function* () {
          const scope = params.scope;
          if (!isSettingsResetScope(scope))
            return yield* invalid("scope is not one this build knows");
          const result = yield* settingsWrite(
            () => store.resetSettings(scope),
            (saved) =>
              saved.reason
                ? Effect.void
                : Effect.gen(function* () {
                    recordProductEvent(PRODUCT_EVENT.SETTINGS_RESET, {});
                    for (const field of APP_SETTING_FIELDS) {
                      const definition = APP_SETTING_SCHEMA[field];
                      if (!("resetScope" in definition) || definition.resetScope !== scope)
                        continue;
                      yield* applyHostSettingSideEffect(field, saved.settings);
                    }
                  }),
            "Could not reset those settings on this system.",
            reporterOf(params),
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
          // A cloud agent provider's key is the vault's alone: it takes the
          // service's own path and never reaches the store on this Mac.
          if (isCloudAgentProviderId(providerId)) {
            return carried(yield* storeCloudKey(providerId, apiKey, reporterOf(params)));
          }
          const result = yield* settingsWrite(
            () => store.setApiKey(providerId, apiKey),
            (saved) =>
              saved.reason
                ? Effect.void
                : Effect.gen(function* () {
                    if (providerId === VOICE_CREDENTIAL_PROVIDER_ID) {
                      yield* links().applyVoiceCredential;
                      yield* emitSettings();
                    }
                    recordProductEvent(
                      apiKey?.trim()
                        ? PRODUCT_EVENT.PROVIDER_CONNECT
                        : PRODUCT_EVENT.PROVIDER_DISCONNECT,
                      { connection_id: providerId },
                    );
                  }),
            "Could not save that API key on this system.",
            reporterOf(params),
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
      lifetime: Effect.gen(function* () {
        yield* startedAndStopped(
          Effect.sync(() => {
            productEvents.arm();
            productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: identity.appVersion });
            productEvents.markDayActive();
            if (runMode.sendsNetwork) productEvents.start();
          }),
          Effect.sync(() => {
            productEvents.stop();
          }),
        );
        // The settings read once so the file is warm for the composers built
        // after this one, waited on by none of them.
        yield* Effect.forkScoped(Effect.ignore(store.snapshot()));
        // The two chains this composer holds, each drained by a fiber of the
        // composer's own lifetime scope: the scope closing interrupts both
        // before the stop above gives back what the start took.
        yield* Effect.forkScoped(drainAccountPreferencesSync);
        yield* Effect.forkScoped(drainVaultActions);
      }),
    };
  });
