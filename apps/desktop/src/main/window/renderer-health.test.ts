import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import {
  followResponsiveness,
  sampleWindowMemory,
  type UnresponsiveEpisode,
  type WorkingSetCrossing,
} from "./renderer-health";

/**
 * renderer-health.test.ts -- what main hears of each window's renderer: a
 * panel that stops answering is one report per stretch, however often
 * Electron repeats itself, carrying how long and how much memory; and a
 * window's working set is noted once as it crosses its bound, never while
 * it stays under it or above it.
 *
 * Note that Electron's module is replaced whole, because it is the operating
 * system's door (its windows and its process metrics) and answers nothing
 * outside an Electron process.
 */

const { FakeWindow, metrics, windows } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  /** The working set of each process, in kilobytes, as the system would measure it. */
  const metrics = new Map<number, number>();
  /** A window as Electron opens it: its own events, and the page behind it in a process of its own. */
  class FakeWindow extends EventEmitter {
    static #nextId = 1;
    readonly webContents: {
      readonly id: number;
      getOSProcessId(): number;
      getURL(): string;
    };
    constructor(pid: number, document: string) {
      super();
      const id = FakeWindow.#nextId++;
      this.webContents = {
        id,
        getOSProcessId: () => pid,
        getURL: () => `file:///Applications/Luke.app/Contents/Resources/renderer/${document}`,
      };
    }
    isDestroyed(): boolean {
      return false;
    }
  }
  return { FakeWindow, metrics, windows: [] as InstanceType<typeof FakeWindow>[] };
});

vi.mock("electron", () => ({
  app: {
    getAppMetrics: () =>
      [...metrics].map(([pid, workingSetSize]) => ({ pid, memory: { workingSetSize } })),
  },
  BrowserWindow: { getAllWindows: () => windows },
}));

afterEach(() => {
  metrics.clear();
  windows.length = 0;
});

const KILOBYTES_PER_GIGABYTE = 1024 ** 2;

/** Lets the fibers forked here hear what was just emitted, with no time passing. */
const settle = Effect.repeat(Effect.andThen(Effect.yieldNow, TestClock.adjust(Duration.zero)), {
  times: 5,
});

it.effect("a panel that stops answering is reported once per stretch, as it answers again", () =>
  Effect.gen(function* () {
    const panel = new FakeWindow(4101, "index.html");
    metrics.set(4101, 0.9 * KILOBYTES_PER_GIGABYTE);
    const reported: UnresponsiveEpisode[] = [];
    const following = yield* Effect.forkChild(
      followResponsiveness(panel, (episode) => Effect.sync(() => reported.push(episode))),
    );
    yield* settle;

    panel.emit("unresponsive");
    yield* settle;
    yield* TestClock.adjust(Duration.seconds(3));
    // Electron may say it again within the same stretch.
    panel.emit("unresponsive");
    yield* TestClock.adjust(Duration.seconds(4));
    assert.equal(reported.length, 0, "nothing is reported while the page still does not answer");

    panel.emit("responsive");
    yield* settle;
    panel.emit("responsive");
    yield* settle;

    assert.deepEqual(reported, [
      {
        document: "index.html",
        unresponsiveMs: 7_000,
        workingSetBytes: 0.9 * 1024 ** 3,
        recovered: true,
      },
    ]);

    // A second stretch is a second report.
    panel.emit("unresponsive");
    yield* settle;
    yield* TestClock.adjust(Duration.seconds(2));
    panel.emit("responsive");
    yield* settle;
    assert.deepEqual(
      reported.map((episode) => episode.unresponsiveMs),
      [7_000, 2_000],
    );

    panel.emit("closed");
    yield* Fiber.join(following);
    assert.equal(panel.listenerCount("unresponsive"), 0, "the window's listeners are taken back");
  }),
);

it.effect("a panel that closes while it still does not answer is reported as not recovered", () =>
  Effect.gen(function* () {
    const panel = new FakeWindow(4102, "index.html");
    const reported: UnresponsiveEpisode[] = [];
    const following = yield* Effect.forkChild(
      followResponsiveness(panel, (episode) => Effect.sync(() => reported.push(episode))),
    );
    yield* settle;

    panel.emit("unresponsive");
    yield* settle;
    yield* TestClock.adjust(Duration.seconds(30));
    panel.emit("closed");
    yield* Fiber.join(following);

    assert.deepEqual(reported, [
      {
        document: "index.html",
        unresponsiveMs: 30_000,
        workingSetBytes: undefined,
        recovered: false,
      },
    ]);
  }),
);

it.effect("a window's working set is noted once as it crosses its bound, and never under it", () =>
  Effect.gen(function* () {
    windows.push(new FakeWindow(4201, "index.html"), new FakeWindow(4202, "voice.html"));
    metrics.set(4201, 1.2 * KILOBYTES_PER_GIGABYTE);
    metrics.set(4202, 0.3 * KILOBYTES_PER_GIGABYTE);
    const noted: WorkingSetCrossing[] = [];
    const sampling = yield* Effect.forkChild(
      sampleWindowMemory((crossing) => {
        noted.push(crossing);
      }),
    );
    yield* settle;
    assert.equal(noted.length, 0, "nothing under the bound is noted");

    metrics.set(4201, 1.6 * KILOBYTES_PER_GIGABYTE);
    yield* TestClock.adjust(Duration.seconds(30));
    assert.equal(noted.length, 0, "nothing is read between samples");
    yield* TestClock.adjust(Duration.seconds(30));
    assert.deepEqual(noted, [{ document: "index.html", workingSetBytes: 1.6 * 1024 ** 3 }]);

    // Staying over the bound is not crossing it again.
    metrics.set(4201, 1.8 * KILOBYTES_PER_GIGABYTE);
    yield* TestClock.adjust(Duration.seconds(60));
    assert.equal(noted.length, 1);

    // Falling back under and crossing again is.
    metrics.set(4201, 1.0 * KILOBYTES_PER_GIGABYTE);
    yield* TestClock.adjust(Duration.seconds(60));
    metrics.set(4201, 1.7 * KILOBYTES_PER_GIGABYTE);
    yield* TestClock.adjust(Duration.seconds(60));
    assert.deepEqual(
      noted.map((crossing) => crossing.workingSetBytes),
      [1.6 * 1024 ** 3, 1.7 * 1024 ** 3],
    );

    yield* Fiber.interrupt(sampling);
  }),
);
