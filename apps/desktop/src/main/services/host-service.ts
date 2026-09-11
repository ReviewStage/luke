import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { GatewayServer } from "@sidecar/gateway";
import { composeHost, type HostSeams, storeWorkerPath } from "@sidecar/host";
import { type LateRef, lateRef } from "@sidecar/wire";
import type { DesktopConfig } from "./desktop-config";
import type { DesktopService } from "./service";

/**
 * Where the runtime's one drain stands. Nothing is owed before the host has
 * started or after a drain has finished, so a quit in either state waits for
 * nothing; between them a quit waits, whether the drain is owed or already
 * under way behind an earlier ask.
 */
const HOST_DRAIN = {
  NOTHING_OWED: "nothing-owed",
  OWED: "owed",
  UNDER_WAY: "under-way",
} as const;

type HostDrain = (typeof HOST_DRAIN)[keyof typeof HOST_DRAIN];

/**
 * How long a drain waits on the standup it interrupted before draining
 * anyway. The wait is what keeps the standup from re-arming the runtime
 * behind the close, but it cannot be the whole quit: a store open or a
 * bootstrap that never answers would otherwise hold the quit forever, and
 * this process holds the single-instance lock, so the next launch could only
 * report that Luke is already running.
 */
const STANDUP_DRAIN_WAIT_MS = 5_000;

/** What the host's standup reaches in the client that operates it. */
interface HostServiceLinks {
  /**
   * The operator's first attach. It rides inside the standup because the
   * drain has to interrupt the whole of it: a quit landing between the store
   * opening and the bootstrap being read must cancel that work rather than
   * have the launch go on to draw over a runtime already closed.
   */
  attach: () => Promise<void>;
}

export interface HostService extends DesktopService {
  /** The one boundary this process's operator reaches the runtime through. */
  readonly server: GatewayServer;
  link: (links: HostServiceLinks) => void;
  /**
   * Whether a drain is still owed for this standup: true from before the
   * start until one has finished. It says nothing about whether a quit has
   * been asked for — the drain is several awaited stops behind that ask, so
   * what the launch checks is the composition's own quitting flag.
   */
  drainOwed: () => boolean;
}

export interface HostServiceDependencies {
  config: DesktopConfig;
  /** The client's own credential protection; the host encrypts nothing without it. */
  cipher: HostSeams["cipher"];
}

/**
 * The host this client operates, composed here and reached in-process. A live
 * run keeps its state on disk under Luke's own application data; a fixture or
 * capture run keeps nothing and is network-silent, and its store worker is
 * never asked for. Either way this process is one operator over one
 * transport, and one node.
 */
export function createHostService(dependencies: HostServiceDependencies): HostService {
  const { config, cipher } = dependencies;
  const { runMode } = config;
  const links: LateRef<HostServiceLinks> = lateRef("the host service's links");

  const host = composeHost({
    stateRoot: config.stateRoot,
    runMode,
    appVersion: config.appVersion,
    packaged: config.packaged,
    homeDirectory: config.homeDirectory,
    environment: config.environment,
    cipher,
    createWorker: () => {
      if (!runMode.observesProviders) {
        throw new Error("a fixture run keeps nothing on disk and starts no store worker");
      }
      return new Worker(storeWorkerPath(config.resourceDirectory), { name: "brain-store" });
    },
    now: Date.now,
    createId: () => randomUUID(),
    report: config.report,
    // The protocol's shutdown answers accepted at once; the quit that follows
    // is the one drain, in `before-quit`.
    onShutdownRequested: () => config.quit(),
  });

  let state: HostDrain = HOST_DRAIN.NOTHING_OWED;
  /** The standup, so a drain never overtakes it; it cannot be cancelled once it is under way. */
  let standup: Promise<unknown> = Promise.resolve();
  let draining: Promise<void> | undefined;

  function drain(): Promise<void> {
    if (state === HOST_DRAIN.OWED) {
      state = HOST_DRAIN.UNDER_WAY;
      // A drain that overtook the standup it interrupted would close the store
      // and then have the standup reopen it and re-arm the scheduler, the
      // hooks, and the observation behind the close, which is the one thing a
      // quit must not leave running. With the host's own two bounds, the
      // whole quit is bounded at twenty seconds.
      draining = Promise.race([
        standup.catch(() => undefined),
        new Promise<void>((resolve) => {
          setTimeout(resolve, STANDUP_DRAIN_WAIT_MS);
        }),
      ])
        .then(() => host.stop())
        .finally(() => {
          state = HOST_DRAIN.NOTHING_OWED;
        });
    }
    return draining ?? Promise.resolve();
  }

  return {
    name: "host",
    server: host.server,
    link: (next) => links.set(next),
    drainOwed: () => state === HOST_DRAIN.OWED,
    // The drain is owed from before the start rather than after it, because
    // the start opens the store and arms the scheduler, the hooks, and the
    // observation before it answers, and a Quit in that window must cancel
    // that work rather than have it killed mid-write.
    start: async () => {
      state = HOST_DRAIN.OWED;
      standup = (async () => {
        await host.start();
        await links.get().attach();
      })();
      await standup;
    },
    /**
     * The one drain, made once whichever path asks for it: the explicit Quit,
     * or the updater's restart into a downloaded build, which swaps this
     * executable and must not do it over runtime work still going. The drain
     * itself is the host's, in one place and in one order — admissions
     * closed, every run and child under way cancelled, a bounded wait, and
     * what did not settle counted from the persisted envelopes and left for
     * the next launch's recovery rather than finished on paper. Every later
     * ask is handed the drain already under way rather than a second one.
     */
    stop: drain,
  };
}
