import { PRODUCT_EVENT, PRODUCT_UPDATE_ACTION, type RecordProductEvent } from "@sidecar/analytics";
import { jsonStateFile } from "@sidecar/host";
import { text } from "@sidecar/wire";
import type { UpdateSnapshot } from "#shared/messages/update";
import type { AppStateStore } from "../app-state";
import { UPDATE_ENDPOINT, type UpdaterEngine, UpdateService } from "../update-service";
import type { DesktopConfig } from "./desktop-config";
import type { DesktopService } from "./service";

export interface UpdateServiceHost extends DesktopService {
  check: () => Promise<UpdateSnapshot>;
  install: () => void;
  openLatestRelease: () => void;
  openChangelog: () => void;
}

export interface UpdateServiceHostDependencies {
  config: DesktopConfig;
  recordProductEvent: RecordProductEvent;
  /**
   * The installer this build carries, or none: an unpackaged build, a fixture
   * run, and a platform Squirrel does not serve all have nothing to install.
   */
  engine: UpdaterEngine | undefined;
  /**
   * The whole quit's dispose, awaited before Squirrel is let near this
   * executable. It is the dispose and not the host's drain alone for two
   * reasons: the restart must not swap the binary over runtime work still
   * going, and the install's own quit must not be the one `before-quit`
   * holds back — a prevented `before-quit` cancels the install, so everything
   * owed has to be given back, and seen to be given back, before the
   * installer asks to leave.
   */
  beforeRestart: () => Promise<void>;
  /** Every state the row draws, written to the document the windows are told from. */
  state: AppStateStore;
}

/**
 * The updater's lifecycle and the four actions the Updates row offers. The
 * `UpdateService` itself holds the feed, the schedule, and the retry budget;
 * what is here is when it begins, when it gives its timers back, and the
 * counted event each press files.
 */
export function createUpdateServiceHost(
  dependencies: UpdateServiceHostDependencies,
): UpdateServiceHost {
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

  const engine = dependencies.engine;
  const service = new UpdateService({
    currentVersion: config.appVersion,
    onChange: (update) => {
      dependencies.state.update({ update });
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

  return {
    name: "updates",
    check: () => {
      recordProductEvent(PRODUCT_EVENT.UPDATE_ACTION, {
        update_action: PRODUCT_UPDATE_ACTION.CHECK,
      });
      return service.check();
    },
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
    start: async () => {
      if (config.runMode.sendsNetwork) service.start();
    },
    // The timed check and the publishing-window retry are handles the quit
    // takes back: a check firing into a process already draining reads the
    // fixed feed for a build that is leaving.
    stop: async () => {
      service.stop();
    },
  };
}
