import {
  PRODUCT_EVENT,
  PRODUCT_UPDATE_ACTION,
  type RecordProductEvent,
} from "@repo/features/analytics";
import type { AppStateStore } from "@repo/host/client";
import { jsonStateFile } from "@repo/host/node";
import { UPDATE_ENDPOINT, type UpdaterEngine, UpdateService } from "@repo/host/update-service";
import type { UpdateSnapshot } from "@repo/settings/update";
import { text } from "@repo/wire";
import { Effect, type Scope } from "effect";
import { type UpdateMenuAct, updateMenuAct } from "../app-menu";
import type { DesktopConfig } from "./desktop-config";

export interface UpdateServiceHost {
  start: () => void;
  check: () => Promise<UpdateSnapshot>;
  install: () => void;
  moveToApplications: () => void;
  openLatestRelease: () => void;
  openChangelog: () => void;
}

interface UpdateServiceHostDependencies {
  config: DesktopConfig;
  recordProductEvent: RecordProductEvent;
  engine: UpdaterEngine | undefined;
  beforeRestart: () => Promise<void>;
  askBeforeRestart: () => Promise<boolean>;
  state: AppStateStore;
  showSettings: () => void;
  moveToApplications: () => void;
}

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
      report: config.report,
    });

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
      install: () => {
        void dependencies.askBeforeRestart().then((restart) => {
          if (!restart) return;
          recordProductEvent(PRODUCT_EVENT.UPDATE_ACTION, {
            update_action: PRODUCT_UPDATE_ACTION.INSTALL,
          });
          service.install();
        });
      },
      moveToApplications: () => dependencies.moveToApplications(),
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
    showMenu(service.snapshot());
    return host;
  },
);
