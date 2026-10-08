import {
  PRODUCT_EVENT,
  type ProductEventPropertiesFor,
  productEventFromWire,
  type RecordProductEvent,
} from "@sidecar/analytics";
import { ProductEventSender } from "@sidecar/analytics/sender";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@sidecar/gateway";
import type { AccountRefreshFailed } from "@sidecar/hosted";
import { catchAllButInterrupt } from "@sidecar/runtime/effect";
import {
  ACCOUNT_PREFERENCE_FIELDS,
  type AccountPreferenceField,
  type AccountPreferences,
  APP_SETTING_FIELDS,
  APP_SETTING_SCHEMA,
  type AppSettingField,
  isAppSettingField,
  isSettingsResetScope,
  settingAnalytics,
} from "@sidecar/settings";
import type { SettingsUpdateResult } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, type UnparsedWireValue } from "@sidecar/wire";
import { Cause, Effect, Queue, type Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { AccountPreferencesClient } from "./account-preferences-client.js";
import type { Composer } from "./composer.js";
import { startedAndStopped } from "./effect/composer.js";
import { HostKernelTag, lateService } from "./effect/kernel.js";
import { AppIdentity, type Environment, SecretCipher } from "./effect/seams.js";
import { settingsOverrides } from "./effect/settings-overrides.js";
import { removeRetiredStore } from "./retired-store.js";
import { hostSettingSideEffects } from "./settings-side-effects.js";
import { SettingsStore, type StoredAccount } from "./settings-store.js";
import { reporterOf } from "./wire-helpers.js";

type StoredSettings = SettingsUpdateResult["settings"]["stored"];

/**
 * What the settings write path reaches in the other concerns. Every one of
 * them is a genuine back-edge: a setting is where the developer changes what
 * an account or a voice does, so the write cannot be the leaf of the graph
 * however much simpler that would be.
 */
interface SettingsLinks {
  refreshAccount: () => Effect.Effect<void, AccountRefreshFailed>;
  setVoice: (voice: StoredSettings["voice"]) => Effect.Effect<void>;
  /** The standing live session ended once the voice moved, since a session keeps the voice it was created with. */
  readonly endLiveSession: Effect.Effect<void>;
}

export interface SettingsComposer extends Composer {
  readonly store: SettingsStore;
  readonly recordProductEvent: RecordProductEvent;
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
  reconcileAccountPreferences: () => Effect.Effect<void>;
  /** The account behind the hydrated preferences changed; the next push hydrates again. */
  forgetAccountPreferenceHydration: () => void;
  /** The count the account actions flush before they end the account they are authenticated with. */
  flushProductEvents: Effect.Effect<void>;
  link: (links: SettingsLinks) => Effect.Effect<void>;
}

/**
 * The settings concern, over the kernel it takes as a tag rather than as a
 * constructor argument. It is the first composer built, so it takes no
 * sibling composer as a dependency.
 */
export const composeSettings = /* @__PURE__ */ Effect.fn("host/composeSettings")(
  function* (): Effect.fn.Return<
    SettingsComposer,
    never,
    | HostKernelTag
    | Environment
    | SecretCipher
    | AppIdentity
    | FileSystem.FileSystem
    | Path.Path
    | Scope.Scope
  > {
    const kernel = yield* HostKernelTag;
    const cipher = yield* SecretCipher;
    const identity = yield* AppIdentity;
    const overrides = yield* settingsOverrides;
    const fileSystemContext = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { runMode, report } = kernel;
    const late = yield* lateService<SettingsLinks>();
    /**
     * One link, awaited: every reader of these is an effect of its own, so a
     * read before the merge has linked suspends until it stands rather than
     * throwing by name.
     */
    const linked = <A, E>(
      read: (links: SettingsLinks) => Effect.Effect<A, E>,
    ): Effect.Effect<A, E> => Effect.flatMap(late.value, read);

    const store = new SettingsStore({
      directory: () => kernel.stateRoot,
      // A fixture or evidence run refuses the account it holds, so nothing is
      // reported as available that would not actually happen.
      credentialsUsable: runMode.observesProviders,
      cipher,
      overrides,
      fileSystem,
      path,
    });

    /**
     * One account read: a store that could not be read is an account this
     * attempt cannot name, which is what every caller of this already treated
     * a failed read as.
     */
    const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
      store.readAccount().pipe(Effect.orElseSucceed(() => undefined));

    const productEvents = yield* ProductEventSender.make({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      appVersion: identity.appVersion,
      sends: runMode.sendsNetwork,
      readAccessToken: () => Effect.map(readStoredAccount(), (account) => account?.accessToken),
      refreshAccount: () => linked((links) => links.refreshAccount()),
      readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
    });
    const accountPreferencesClient = new AccountPreferencesClient({
      serviceBaseUrl: kernel.hostedServiceBaseUrl,
      readAccessToken: () =>
        runMode.sendsNetwork
          ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
          : Effect.succeed(undefined),
      refreshAccount: () => linked((links) => links.refreshAccount()),
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
      Queue.offerUnsafe(accountPreferencesActions, { label, work });
    };

    /** The queue drained one action at a time, for as long as the fiber running it stands. */
    const drainAccountPreferencesSync = Queue.take(accountPreferencesActions).pipe(
      Effect.flatMap(({ label, work }) =>
        Effect.catchCause(work, (cause) =>
          // An interruption is this fiber being ended rather than the action
          // going wrong; every other way it could not be carried, a defect
          // included, is the line the promise chain's own `catch` reported.
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.sync(() => {
                report(`Account preferences ${label} failed: ${Cause.pretty(cause)}`);
              }),
        ),
      ),
      Effect.forever,
    );

    const readAccountPreferenceAccountKey = (): Effect.Effect<string | undefined, PlatformError> =>
      Effect.map(store.readAccount(), (account) => account?.email);

    function accountPreferencesEmpty(preferences: AccountPreferences): boolean {
      return Object.keys(preferences).length === 0;
    }

    function accountPreferencesSame(left: AccountPreferences, right: AccountPreferences): boolean {
      return JSON.stringify(left) === JSON.stringify(right);
    }

    const accountPreferenceHydrationBaseline = /* @__PURE__ */ Effect.fnUntraced(function* (
      accountEmail: string,
    ): Effect.fn.Return<AccountPreferences, PlatformError> {
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

    const hydrateAccountPreferences = /* @__PURE__ */ Effect.fnUntraced(function* (
      accountKey: string,
    ): Effect.fn.Return<boolean, PlatformError> {
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
      setVoice: (voice) => linked((links) => links.setVoice(voice)),
      endLiveSession: linked((links) => links.endLiveSession),
    });

    const applyHostSettingSideEffect = (
      field: AppSettingField,
      settings: SettingsUpdateResult["settings"],
    ): Effect.Effect<void> =>
      sideEffects[APP_SETTING_SCHEMA[field].sideEffect]({ settings: settings.stored });

    const applyAccountPreferenceSideEffects = /* @__PURE__ */ Effect.fnUntraced(function* (
      result: SettingsUpdateResult,
      changed: readonly AccountPreferenceField[],
    ): Effect.fn.Return<void> {
      for (const field of changed) {
        yield* applyHostSettingSideEffect(field, result.settings);
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
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : refusedSettings(refusal),
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
      emitSettingsSnapshot,
      emitSettings,
      refusedSettings,
      settingsWrite,
      reconcileAccountPreferences,
      forgetAccountPreferenceHydration: () => {
        accountPreferencesHydratedAccount = undefined;
      },
      flushProductEvents: productEvents.flush,
      link: (next) => Effect.asVoid(late.set(next)),
      lifetime: Effect.gen(function* () {
        yield* startedAndStopped(
          Effect.sync(() => {
            productEvents.arm();
            productEvents.record(PRODUCT_EVENT.APP_LAUNCH, { app_version: identity.appVersion });
            productEvents.markDayActive();
          }),
          productEvents.drop,
        );
        // A live launch removes the SQLite store an earlier build left under
        // the agent's directory; a removal that fails is reported and stops
        // nothing else. A fixture or capture run keeps nothing on disk and
        // touches nothing. Forked, so the composers built after this one
        // never wait on the file system for it.
        if (runMode.observesProviders) {
          yield* Effect.forkScoped(
            Effect.provide(
              removeRetiredStore({ agentRoot: kernel.agentRootPath(), report }),
              fileSystemContext,
            ),
          );
        }
        // The settings read once so the file is warm for the composers built
        // after this one, waited on by none of them. A failure holds nothing
        // up and is written down; the next read tries the file again.
        yield* Effect.forkScoped(
          catchAllButInterrupt(store.snapshot(), (cause) =>
            Effect.sync(() => {
              report(`Reading settings failed: ${Cause.pretty(cause)}`);
            }),
          ),
        );
        // The chain this composer holds, drained by a fiber of the composer's
        // own lifetime scope: the scope closing interrupts it before the stop
        // above gives back what the start took.
        yield* Effect.forkScoped(drainAccountPreferencesSync);
      }),
    };
  },
);
