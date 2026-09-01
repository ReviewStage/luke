import { Context, Effect, Fiber, Layer, Ref, Schedule, Scope } from "effect";
import { UPDATE_STATUS, type UpdateSnapshot, type UpdateStatus } from "#shared/contracts";
import {
  isNetworkErrorMessage,
  isPublishingWindowErrorMessage,
  type LastRunVersionStore,
  PUBLISHING_RETRY_DELAYS_MS,
  UPDATE_CHECK_DEFAULTS,
  type UpdaterEngine,
  type UpdaterEngineEvents,
} from "../update-service";

export interface UpdatesOptions {
  readonly currentVersion: string;
  readonly onChange: (update: UpdateSnapshot) => void;
  readonly engine?: UpdaterEngine;
  readonly lastRunVersion?: LastRunVersionStore;
  readonly intervalMs?: number;
  readonly justUpdatedFirstCheckDelayMs?: number;
  readonly publishingRetryDelaysMs?: readonly number[];
  readonly report?: (line: string) => void;
}

export interface Updates {
  readonly snapshot: () => UpdateSnapshot;
  readonly check: () => Effect.Effect<UpdateSnapshot>;
  readonly install: () => Effect.Effect<void>;
  readonly start: () => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

export class UpdatesTag extends Context.Tag("@luke/desktop/Updates")<UpdatesTag, Updates>() {}

interface UpdatesState {
  latestVersion: string | undefined;
  installing: boolean;
  started: boolean;
  publishingVersion: string | undefined;
  publishingRetriesUsed: number;
  publishingWait: string | undefined;
}

interface TimerHandles {
  interval: Fiber.RuntimeFiber<void, never> | undefined;
  firstCheck: NodeJS.Timeout | undefined;
  publishingRetry: NodeJS.Timeout | undefined;
}

export function updatesLayer(options: UpdatesOptions): Layer.Layer<UpdatesTag, never, Scope.Scope> {
  return Layer.scoped(
    UpdatesTag,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const intervalMs = options.intervalMs ?? UPDATE_CHECK_DEFAULTS.INTERVAL_MS;
      const justUpdatedFirstCheckDelayMs =
        options.justUpdatedFirstCheckDelayMs ??
        UPDATE_CHECK_DEFAULTS.JUST_UPDATED_FIRST_CHECK_DELAY_MS;
      const publishingRetryDelaysMs = options.publishingRetryDelaysMs ?? PUBLISHING_RETRY_DELAYS_MS;
      const report = options.report ?? ((line: string) => process.stderr.write(`${line}\n`));
      const engine = options.engine;

      const base = <Status extends UpdateStatus>(status: Status) => ({
        status,
        currentVersion: options.currentVersion,
        installSupported: engine !== undefined,
      });

      const idle = (upToDate: boolean): UpdateSnapshot => ({
        ...base(UPDATE_STATUS.IDLE),
        upToDate,
      });

      let currentSnapshot: UpdateSnapshot = idle(false);
      const stateRef = yield* Ref.make<UpdatesState>({
        latestVersion: undefined,
        installing: false,
        started: false,
        publishingVersion: undefined,
        publishingRetriesUsed: 0,
        publishingWait: undefined,
      });
      const timersRef = yield* Ref.make<TimerHandles>({
        interval: undefined,
        firstCheck: undefined,
        publishingRetry: undefined,
      });

      const move = (snapshot: UpdateSnapshot): void => {
        currentSnapshot = snapshot;
        try {
          options.onChange(snapshot);
        } catch {
          // A listener's failure is its own — a window torn down mid-broadcast
          // must not fail the transition that has already moved.
        }
      };

      const readState = () => Effect.runSync(Ref.get(stateRef));

      const clearPublishingRetry = (): void => {
        const timers = Effect.runSync(Ref.get(timersRef));
        if (timers.publishingRetry) clearTimeout(timers.publishingRetry);
        Effect.runSync(
          Ref.update(timersRef, (current) => ({
            ...current,
            publishingRetry: undefined,
          })),
        );
      };

      const check: Effect.Effect<UpdateSnapshot> = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (!engine || state.installing) return currentSnapshot;
        if (
          currentSnapshot.status === UPDATE_STATUS.DOWNLOADING ||
          currentSnapshot.status === UPDATE_STATUS.READY
        ) {
          return currentSnapshot;
        }
        clearPublishingRetry();
        move(base(UPDATE_STATUS.CHECKING));
        yield* Effect.tryPromise({
          try: () => engine.checkForUpdates(),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              const message = error.message;
              if (isNetworkErrorMessage(message)) {
                if (!resumePublishingWait(message)) {
                  report(`Update check could not reach the feed: ${message}`);
                  move(idle(false));
                }
              } else {
                Effect.runSync(
                  Ref.update(stateRef, (current) => ({
                    ...current,
                    publishingWait: undefined,
                  })),
                );
                report(`Update check failed: ${message}`);
                move({
                  ...base(UPDATE_STATUS.ERROR),
                  latestVersion: readState().latestVersion,
                });
              }
            }),
          ),
        );
        return currentSnapshot;
      });

      const armPublishingRetry = (version: string): boolean => {
        const state = readState();
        let publishingVersion = state.publishingVersion;
        let publishingRetriesUsed = state.publishingRetriesUsed;
        if (version !== publishingVersion) {
          publishingVersion = version;
          publishingRetriesUsed = 0;
        }
        const delayMs = publishingRetryDelaysMs[publishingRetriesUsed];
        if (delayMs === undefined) {
          Effect.runSync(
            Ref.update(stateRef, (current) => ({
              ...current,
              publishingWait: undefined,
            })),
          );
          return false;
        }
        publishingRetriesUsed += 1;
        Effect.runSync(
          Ref.update(stateRef, (current) => ({
            ...current,
            publishingVersion,
            publishingRetriesUsed,
          })),
        );
        clearPublishingRetry();
        const timer = setTimeout(() => {
          void Effect.runPromise(check);
        }, delayMs);
        timer.unref();
        Effect.runSync(
          Ref.update(timersRef, (current) => ({
            ...current,
            publishingRetry: timer,
          })),
        );
        return true;
      };

      const resumePublishingWait = (message: string): boolean => {
        const state = readState();
        const version = state.publishingWait;
        if (version === undefined) return false;
        if (currentSnapshot.status === UPDATE_STATUS.PUBLISHING) return true;
        if (!armPublishingRetry(version)) {
          Effect.runSync(
            Ref.update(stateRef, (current) => ({
              ...current,
              publishingWait: undefined,
            })),
          );
          return false;
        }
        report(`Update check could not reach the feed, still waiting on ${version}: ${message}`);
        move({
          ...base(UPDATE_STATUS.PUBLISHING),
          latestVersion: version,
        });
        return true;
      };

      const retryWhilePublishing = (message: string): boolean => {
        if (currentSnapshot.status !== UPDATE_STATUS.DOWNLOADING) return false;
        if (!isPublishingWindowErrorMessage(message)) return false;
        const version = currentSnapshot.latestVersion;
        if (!armPublishingRetry(version)) {
          Effect.runSync(
            Ref.update(stateRef, (current) => ({
              ...current,
              publishingWait: undefined,
            })),
          );
          return false;
        }
        Effect.runSync(
          Ref.update(stateRef, (current) => ({
            ...current,
            publishingWait: version,
          })),
        );
        report(`Release ${version} is still publishing, retrying: ${message}`);
        void engine?.clearCachedUpdate().catch(() => undefined);
        move({
          ...base(UPDATE_STATUS.PUBLISHING),
          latestVersion: version,
        });
        return true;
      };

      const handleEngineError = (message: string): void => {
        Effect.runSync(
          Ref.update(stateRef, (state) => ({
            ...state,
            installing: false,
          })),
        );
        if (isNetworkErrorMessage(message)) {
          if (resumePublishingWait(message)) return;
          report(`Update check could not reach the feed: ${message}`);
          move(idle(false));
          return;
        }
        if (retryWhilePublishing(message)) return;
        Effect.runSync(
          Ref.update(stateRef, (state) => ({
            ...state,
            publishingWait: undefined,
          })),
        );
        report(`Update failed: ${message}`);
        void engine?.clearCachedUpdate().catch(() => undefined);
        move({
          ...base(UPDATE_STATUS.ERROR),
          latestVersion: readState().latestVersion,
        });
      };

      if (engine) {
        const events: UpdaterEngineEvents = {
          onChecking: () => move(base(UPDATE_STATUS.CHECKING)),
          onAvailable: (version) => {
            Effect.runSync(
              Ref.update(stateRef, (state) => ({
                ...state,
                latestVersion: version,
              })),
            );
            move({ ...base(UPDATE_STATUS.DOWNLOADING), latestVersion: version });
          },
          onNotAvailable: () => {
            Effect.runSync(
              Ref.update(stateRef, (state) => ({
                ...state,
                publishingWait: undefined,
              })),
            );
            move(idle(true));
          },
          onProgress: (progress) => {
            if (currentSnapshot.status !== UPDATE_STATUS.DOWNLOADING) return;
            move({ ...currentSnapshot, progress });
          },
          onDownloaded: (version) => {
            Effect.runSync(
              Ref.update(stateRef, (state) => ({
                ...state,
                latestVersion: version,
                publishingWait: undefined,
              })),
            );
            move({ ...base(UPDATE_STATUS.READY), latestVersion: version });
          },
          onError: handleEngineError,
        };
        engine.wire(events);
      }

      const install = Effect.sync(() => {
        const state = readState();
        if (!engine || state.installing) return;
        if (currentSnapshot.status !== UPDATE_STATUS.READY) return;
        Effect.runSync(
          Ref.update(stateRef, (current) => ({
            ...current,
            installing: true,
          })),
        );
        engine.quitAndInstall();
      });

      const stop = Effect.sync(() => {
        const timers = Effect.runSync(Ref.get(timersRef));
        if (timers.interval) {
          void Effect.runPromise(Fiber.interrupt(timers.interval));
        }
        if (timers.firstCheck) clearTimeout(timers.firstCheck);
        if (timers.publishingRetry) clearTimeout(timers.publishingRetry);
        Effect.runSync(
          Ref.set(timersRef, {
            interval: undefined,
            firstCheck: undefined,
            publishingRetry: undefined,
          }),
        );
      });

      const start = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        if (state.started || !engine) return;
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          started: true,
        }));
        const previous = options.lastRunVersion?.read();
        const justUpdated = previous !== undefined && previous !== options.currentVersion;
        if (previous !== options.currentVersion) {
          options.lastRunVersion?.write(options.currentVersion);
        }
        if (justUpdated) {
          report(`Updated: ${previous} -> ${options.currentVersion}`);
          move({
            ...base(UPDATE_STATUS.UPDATED),
            previousVersion: previous,
          });
        }
        const intervalFiber = yield* Effect.fork(
          Effect.repeat(
            check.pipe(
              Effect.asVoid,
              Effect.catchAll(() => Effect.void),
            ),
            Schedule.spaced(intervalMs),
          ).pipe(Effect.asVoid),
        );
        const firstCheckTimer = setTimeout(
          () => {
            void Effect.runPromise(check);
          },
          justUpdated ? justUpdatedFirstCheckDelayMs : 0,
        );
        firstCheckTimer.unref();
        yield* Scope.addFinalizer(scope, stop.pipe(Effect.orDie));
        yield* Ref.set(timersRef, {
          interval: intervalFiber,
          firstCheck: firstCheckTimer,
          publishingRetry: undefined,
        });
      });

      return {
        snapshot: () => currentSnapshot,
        check: () => check,
        install: () => install,
        start: () => start,
        stop: () => stop,
      } satisfies Updates;
    }),
  );
}
