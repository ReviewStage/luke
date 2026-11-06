// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { SessionReplayBootstrap } from "@repo/gateway/window-session";
import type { AppStateSnapshot } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { AppPlatform } from "./app-platform.js";
import { installAppPlatform } from "./app-platform.js";
import { SideBundlesContext, sideBundles } from "./bundle-loader.js";
import { markdownHtmlParserAtom } from "./markdown-html-parser.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { stateWith } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { usePrefetchBundles, useSessionReplay } from "./use-startup-work.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

interface Idle {
  readonly run: () => void;
  readonly timeout: number | undefined;
  canceled: boolean;
}

let idle: Idle[] = [];
let roots: Root[] = [];
let heard: SessionReplayBootstrap[] = [];
let editorImports = 0;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  idle = [];
  heard = [];
  editorImports = 0;
  vi.stubGlobal(
    "requestIdleCallback",
    (run: () => void, options?: { timeout?: number }): number => {
      idle.push({ run, timeout: options?.timeout, canceled: false });
      return idle.length - 1;
    },
  );
  vi.stubGlobal("cancelIdleCallback", (handle: number) => {
    const each = idle[handle];
    if (each) each.canceled = true;
  });
  uninstall = installAppPlatform({
    applySessionReplay: (word: SessionReplayBootstrap) => heard.push(word),
  } as unknown as AppPlatform);
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  uninstall?.();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function Startup(props: { readonly state: AppStateSnapshot }): null {
  useSessionReplay(props.state.run, props.state.sessionReplay, undefined);
  usePrefetchBundles();
  return null;
}

function draw(first: AppStateSnapshot): (next: AppStateSnapshot) => void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const bundles = sideBundles({
    descriptionEditor: () => {
      editorImports += 1;
      return new Promise(() => undefined);
    },
  });
  const render = (state: AppStateSnapshot): ReactElement =>
    onRegistry(
      AtomRegistry.make(),
      createElement(
        SideBundlesContext.Provider,
        { value: bundles },
        createElement(Startup, { state }),
      ),
    );
  act(() => root.render(render(first)));
  return (next) => act(() => root.render(render(next)));
}

function delivery(sessionReplay: AppStateSnapshot["sessionReplay"]): AppStateSnapshot {
  const base = stateWith({}, {});
  return { ...base, run: { ...base.run, packaged: true }, sessionReplay };
}

function goIdle(): void {
  act(() => {
    for (const each of idle.filter((one) => !one.canceled)) each.run();
  });
}

test("session replay and the prefetches start once the renderer is idle, not on the first commit", () => {
  draw(delivery({ permitted: true, halted: false, accountId: "user-1" }));

  assert.deepEqual(heard, []);
  assert.equal(editorImports, 0);
  assert.equal(rendererRegistry.getNodes().has(markdownHtmlParserAtom), false);

  goIdle();

  assert.deepEqual(heard, [
    { permitted: true, appVersion: "1.0.0", packaged: true, accountId: "user-1" },
  ]);
  assert.equal(editorImports, 1);
  assert.equal(rendererRegistry.getNodes().has(markdownHtmlParserAtom), true);
});

test("a renderer that never goes idle still starts session replay within a few seconds", () => {
  draw(delivery({ permitted: true, halted: false }));

  const timeouts = idle.map((each) => each.timeout);
  assert.ok(timeouts.every((timeout) => timeout !== undefined && timeout <= 5000));
});

test("a delivery that moved nothing recording reads is not another word, and a change is heard at once", () => {
  const redeliver = draw(delivery({ permitted: true, halted: false, accountId: "user-1" }));
  goIdle();
  assert.equal(heard.length, 1);

  redeliver(delivery({ permitted: true, halted: false, accountId: "user-1" }));
  assert.equal(heard.length, 1);

  redeliver(delivery({ permitted: false, halted: true, accountId: "user-1" }));
  assert.equal(heard.length, 2);
  assert.equal(heard[1]?.permitted, false);
});

test("the latest word before idle is the one the platform hears first, once", () => {
  const redeliver = draw(delivery({ permitted: true, halted: false }));
  redeliver(delivery({ permitted: true, halted: false, accountId: "user-2" }));
  assert.deepEqual(heard, []);

  goIdle();

  assert.deepEqual(heard, [
    { permitted: true, appVersion: "1.0.0", packaged: true, accountId: "user-2" },
  ]);
});

test("leaving before the renderer is idle starts nothing", () => {
  draw(delivery({ permitted: true, halted: false }));
  for (const root of roots) act(() => root.unmount());
  roots = [];

  goIdle();

  assert.deepEqual(heard, []);
  assert.equal(editorImports, 0);
  assert.ok(idle.length > 0 && idle.every((each) => each.canceled));
});

test("a browser with no requestIdleCallback starts the work after a frame has painted, or at once in a hidden tab", async () => {
  vi.unstubAllGlobals();
  const frames: (() => void)[] = [];
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  draw(delivery({ permitted: true, halted: false }));
  assert.deepEqual(heard, []);
  const first = frames.splice(0);
  act(() => {
    for (const run of first) run();
  });
  assert.deepEqual(heard, []);
  act(() => {
    for (const run of frames.splice(0)) run();
  });
  assert.equal(heard.length, 1);

  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  draw(delivery({ permitted: true, halted: false, accountId: "user-3" }));
  await act(() => Promise.resolve());
  assert.equal(heard.length, 2);
  visibility.mockRestore();
});
