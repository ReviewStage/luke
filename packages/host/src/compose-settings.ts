import { type CallCredential, lateCredential } from "@repo/features";
import {
  PRODUCT_EVENT,
  PRODUCT_SETTING_VALUE,
  type ProductEventPropertiesFor,
  productEventFromWire,
  type RecordProductEvent,
} from "@repo/features/analytics";
import { ProductEventSender } from "@repo/features/analytics/sender";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, invalid } from "@repo/gateway";
import { catchAllButInterrupt } from "@repo/runtime/effect";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  accountPreferencesToPush,
  accountPreferencesToWrite,
  EXPERIMENT_COUNTED_AS,
  type Experiment,
  isAppSettingField,
  isExperiment,
  isSettingsResetScope,
  settingAnalytics,
  snapshotAccountPreferences,
} from "@repo/settings";
import type { SettingsUpdateResult } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS, isWireBoolean, type UnparsedWireValue } from "@repo/wire";
import { Cause, Effect, Option, Queue, type Scope, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import type { Composer } from "./composer.js";
import { startedAndStopped } from "./effect/composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AccountSource, AppIdentity, SettingsChangedElsewhere } from "./effect/seams.js";
import { EXPERIMENT_UNANSWERED, experimentWriter } from "./experiment-write.js";
import type { HostMethodTable } from "./gateway-door.js";
import { removeRetiredStore } from "./retired-store.js";
import { hostSettingSideEffects } from "./settings-side-effects.js";
import { SettingsStore } from "./settings-store.js";
import { reporterOf } from "./wire-helpers.js";

type StoredSettings = SettingsUpdateResult["settings"]["stored"];

const EXPERIMENT_SIGNED_OUT = "Sign in to turn on an experiment.";

interface SettingsLinks {
  readonly credential: CallCredential;
  readonly readAccountKey: () => Effect.Effect<string | undefined>;
  readonly confirmAccount: () => Effect.Effect<void>;
}

function keptFields(value: UnparsedWireValue): readonly AppSettingField[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const fields = value.filter(isAppSettingField);
  return fields.length === value.length ? fields : undefined;
}

export interface SettingsComposer extends Composer {
  readonly store: SettingsStore;
  readonly recordProductEvent: RecordProductEvent;
  emitSettingsSnapshot: (settings: SettingsUpdateResult["settings"], reporter?: string) => void;
  emitSettings: () => Effect.Effect<void>;
  refusedSettings: (reason: string) => Effect.Effect<SettingsUpdateResult>;
  settingsWrite: (
    save: () => Effect.Effect<SettingsUpdateResult, unknown>,
    apply: (result: SettingsUpdateResult) => Effect.Effect<void, unknown>,
    refusal: string,
    reporter: string | undefined,
  ) => Effect.Effect<SettingsUpdateResult>;
  reconcileAccountPreferences: () => Effect.Effect<void>;
  forgetAccountPreferenceHydration: () => void;
  flushProductEvents: Effect.Effect<void>;
  link: (links: SettingsLinks) => Effect.Effect<void>;
}

export const composeSettings = Effect.fn("host/composeSettings")(function* (): Effect.fn.Return<
  SettingsComposer,
  never,
  HostKernelTag | AccountSource | AppIdentity | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const kernel = yield* HostKernelTag;
  const { tokenCipher } = yield* AccountSource;
  const identity = yield* AppIdentity;
  const changedElsewhere = yield* Effect.serviceOption(SettingsChangedElsewhere);
  const fileSystemContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { runMode, report } = kernel;
  const late = yield* lateService<SettingsLinks>();
  const linked = <A, E>(read: (links: SettingsLinks) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.flatMap(late.value, read);

  const store = new SettingsStore({
    directory: () => kernel.stateRoot,
    packaged: identity.packaged,
    cipher: tokenCipher,
    sessionAccountEmail: () =>
      Effect.flatMap(late.peek, (links) =>
        Option.isSome(links) ? links.value.readAccountKey() : Effect.succeed(undefined),
      ),
    fileSystem,
    path,
    ...(Option.isSome(changedElsewhere) ? { writer: kernel.createId() } : undefined),
  });

  const credential: CallCredential = lateCredential(
    linked((links) => Effect.succeed(links.credential)),
  );

  const productEvents = yield* ProductEventSender.make({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    appVersion: identity.appVersion,
    packaged: identity.packaged,
    platform: identity.platform,
    sends: runMode.sendsNetwork,
    now: kernel.now,
    credential,
    confirmAccount: () => confirmAccount(),
    recordedDays: {
      lastRecordedDay: (name, discriminator, account) =>
        store
          .lastProductEventDay(name, discriminator, account)
          .pipe(Effect.orElseSucceed(() => undefined)),
      keepRecordedDay: (recorded) =>
        Effect.catch(store.keepProductEventDay(recorded), (error) =>
          Effect.sync(() => {
            report(`Keeping the day a usage count was sent failed: ${error.message}`);
          }),
        ),
    },
  });
  const accountPreferencesClient = new AccountPreferencesClient({
    serviceBaseUrl: kernel.hostedServiceBaseUrl,
    credential,
  });
  let accountPreferencesHydratedAccount: string | undefined;
  const experiments = experimentWriter({
    client: accountPreferencesClient,
    store,
    readAccountKey: () => readAccountPreferenceAccountKey(),
    confirmAccount: () => confirmAccount(),
  });

  interface AccountPreferencesAction {
    readonly label: string;
    readonly work: Effect.Effect<void, unknown>;
  }
  const accountPreferencesActions = yield* Queue.unbounded<AccountPreferencesAction>();

  const queueAccountPreferencesSync = (label: string, work: Effect.Effect<void, unknown>): void => {
    Queue.offerUnsafe(accountPreferencesActions, { label, work });
  };

  const drainAccountPreferencesSync = Queue.take(accountPreferencesActions).pipe(
    Effect.flatMap(({ label, work }) =>
      Effect.catchCause(work, (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.sync(() => {
              report(`Account preferences ${label} failed: ${Cause.pretty(cause)}`);
            }),
      ),
    ),
    Effect.forever,
  );

  const readAccountPreferenceAccountKey = (): Effect.Effect<string | undefined> =>
    linked((links) => links.readAccountKey());

  const confirmAccount = (): Effect.Effect<void> => linked((links) => links.confirmAccount());

  function accountPreferencesSame(left: AccountPreferences, right: AccountPreferences): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  const accountPreferenceHydrationBaseline = Effect.fnUntraced(function* (
    accountEmail: string,
  ): Effect.fn.Return<AccountPreferences, PlatformError> {
    yield* store.settleSessionAccount(accountEmail);
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
          yield* hydrateAccountPreferences(accountKey).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return;
                if (yield* store.markAccountRead(accountKey)) {
                  emitSettingsSnapshot(yield* Effect.orDie(store.snapshot()));
                }
              }),
            ),
          );
        }),
      );
    });

  const hydrateAccountPreferences = Effect.fnUntraced(function* (
    accountKey: string,
  ): Effect.fn.Return<boolean, PlatformError> {
    yield* confirmAccount();
    if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
    const baseline = yield* accountPreferenceHydrationBaseline(accountKey);
    if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
    const writesBefore = experiments.writesSent();
    const remote = yield* accountPreferencesClient.readPreferences();
    if (!remote || (yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
    if (
      experiments.writesSent() === writesBefore &&
      (yield* store.cacheExperiments(accountKey, remote.experiments))
    ) {
      emitSettingsSnapshot(yield* store.snapshot());
    }

    const local = yield* store.accountPreferences();
    if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
    const saved = yield* store.applyAccountPreferences(
      snapshotAccountPreferences(remote.preferences, remote.hasStoredSnapshot, local),
      { accountEmail: accountKey, preferences: baseline },
    );
    if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
    accountPreferencesHydratedAccount = accountKey;
    const preferences = yield* store.accountPreferences();
    if ((yield* readAccountPreferenceAccountKey()) !== accountKey) return false;
    if (saved.changed.length > 0) {
      yield* applyAccountPreferenceSideEffects(saved, saved.changed);
    }
    if (!accountPreferencesSame(preferences, remote.preferences)) {
      const written = yield* accountPreferencesClient.writePreferences(
        accountPreferencesToWrite(preferences, baseline),
      );
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
        yield* confirmAccount();
        const preferences = yield* store.accountPreferences();
        const baseline = yield* store.accountPreferencesSyncBaseline(accountKey);
        if (
          (yield* readAccountPreferenceAccountKey()) !== accountKey ||
          accountPreferencesHydratedAccount !== accountKey
        ) {
          return;
        }
        const written = yield* accountPreferencesClient.writePreferences(
          accountPreferencesToPush(preferences, baseline),
        );
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

  function recordSettingUpdate(field: AppSettingField, settings: SettingsUpdateResult["settings"]) {
    const analytics = settingAnalytics(field, settings.stored);
    if (!analytics) return;
    recordProductEvent(PRODUCT_EVENT.SETTING_UPDATE, {
      setting_id: analytics.id,
      setting_value: analytics.value,
    });
  }

  const sideEffects = hostSettingSideEffects({
    shareUsageData: (on) =>
      Effect.sync(() => {
        if (on) productEvents.arm();
        else productEvents.disarm();
      }),
  });

  const carriedValues = new Map<AppSettingField, string>();
  const carry = (field: AppSettingField, stored: StoredSettings): void => {
    carriedValues.set(field, JSON.stringify(stored[field]));
  };

  const applyHostSettingSideEffect = (
    field: AppSettingField,
    settings: SettingsUpdateResult["settings"],
  ): Effect.Effect<void> =>
    Effect.andThen(
      sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({ settings: settings.stored }),
      Effect.sync(() => carry(field, settings.stored)),
    );

  const applyAccountPreferenceSideEffects = Effect.fnUntraced(function* (
    result: SettingsUpdateResult,
    changed: readonly AccountPreferenceField[],
  ): Effect.fn.Return<void> {
    for (const field of changed) {
      yield* applyHostSettingSideEffect(field, result.settings);
    }
    emitSettingsSnapshot(result.settings);
  });

  const applyChangedElsewhere = Effect.gen(function* () {
    yield* store.reload();
    const after = yield* store.snapshot();
    for (const field of APP_SETTING_FIELDS) {
      if (carriedValues.get(field) !== JSON.stringify(after.stored[field])) {
        yield* applyHostSettingSideEffect(field, after);
      }
    }
    emitSettingsSnapshot(after);
  });

  const refusedSettings = (reason: string): Effect.Effect<SettingsUpdateResult> =>
    Effect.map(Effect.orDie(store.snapshot()), (settings) => ({
      status: ACTION_RESULT_STATUS.REJECTED,
      settings,
      reason,
    }));

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
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.interrupt : refusedSettings(refusal),
      ),
    );
  }

  const methods: HostMethodTable = {
    [GATEWAY_METHOD.SETTINGS_SNAPSHOT]: () =>
      Effect.map(Effect.orDie(store.snapshot()), (snapshot) => ({
        settings: carried(snapshot),
      })),
    [GATEWAY_METHOD.SETTINGS_UPDATE]: (params) =>
      Effect.gen(function* () {
        const field = params.field;
        if (!isAppSettingField(field)) return yield* invalid("field must name a setting");
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
    [GATEWAY_METHOD.EXPERIMENTS_SET]: (params) =>
      Effect.gen(function* () {
        const { experiment: named, on } = params;
        if (!isExperiment(named)) return yield* invalid("experiment must name one");
        if (!isWireBoolean(on)) return yield* invalid("on must be true or false");
        const experiment: Experiment = named;
        const accountKey = yield* readAccountPreferenceAccountKey();
        if (!accountKey) return carried(yield* refusedSettings(EXPERIMENT_SIGNED_OUT));
        const result = yield* settingsWrite(
          () => experiments.write(accountKey, experiment, on),
          (saved) =>
            Effect.sync(() => {
              if (saved.reason) return;
              recordProductEvent(PRODUCT_EVENT.EXPERIMENT_TOGGLE, {
                experiment: EXPERIMENT_COUNTED_AS[experiment],
                setting_value: on ? PRODUCT_SETTING_VALUE.ON : PRODUCT_SETTING_VALUE.OFF,
              });
            }),
          EXPERIMENT_UNANSWERED,
          reporterOf(params),
        );
        return carried(result);
      }),
    [GATEWAY_METHOD.SETTINGS_RESET]: (params) =>
      Effect.gen(function* () {
        const scope = params.scope;
        if (!isSettingsResetScope(scope))
          return yield* invalid("scope is not one this build knows");
        const kept = keptFields(params.kept);
        if (kept === undefined) return yield* invalid("kept must name settings");
        const result = yield* settingsWrite(
          () => store.resetSettings(scope, kept),
          (saved) =>
            saved.reason
              ? Effect.void
              : Effect.gen(function* () {
                  recordProductEvent(PRODUCT_EVENT.SETTINGS_RESET, {});
                  for (const field of APP_SETTING_FIELDS) {
                    const definition = APP_SETTING_SCHEMA[field];
                    if (!("resetScope" in definition) || definition.resetScope !== scope) continue;
                    if (kept.includes(field)) continue;
                    yield* applyHostSettingSideEffect(field, saved.settings);
                  }
                }),
          "Could not reset those settings on this system.",
          reporterOf(params),
        );
        if (!result.reason && resetTouchesAccountPreferences(scope)) pushAccountPreferences();
        return carried(result);
      }),
    [GATEWAY_METHOD.ANALYTICS_RECORD]: (params) => {
      const event = productEventFromWire(params.event);
      if (!event) return invalid("event is not one the allowlist names");
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
    emitSettingsSnapshot,
    emitSettings,
    refusedSettings,
    settingsWrite,
    reconcileAccountPreferences,
    forgetAccountPreferenceHydration: () => {
      accountPreferencesHydratedAccount = undefined;
      store.forgetAccountRead();
    },
    flushProductEvents: productEvents.flush,
    link: (next) => Effect.asVoid(late.set(next)),
    lifetime: Effect.gen(function* () {
      const sharesUsageData = yield* Effect.map(
        Effect.orElseSucceed(store.snapshot(), () => undefined),
        (snapshot) => snapshot?.stored.usageData === true,
      );
      yield* startedAndStopped(
        Effect.sync(() => {
          if (!sharesUsageData) return;
          productEvents.arm();
          productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: identity.appVersion });
        }),
        productEvents.drop,
      );
      yield* Effect.forkScoped(productEvents.markDayActive());
      if (runMode.observesProviders) {
        yield* Effect.forkScoped(
          Effect.provide(
            removeRetiredStore({ stateRoot: kernel.stateRoot, report }),
            fileSystemContext,
          ),
        );
      }
      yield* Effect.forkScoped(
        catchAllButInterrupt(
          Effect.andThen(store.retireStoredApiKeys(), store.snapshot()),
          (cause) =>
            Effect.sync(() => {
              report(`Retiring stored API keys failed: ${Cause.pretty(cause)}`);
            }),
        ),
      );
      yield* Effect.forkScoped(drainAccountPreferencesSync);
      if (Option.isSome(changedElsewhere)) {
        const built = yield* Effect.option(store.snapshot());
        if (Option.isSome(built)) {
          for (const field of APP_SETTING_FIELDS) carry(field, built.value.stored);
        }
        yield* Effect.forkScoped(
          Stream.runForEach(changedElsewhere.value, () =>
            catchAllButInterrupt(applyChangedElsewhere, (cause) =>
              Effect.sync(() => {
                report(`Reading settings another tab changed failed: ${Cause.pretty(cause)}`);
              }),
            ),
          ),
        );
      }
    }),
  };
});
