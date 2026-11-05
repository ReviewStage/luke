import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";
import { pageLeave } from "../src/app/page-leave";
import { failedChunkAnswer, type StaleBuildTab } from "../src/app/stale-build";

/**
 * stale-build.test.ts -- a tab whose chunk failed to load asks once to
 * reload and never reloads unasked, asks nothing offline, and its Reload
 * goes through the panel's own question while work stands.
 */

/** A tab online or not, its reloads, asks, and each ask's dismissal kept. */
function tabWith(options: { online?: boolean } = {}) {
  const leave = pageLeave(new EventTarget());
  const seen = { reloads: 0, asks: [] as (() => void)[], dismisses: [] as (() => void)[] };
  const tab: StaleBuildTab = {
    online: () => options.online ?? true,
    leave,
    reload: () => {
      seen.reloads += 1;
    },
    askReload: (reload, dismissed) => {
      seen.asks.push(reload);
      seen.dismisses.push(dismissed);
    },
  };
  return { answer: failedChunkAnswer(tab), leave, seen };
}

it.effect(
  "a chunk that fails asks to reload rather than reloading, and its stylesheet failing beside it does not ask again",
  () =>
    Effect.gen(function* () {
      const tab = tabWith();

      yield* tab.answer();
      yield* tab.answer();

      expect(tab.seen.reloads).toBe(0);
      expect(tab.seen.asks).toHaveLength(1);
      tab.seen.asks[0]?.();
      expect(tab.seen.reloads).toBe(1);
    }),
);

it.effect("a chunk that fails offline asks nothing", () =>
  Effect.gen(function* () {
    const tab = tabWith({ online: false });

    yield* tab.answer();

    expect(tab.seen.asks).toEqual([]);
  }),
);

it.effect("a tab holding unsaved work reloads through the panel's own question", () =>
  Effect.gen(function* () {
    const tab = tabWith();
    const leaveAsked: (() => void)[] = [];
    tab.leave.unsavedWork((leave) => leaveAsked.push(leave));

    yield* tab.answer();
    tab.seen.asks[0]?.();
    expect(tab.seen.reloads).toBe(0);
    leaveAsked[0]?.();
    expect(tab.seen.reloads).toBe(1);
  }),
);

it.effect(
  "a Reload the developer stayed from at the browser's question leaves the next failure asked about again",
  () =>
    Effect.gen(function* () {
      const tab = tabWith();
      tab.leave.unsavedPlanWords(true);

      yield* tab.answer();
      tab.seen.asks[0]?.();
      // The browser asked about the plan's words before reloading, and the developer stayed.
      expect(tab.seen.reloads).toBe(1);

      yield* tab.answer();
      expect(tab.seen.asks).toHaveLength(2);
    }),
);

it.effect("an ask dismissed leaves the next failure asked about again", () =>
  Effect.gen(function* () {
    const tab = tabWith();

    yield* tab.answer();
    tab.seen.dismisses[0]?.();
    yield* tab.answer();

    expect(tab.seen.asks).toHaveLength(2);
    expect(tab.seen.reloads).toBe(0);
  }),
);
