import { it } from "@effect/vitest";
import { fakeHttpClient } from "@luke/wire/testing";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { expect } from "vitest";
import { pageLeave } from "../src/app/page-leave";
import { answerFailedChunk, type StaleBuildTab } from "../src/app/stale-build";

/**
 * stale-build.test.ts -- a tab whose chunk failed to load because a deploy
 * moved the build on reloads onto the live build once, never loops when the
 * reload lands on the same build again, and asks first while it holds work
 * a reload would lose.
 */

/** The entry scripts of the build the tab was loaded with, and of the one deployed since. */
const OLD_BUILD = "/assets/app-Aold0001.js";
const NEW_BUILD = "/assets/app-Bnew0002.js";

/** Where the tab reads the panel's page as the origin serves it now. */
const LIVE_PAGE = "https://luke.test/app";

/** The origin, serving the panel's page as a deployment of the build given writes it. */
function originServing(build: string): Layer.Layer<HttpClient.HttpClient> {
  const page = `<!doctype html><html><head><script src="/app-theme.js"></script><script type="module" crossorigin src="${build}"></script></head><body><div id="root"></div></body></html>`;
  return Layer.succeed(
    HttpClient.HttpClient,
    fakeHttpClient((url) =>
      url === LIVE_PAGE ? new Response(page) : new Response(null, { status: 404 }),
    ),
  );
}

/** A tab loaded with the build given in the session given, its reloads and asks counted. */
function tabOn(build: string, session: Map<string, string>) {
  const leave = pageLeave(new EventTarget());
  const seen = { reloads: 0, asks: [] as (() => void)[] };
  const tab: StaleBuildTab = {
    build,
    livePage: LIVE_PAGE,
    session: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => {
        session.set(key, value);
      },
    },
    leave,
    typing: () => false,
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
  "a chunk that fails once a newer build is live reloads the tab, and its stylesheet failing beside it does not again",
  () =>
    Effect.gen(function* () {
      const tab = tabOn(OLD_BUILD, new Map());

      yield* answerFailedChunk(tab.tab);
      yield* answerFailedChunk(tab.tab);

      expect(tab.seen.reloads).toBe(1);
    }).pipe(Effect.provide(originServing(NEW_BUILD))),
);

it.effect(
  "a reload that lands on the same build again leaves the failure standing rather than looping",
  () =>
    Effect.gen(function* () {
      const session = new Map<string, string>();
      const first = tabOn(OLD_BUILD, session);
      yield* answerFailedChunk(first.tab);
      expect(first.seen.reloads).toBe(1);

      // The page the reload read was the old build's still, as a cache may serve it.
      const reloaded = tabOn(OLD_BUILD, session);
      yield* answerFailedChunk(reloaded.tab);

      expect(reloaded.seen.reloads).toBe(0);
      expect(reloaded.seen.asks).toEqual([]);
    }).pipe(Effect.provide(originServing(NEW_BUILD))),
);

it.effect("a chunk that fails while the build has not moved reloads nothing", () =>
  Effect.gen(function* () {
    const tab = tabOn(OLD_BUILD, new Map());

    yield* answerFailedChunk(tab.tab);

    expect(tab.seen.reloads).toBe(0);
  }).pipe(Effect.provide(originServing(OLD_BUILD))),
);

it.effect(
  "a tab holding unsaved work asks first, and its Reload goes through the panel's own question",
  () =>
    Effect.gen(function* () {
      const tab = tabOn(OLD_BUILD, new Map());
      const leaveAsked: (() => void)[] = [];
      tab.leave.unsavedWork((leave) => leaveAsked.push(leave));

      yield* answerFailedChunk(tab.tab);
      expect(tab.seen.reloads).toBe(0);
      expect(tab.seen.asks).toHaveLength(1);

      tab.seen.asks[0]?.();
      expect(tab.seen.reloads).toBe(0);
      leaveAsked[0]?.();
      expect(tab.seen.reloads).toBe(1);
    }).pipe(Effect.provide(originServing(NEW_BUILD))),
);
