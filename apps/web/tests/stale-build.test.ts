import { it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";
import { pageLeave } from "../src/app/page-leave";
import { answerFailedChunk, type StaleBuildTab } from "../src/app/stale-build";

/**
 * stale-build.test.ts -- a tab whose chunk failed to load reloads once, never
 * loops when the reloaded page fails the same way, and asks first while it
 * holds work a reload would lose.
 */

/** A tab in the session given, online or not, holding what no page's leave covers or not, its reloads and asks counted. */
function tabIn(session: Map<string, string>, options: { unkept?: boolean; online?: boolean } = {}) {
  const leave = pageLeave(new EventTarget());
  const seen = { reloads: 0, asks: [] as (() => void)[] };
  const tab: StaleBuildTab = {
    online: () => options.online ?? true,
    session: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => {
        session.set(key, value);
      },
    },
    leave,
    unkept: () => options.unkept ?? false,
    reload: () => {
      seen.reloads += 1;
    },
    askReload: (reload) => {
      seen.asks.push(reload);
    },
  };
  return { tab, leave, seen };
}

it.effect(
  "a chunk that fails reloads the tab, and its stylesheet failing beside it does not again",
  () =>
    Effect.gen(function* () {
      const tab = tabIn(new Map());

      yield* answerFailedChunk(tab.tab);
      yield* answerFailedChunk(tab.tab);

      expect(tab.seen.reloads).toBe(1);
    }),
);

it.effect(
  "a reloaded page whose chunk fails again stands rather than looping, and reloads once more a minute on",
  () =>
    Effect.gen(function* () {
      const session = new Map<string, string>();
      yield* answerFailedChunk(tabIn(session).tab);

      // The page the reload read was the old build's still, as a cache may serve it.
      const reloaded = tabIn(session);
      yield* answerFailedChunk(reloaded.tab);
      expect(reloaded.seen.reloads).toBe(0);
      expect(reloaded.seen.asks).toEqual([]);

      yield* TestClock.adjust("1 minute");
      yield* answerFailedChunk(reloaded.tab);
      expect(reloaded.seen.reloads).toBe(1);
    }),
);

it.effect("a chunk that fails offline reloads nothing", () =>
  Effect.gen(function* () {
    const tab = tabIn(new Map(), { online: false });

    yield* answerFailedChunk(tab.tab);

    expect(tab.seen.reloads).toBe(0);
  }),
);

it.effect(
  "a tab holding unsaved work asks first, and its Reload goes through the panel's own question",
  () =>
    Effect.gen(function* () {
      const tab = tabIn(new Map());
      const leaveAsked: (() => void)[] = [];
      tab.leave.unsavedWork((leave) => leaveAsked.push(leave));

      yield* answerFailedChunk(tab.tab);
      expect(tab.seen.reloads).toBe(0);
      expect(tab.seen.asks).toHaveLength(1);

      tab.seen.asks[0]?.();
      expect(tab.seen.reloads).toBe(0);
      leaveAsked[0]?.();
      expect(tab.seen.reloads).toBe(1);
    }),
);

it.effect(
  "a tab holding files attached to a draft, which storage keeps none of, asks rather than reloading",
  () =>
    Effect.gen(function* () {
      const tab = tabIn(new Map(), { unkept: true });

      yield* answerFailedChunk(tab.tab);

      expect(tab.seen.reloads).toBe(0);
      expect(tab.seen.asks).toHaveLength(1);
    }),
);

it.effect(
  "a Reload the developer stayed from at the browser's question leaves the next failure asked about again",
  () =>
    Effect.gen(function* () {
      const tab = tabIn(new Map());
      tab.leave.unsavedPlanWords(true);

      yield* answerFailedChunk(tab.tab);
      tab.seen.asks[0]?.();
      // The browser asked about the plan's words before reloading, and the developer stayed.
      expect(tab.seen.reloads).toBe(1);

      yield* answerFailedChunk(tab.tab);
      expect(tab.seen.asks).toHaveLength(2);
    }),
);
