import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import {
  type CpuSummary,
  followResponsiveness,
  sampleProcessCpu,
  sampleWindowMemory,
  type UnresponsiveEpisode,
  type WorkingSetCrossing,
} from "./renderer-health";

const { FakeWindow, cpu, metrics, windows } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const metrics = new Map<number, number>();
  const cpu = new Map<number, { type: string; seconds: number }>();
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
        getURL: () => `file:///Applications/Vespin.app/Contents/Resources/renderer/${document}`,
      };
    }
    focused = false;
    isDestroyed(): boolean {
      return false;
    }
    isFocused(): boolean {
      return this.focused;
    }
    isVisible(): boolean {
      return true;
    }
    isMinimized(): boolean {
      return false;
    }
  }
  return { FakeWindow, cpu, metrics, windows: [] as InstanceType<typeof FakeWindow>[] };
});

vi.mock("electron", () => ({
  app: {
    getAppMetrics: () => [
      ...[...metrics].map(([pid, workingSetSize]) => ({
        pid,
        type: "Tab",
        memory: { workingSetSize },
        cpu: {},
      })),
      ...[...cpu].map(([pid, { type, seconds }]) => ({
        pid,
        type,
        memory: { workingSetSize: 0 },
        cpu: { cumulativeCPUUsage: seconds },
      })),
    ],
  },
  BrowserWindow: { getAllWindows: () => windows },
}));

afterEach(() => {
  metrics.clear();
  cpu.clear();
  windows.length = 0;
});

const KILOBYTES_PER_GIGABYTE = 1024 ** 2;

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
    windows.push(new FakeWindow(4201, "index.html"), new FakeWindow(4202, "index.html"));
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

    metrics.set(4201, 1.8 * KILOBYTES_PER_GIGABYTE);
    yield* TestClock.adjust(Duration.seconds(60));
    assert.equal(noted.length, 1);

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

it.effect("each kind of process's CPU is summed up every five minutes, from its CPU time", () =>
  Effect.gen(function* () {
    const panel = new FakeWindow(4301, "index.html");
    panel.focused = true;
    windows.push(panel);
    cpu.set(4300, { type: "Browser", seconds: 0 });
    cpu.set(4301, { type: "Tab", seconds: 0 });
    cpu.set(4302, { type: "Tab", seconds: 0 });
    cpu.set(4303, { type: "Zygote", seconds: 0 });
    const spend = (pid: number, seconds: number) => {
      const process = cpu.get(pid);
      if (process !== undefined) process.seconds += seconds;
    };
    const summaries: CpuSummary[] = [];
    const sampling = yield* Effect.forkChild(
      sampleProcessCpu(
        () => 3,
        (summary) => {
          summaries.push(summary);
        },
      ),
    );
    yield* settle;

    for (let span = 1; span <= 20; span++) {
      spend(4300, span === 7 ? 15 : 1.5);
      spend(4301, 3);
      spend(4302, 1.5);
      spend(4303, 15);
      if (span === 20)
        assert.equal(summaries.length, 0, "nothing is summed up before five minutes");
      yield* TestClock.adjust(Duration.seconds(15));
    }

    assert.deepEqual(summaries, [
      {
        process: "main",
        meanPercent: 14.5,
        maxPercent: 100,
        windowState: "focused",
        workingAgents: "2-4",
      },
      {
        process: "renderer",
        meanPercent: 30,
        maxPercent: 30,
        windowState: "focused",
        workingAgents: "2-4",
      },
    ]);

    yield* Fiber.interrupt(sampling);
  }),
);
