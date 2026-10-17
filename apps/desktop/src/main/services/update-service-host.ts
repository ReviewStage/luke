import {
  PRODUCT_EVENT,
  PRODUCT_UPDATE_ACTION,
  type RecordProductEvent,
} from "@luke/features/analytics";
import { jsonStateFile } from "@luke/host";
import { UPDATE_ENDPOINT, type UpdaterEngine, UpdateService } from "@luke/host/update-service";
import type { UpdateSnapshot } from "@luke/settings/update";
import { text } from "@luke/wire";
import { Effect, type Scope } from "effect";
import { type UpdateMenuAct, updateMenuAct } from "../app-menu";
import type { AppStateStore } from "../app-state";
import type { DesktopConfig } from "./desktop-config";

export interface UpdateServiceHost {
  /**
   * Begins the timed check, once the launch has reached the point it must:
   * after the operator's own standup, which the version mark this spends must
   * not survive a standup that failed or was quit before reaching here. Safe
   * to call on a build with nothing to install; does nothing then.
   */
  start: () => void;
  check: () => Promise<UpdateSnapshot>;
  /** A check the service asked for by refusing this build as too old; no press of the developer's, so none is counted. */
  checkRequired: () => Promise<UpdateSnapshot>;
  install: () => void;
  openLatestRelease: () => void;
  openChangelog: () => void;
}

interface UpdateServiceHostDependencies {
  config: DesktopConfig;
  recordProductEvent: RecordProductEvent;
  /**
   * The installer this build carries, or none: an unpackaged build, a fixture
   * run, and a platform Squirrel does not serve all have nothing to install.
   */
  engine: UpdaterEngine | undefined;
  /**
   * The whole quit's teardown, awaited before Squirrel is let near this
   * executable. It is the teardown and not the host's drain alone for two
   * reasons: the restart must not swap the binary over runtime work still
   * going, and the install's own quit must not be the one `before-quit`
   * holds back — a prevented `before-quit` aborts the install, so everything
   * owed has to be given back, and seen to be given back, before the
   * installer asks to leave.
   */
  beforeRestart: () => Promise<void>;
  /** Every state the row draws, written to the document the windows are told from. */
  state: AppStateStore;
  /**
   * Brings the window forward on Settings, where a check's answer is drawn:
   * the menu bar's Check for Updates runs with no window of its own to say it.
   */
  showSettings: () => void;
}

/**
 * The updater's lifecycle and the four actions the Updates row offers, built
 * on the ambient scope, with the menu bar's update item drawn from every
 * state it moves to: `UpdateService`'s timed check and first check fork
 * into it directly, so they are interrupted by the
 * launch's own scope closing at quit rather than a scope this function made
 * and had to give back itself. `UpdateService` holds the feed and the
 * schedule; what is here is when it begins and the counted event
 * each press files. Construction alone does not start it: the caller's own
 * `start()` is what the launch calls once it has reached the right point in
 * its own order, never this function's own return.
 */
export const createUpdateServiceHost = /* @__PURE__ */ Effect.fn("desktop/createUpdateServiceHost")(
  function* (
    dependencies: UpdateServiceHostDependencies,
  ): Effect.fn.Return<UpdateServiceHost, never, Scope.Scope> {
    const { config, recordProductEvent } = dependencies;

    const lastRunVersionFile = jsonStateFile<{ version: string }>({
      directory: () => config.stateRoot,
      fileName: "last-run-version.json",
      read: (record) => {
        const version = text(record.version);
        return version === undefined ? undefined : { version };
      },
      write: (state) => state,
      report: config.report,
    });

    // The menu bar is drawn again only when its item's act changes, not on
    // every download tick.
    let shownAct: UpdateMenuAct | undefined | null = null;
    const showMenu = (update: UpdateSnapshot) => {
      const act = updateMenuAct(update, config.packaged);
      if (act === shownAct) return;
      shownAct = act;
      config.showMenuBar({
        update:
          act === undefined
            ? undefined
            : {
                act,
                onCheck: () => {
                  dependencies.showSettings();
                  void host.check();
                },
                onInstall: () => host.install(),
                onOpenLatest: () => host.openLatestRelease(),
              },
      });
    };

    const engine = dependencies.engine;
    const service = yield* UpdateService.make({
      currentVersion: config.appVersion,
      onChange: (update) => {
        dependencies.state.update({ update });
        showMenu(update);
      },
      engine:
        engine === undefined
          ? undefined
          : {
              ...engine,
              quitAndInstall: () => {
                void dependencies.beforeRestart().finally(() => engine.quitAndInstall());
              },
            },
      lastRunVersion: {
        read: () => lastRunVersionFile.read()?.version,
        write: (version) => {
          lastRunVersionFile.update(() => ({ version }));
        },
      },
    });

    // The timed check and the first check are handles the quit takes back: a check firing into a process already draining reads the
    // fixed feed for a build that is leaving.
    yield* Effect.addFinalizer(() => Effect.sync(() => service.stop()));

    const host: UpdateServiceHost = {
      start: () => {
        if (config.runMode.sendsNetwork) service.start();
      },
      check: () => {
        recordProductEvent(PRODUCT_EVENT.UPDATE_ACTION, {
          update_action: PRODUCT_UPDATE_ACTION.CHECK,
        });
        return service.check({ asked: true });
      },
      checkRequired: () => service.check({ asked: true }),
      install: () => {
        recordProductEvent(PRODUCT_EVENT.UPDATE_ACTION, {
          update_action: PRODUCT_UPDATE_ACTION.INSTALL,
        });
        service.install();
      },
      openLatestRelease: () => {
        recordProductEvent(PRODUCT_EVENT.UPDATE_ACTION, {
          update_action: PRODUCT_UPDATE_ACTION.RELEASE_OPEN,
        });
        void config.openExternal(UPDATE_ENDPOINT.LATEST_RELEASE_PAGE_URL);
      },
      openChangelog: () => {
        recordProductEvent(PRODUCT_EVENT.UPDATE_ACTION, {
          update_action: PRODUCT_UPDATE_ACTION.CHANGELOG_OPEN,
        });
        void config.openExternal(UPDATE_ENDPOINT.CHANGELOG_PAGE_URL);
      },
    };
    // A build whose updater never moves still shows where it stands.
    showMenu(service.snapshot());
    return host;
  },
);
